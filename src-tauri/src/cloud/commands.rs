// Tauri commands exposed to the frontend. Thin wrappers around the `cloud::*`
// internals; bulk of the logic lives in `auth.rs`, `client.rs`, `sync.rs`.

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::cloud::auth::{self, AuthState};
use crate::cloud::client::{self, CloudError};
use crate::cloud::config::{settings_key_synced_at, SETTINGS_KEY_HAS_SYNCED, SETTINGS_KEY_PLAN};
use crate::cloud::domains::ALL_KINDS;
use crate::cloud::models::{CloudAiBalance, CloudAiUsage, CloudPricing, CloudStatus, CloudUser};
use crate::cloud::scheduler::Scheduler;
use crate::cloud::sync;
use crate::cloud::{ai as ai_client, billing as billing_client};
use crate::shared::repos::settings;

// ─── Status / OAuth URL builders ────────────────────────────────────────────

#[tauri::command]
pub async fn cloud_get_status(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<CloudStatus, String> {
    let snap = state.snapshot();
    if !state.is_connected() {
        return Ok(CloudStatus::default());
    }

    // Fetch fresh `me` from the server. The client::me path now
    // self-refreshes on 401 (Google only — see
    // `with_google_refresh_retry`), so by the time we get here:
    //   • Ok       → token was either valid or successfully refreshed.
    //   • NotAuth  → refresh exhausted / no refresh path; clear local
    //                auth and tell the UI we're signed out. Returning
    //                CloudStatus::default with connected:false flips
    //                the avatar back to the sign-in prompt instead of
    //                rendering an empty user card.
    //   • Other    → network / 5xx; keep partial state so the UI can
    //                render "we have a token, server is unreachable"
    //                without losing the in-keychain identity.
    match client::me(pool.inner(), &state).await {
        Ok(me) => {
            let mut last_synced = std::collections::HashMap::new();
            for k in ALL_KINDS {
                if let Ok(Some(s)) = settings::get_by_key(pool.inner(), &settings_key_synced_at(k)).await {
                    last_synced.insert(k.to_string(), s.value);
                }
            }

            // Detect plan transitions before persisting the new value.
            let old_plan: Option<String> = settings::get_by_key(pool.inner(), SETTINGS_KEY_PLAN)
                .await
                .ok()
                .flatten()
                .map(|s| s.value);
            let new_plan = me.plan.clone();

            let _ = settings::upsert(pool.inner(), SETTINGS_KEY_PLAN, &new_plan).await;

            // Pro → free: freeze coworkers beyond the first 3.
            if old_plan.as_deref() == Some("pro") && new_plan != "pro" {
                let disabled = crate::shared::repos::coworkers::disable_beyond_first_n(pool.inner(), 3)
                    .await
                    .unwrap_or(0);
                if disabled > 0 {
                    let _ = app.emit(
                        "cloud:plan_lapsed",
                        serde_json::json!({ "disabled_coworkers": disabled }),
                    );
                }
            }

            // Free → pro: restore all coworkers.
            if old_plan.as_deref() != Some("pro") && new_plan == "pro" {
                let _ = crate::shared::repos::coworkers::enable_all(pool.inner()).await;
                let _ = app.emit("cloud:plan_upgraded", serde_json::json!({}));
            }

            Ok(CloudStatus {
                connected: true,
                active_provider: snap.active_provider,
                user: Some(me.user),
                providers: me.providers,
                plan: new_plan,
                last_synced,
                entitlements: Some(me.entitlements),
            })
        }
        Err(CloudError::NotAuthenticated) => {
            let _ = auth::clear(&state, pool.inner()).await;
            Ok(CloudStatus::default())
        }
        Err(_) => Ok(CloudStatus {
            connected: true,
            active_provider: snap.active_provider,
            user: snap.user_id.map(|id| CloudUser {
                user_id: id,
                email: None,
                display_name: None,
                first_name: None,
                last_name: None,
                avatar_url: None,
                slug: String::new(),
                created_at: None,
            }),
            providers: Vec::new(),
            plan: "free".into(),
            last_synced: Default::default(),
            entitlements: None,
        }),
    }
}

#[tauri::command]
pub fn cloud_github_login_url() -> String {
    auth::github_oauth_url()
}

#[tauri::command]
pub fn cloud_google_login_url() -> String {
    auth::google_oauth_url()
}

// ─── OAuth code exchange (deep-link → here) ─────────────────────────────────

#[tauri::command]
pub async fn cloud_exchange_code(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    provider: String,
    code: String,
) -> Result<CloudStatus, String> {
    match provider.as_str() {
        "github" => {
            let resp = client::exchange_github(pool.inner(), &code).await?;
            let token = resp.token.clone().ok_or_else(|| "missing token".to_string())?;
            auth::store_github(&state, pool.inner(), &token, resp.user.user_id).await?;
            after_login(&app, pool.inner(), &state).await?;
            Ok(build_status(pool.inner(), &state, &resp).await)
        }
        "google" => {
            let resp = client::exchange_google(
                pool.inner(),
                &code,
                "https://clauge.in/auth/google-callback.html",
            )
            .await?;
            let id_token = resp.id_token.clone().ok_or_else(|| "missing id_token".to_string())?;
            auth::store_google(
                &state,
                pool.inner(),
                resp.token.as_deref(),
                resp.refresh.as_deref(),
                &id_token,
                resp.user.user_id,
            )
            .await?;
            after_login(&app, pool.inner(), &state).await?;
            Ok(build_status(pool.inner(), &state, &resp).await)
        }
        _ => Err(format!("unknown provider: {}", provider)),
    }
}

// ─── Linking ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cloud_link_provider(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    provider: String,
    code: String,
) -> Result<CloudStatus, String> {
    let me = client::link(pool.inner(), &state, &provider, &code, None)
        .await
        .map_err(String::from)?;
    let snap = state.snapshot();
    Ok(CloudStatus {
        connected: true,
        active_provider: snap.active_provider,
        user: Some(me.user),
        providers: me.providers,
        plan: me.plan,
        last_synced: Default::default(),
        entitlements: Some(me.entitlements),
    })
}

#[tauri::command]
pub async fn cloud_update_profile(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    display_name: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
) -> Result<CloudStatus, String> {
    let me = client::update_profile(pool.inner(), &state, display_name, first_name, last_name)
        .await
        .map_err(String::from)?;
    let snap = state.snapshot();
    Ok(CloudStatus {
        connected: true,
        active_provider: snap.active_provider,
        user: Some(me.user),
        providers: me.providers,
        plan: me.plan,
        last_synced: Default::default(),
        entitlements: Some(me.entitlements),
    })
}

#[tauri::command]
pub async fn cloud_unlink_provider(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    provider: String,
) -> Result<CloudStatus, String> {
    let me = client::unlink(pool.inner(), &state, &provider)
        .await
        .map_err(String::from)?;
    let snap = state.snapshot();
    Ok(CloudStatus {
        connected: true,
        active_provider: snap.active_provider,
        user: Some(me.user),
        providers: me.providers,
        plan: me.plan,
        last_synced: Default::default(),
        entitlements: Some(me.entitlements),
    })
}

// ─── Sync surface ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cloud_check_remote_exists(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<bool, String> {
    let rows = client::sync_state(pool.inner(), &state)
        .await
        .map_err(String::from)?;
    Ok(!rows.is_empty())
}

#[tauri::command]
pub async fn cloud_sync_push_now(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<Vec<String>, String> {
    let kinds: Vec<&str> = ALL_KINDS.iter().copied().collect();
    sync::push_all(pool.inner(), &state, &kinds).await
}

/// List kinds currently in conflict-locked state. Used by the resolver
/// UI to render the amber dot, the "Action Required (N)" label, and the
/// modal body.
#[tauri::command]
pub async fn cloud_get_conflicts(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<String>, String> {
    sync::conflicted_kinds(pool.inner()).await
}

/// Resolve all conflicts by force-pushing this device's data — the user
/// has picked "Keep my changes" in the resolver modal. Iterates all
/// conflicted kinds; any individual failure short-circuits.
#[tauri::command]
pub async fn cloud_resolve_keep_local(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    let kinds = sync::conflicted_kinds(pool.inner()).await?;
    for k in &kinds {
        sync::force_push_kind(pool.inner(), &state, k).await?;
    }
    Ok(())
}

/// Resolve all conflicts by adopting the remote — the user has picked
/// "Use other device's" in the resolver. Pulls each conflicted kind and
/// clears its conflict flag.
#[tauri::command]
pub async fn cloud_resolve_use_remote(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    let kinds = sync::conflicted_kinds(pool.inner()).await?;
    for k in &kinds {
        sync::resolve_use_remote(pool.inner(), &state, k).await?;
    }
    Ok(())
}

/// Lightweight remote-state check used by pull-on-focus: returns the
/// kinds where the server has moved past our last-known synced hash AND
/// local has no unpushed changes (safe to silently pull). Caller pulls
/// those, then re-emits cloud:synced for the frontend to refresh stamps.
#[tauri::command]
pub async fn cloud_pull_if_remote_newer(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<Vec<String>, String> {
    sync::pull_if_remote_newer(pool.inner(), &state).await
}

#[tauri::command]
pub async fn cloud_sync_restore(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<Vec<String>, String> {
    let pulled = sync::pull_all(pool.inner(), &state).await?;
    settings::upsert(pool.inner(), SETTINGS_KEY_HAS_SYNCED, "true")
        .await
        .map_err(|e| format!("mark synced: {}", e))?;
    Ok(pulled)
}

#[tauri::command]
pub async fn cloud_local_has_data(pool: State<'_, SqlitePool>) -> Result<bool, String> {
    sync::local_has_data(pool.inner()).await
}

// ─── Account management ───────────────────────────────────────────────────

#[tauri::command]
pub async fn cloud_logout(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    if let Some(s) = app.try_state::<Scheduler>() {
        s.disable_and_clear();
    }
    auth::clear(&state, pool.inner()).await
}

#[tauri::command]
pub async fn cloud_wipe_remote(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    client::sync_wipe(pool.inner(), &state)
        .await
        .map_err(String::from)?;
    cloud_logout(app, pool, state).await
}

#[tauri::command]
pub async fn cloud_delete_account(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    confirmation_slug: String,
) -> Result<(), String> {
    client::delete_account(pool.inner(), &state, &confirmation_slug)
        .await
        .map_err(String::from)?;
    cloud_logout(app.clone(), pool, state).await?;
    let _ = app.emit_to("main", "cloud:account-deleted", ());
    Ok(())
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/// After a successful login: enable the scheduler so subsequent mutations bump.
async fn after_login(
    app: &AppHandle,
    _pool: &SqlitePool,
    _state: &AuthState,
) -> Result<(), String> {
    if let Some(s) = app.try_state::<Scheduler>() {
        s.enable();
    }
    Ok(())
}

async fn build_status(
    pool: &SqlitePool,
    state: &AuthState,
    resp: &crate::cloud::models::AuthResponse,
) -> CloudStatus {
    let snap = state.snapshot();
    let mut last_synced = std::collections::HashMap::new();
    for k in ALL_KINDS {
        if let Ok(Some(s)) = settings::get_by_key(pool, &settings_key_synced_at(k)).await {
            last_synced.insert(k.to_string(), s.value);
        }
    }
    CloudStatus {
        connected: true,
        active_provider: snap.active_provider,
        user: Some(resp.user.clone()),
        providers: resp.providers.clone(),
        plan: resp.plan.clone(),
        last_synced,
        entitlements: Some(resp.entitlements.clone()),
    }
}

// ─── cloud billing + AI proxy wrappers ──────────────────────────────────────

#[tauri::command]
pub async fn cloud_get_pricing(
    pool: State<'_, SqlitePool>,
) -> Result<CloudPricing, String> {
    billing_client::get_pricing(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cloud_create_checkout(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    plan: String,
) -> Result<String, String> {
    let (token, provider) = state
        .active_token_and_provider()
        .ok_or_else(|| "not signed in".to_string())?;
    let resp = billing_client::create_checkout(pool.inner(), &token, &provider, &plan)
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.url)
}

#[tauri::command]
pub async fn cloud_open_portal(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<String, String> {
    let (token, provider) = state
        .active_token_and_provider()
        .ok_or_else(|| "not signed in".to_string())?;
    let resp = billing_client::create_portal_session(pool.inner(), &token, &provider)
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.url)
}

#[tauri::command]
pub async fn cloud_ai_balance(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
) -> Result<CloudAiBalance, String> {
    let (token, provider) = state
        .active_token_and_provider()
        .ok_or_else(|| "not signed in".to_string())?;
    ai_client::get_balance(pool.inner(), &token, &provider)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cloud_ai_usage(
    pool: State<'_, SqlitePool>,
    state: State<'_, AuthState>,
    limit: Option<u32>,
    before: Option<String>,
) -> Result<CloudAiUsage, String> {
    let (token, provider) = state
        .active_token_and_provider()
        .ok_or_else(|| "not signed in".to_string())?;
    ai_client::get_usage(pool.inner(), &token, &provider, limit, before.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Returns the active cloud bearer token + provider slug for the JS layer
/// to use when invoking ai_chat with provider = "clauge". Returns None if
/// the user isn't signed in.
#[tauri::command]
pub fn cloud_get_active_token(
    state: State<'_, AuthState>,
) -> Option<(String, String)> {
    state.active_token_and_provider()
}

