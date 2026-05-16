<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import {
        cloudConnected,
        cloudUser,
        cloudProviders,
        cloudPlan,
        syncing,
        setSyncing,
        setConnected,
        setDisconnected,
        lastSyncedByKind,
        setLastSyncedForKinds,
        markSynced,
        showSyncRestorePrompt,
        cloudConflicts,
        type Provider,
    } from "$lib/stores/cloud";
    import ConflictResolverModal from "$lib/components/cloud/ConflictResolverModal.svelte";

    let conflictResolverOpen = $state(false);
    import {
        cloudGetStatus,
        cloudGithubLoginUrl,
        cloudGoogleLoginUrl,
        cloudExchangeCode,
        cloudLinkProvider,
        cloudCheckRemoteExists,
        cloudUnlinkProvider,
        cloudLogout,
        cloudWipeRemote,
        cloudDeleteAccount,
        cloudSyncPushNow,
        cloudSyncRestore,
        cloudUpdateProfile,
    } from "$lib/commands/cloud";
    import { showToast } from "$lib/shared/primitives/toast";
    import { friendlyError } from "$lib/utils/errors";
    import Dropdown from "$lib/shared/primitives/Dropdown.svelte";
    import ConfirmDialog from "$lib/shared/primitives/ConfirmDialog.svelte";
    import { APP_EVENT } from "$lib/shared/constants/events";
    import { settings } from "$lib/stores/settings";

    let displayNameInput = $state("");
    let firstNameInput = $state("");
    let lastNameInput = $state("");
    let savingProfile = $state(false);
    let refreshing = $state(false);
    let linking = $state<Provider | null>(null);
    let signingIn = $state<Provider | null>(null);

    let confirmingWipe = $state(false);
    let confirmingDelete = $state(false);
    let deleteSlugInput = $state("");

    let menuOpen = $state(false);
    let menuAnchor: HTMLElement | null = $state(null);
    let confirmPull = $state(false);

    let now = $state(Date.now());
    let tickerId: ReturnType<typeof setInterval> | null = null;

    $effect(() => {
        const u = $cloudUser;
        if (u) {
            displayNameInput = u.displayName ?? "";
            firstNameInput = u.firstName ?? "";
            lastNameInput = u.lastName ?? "";
        }
    });

    async function handleOAuthCallback(e: Event) {
        if (!get(settings)["onboarding_complete"]) return;
        const detail = (e as CustomEvent<{ provider: Provider; code: string }>)
            .detail;
        if (!detail?.code || !detail?.provider) return;

        if (get(cloudConnected) && linking === detail.provider) {
            try {
                const s = await cloudLinkProvider(detail.provider, detail.code);
                if (s.user)
                    setConnected(s.user, s.providers, s.activeProvider, s.plan);
                showToast(`Linked ${detail.provider}`, "success");
            } catch (err) {
                showToast(friendlyError(err), "error");
            } finally {
                linking = null;
            }
            return;
        }

        if (signingIn !== detail.provider) return;
        try {
            const s = await cloudExchangeCode(detail.provider, detail.code);
            if (s.user) {
                setConnected(s.user, s.providers, s.activeProvider, s.plan);
                setLastSyncedForKinds(s.lastSynced);
                showToast(
                    `Connected as ${s.user.displayName || s.user.slug}`,
                    "success",
                );
            }
            try {
                const remoteHas = await cloudCheckRemoteExists();
                if (remoteHas) showSyncRestorePrompt.set(true);
                else markSynced();
            } catch {
                markSynced();
            }
        } catch (err) {
            showToast(friendlyError(err), "error");
        } finally {
            signingIn = null;
        }
    }

    onMount(() => {
        if (get(cloudConnected)) refreshStatus().catch(() => {});
        tickerId = setInterval(() => {
            now = Date.now();
        }, 30_000);
        window.addEventListener(APP_EVENT.OAUTH_CALLBACK, handleOAuthCallback);
    });
    onDestroy(() => {
        if (tickerId) clearInterval(tickerId);
        window.removeEventListener(
            APP_EVENT.OAUTH_CALLBACK,
            handleOAuthCallback,
        );
    });

    async function refreshStatus() {
        refreshing = true;
        try {
            const s = await cloudGetStatus();
            if (s.user) {
                setConnected(s.user, s.providers, s.activeProvider, s.plan);
                setLastSyncedForKinds(s.lastSynced);
            }
        } catch (e) {
            showToast(friendlyError(e), "error");
        } finally {
            refreshing = false;
        }
    }

    function profileChanged(): boolean {
        const u = $cloudUser;
        if (!u) return false;
        return (
            displayNameInput.trim() !== (u.displayName ?? "") ||
            firstNameInput.trim() !== (u.firstName ?? "") ||
            lastNameInput.trim() !== (u.lastName ?? "")
        );
    }

    async function saveProfile() {
        if (savingProfile) return;
        savingProfile = true;
        try {
            const s = await cloudUpdateProfile({
                displayName: displayNameInput.trim(),
                firstName: firstNameInput.trim(),
                lastName: lastNameInput.trim(),
            });
            if (s.user)
                setConnected(s.user, s.providers, s.activeProvider, s.plan);
            showToast("Profile updated", "success");
        } catch (e) {
            showToast(friendlyError(e), "error");
        } finally {
            savingProfile = false;
        }
    }

    async function openOAuth(provider: Provider) {
        try {
            const url =
                provider === "github"
                    ? await cloudGithubLoginUrl()
                    : await cloudGoogleLoginUrl();
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(url);
        } catch (e) {
            showToast(friendlyError(e), "error");
            signingIn = null;
            linking = null;
        }
    }

    async function signIn(provider: Provider) {
        signingIn = provider;
        await openOAuth(provider);
    }

    async function linkAdditional(provider: Provider) {
        linking = provider;
        await openOAuth(provider);
    }

    async function unlink(provider: Provider) {
        try {
            const s = await cloudUnlinkProvider(provider);
            if (s.user)
                setConnected(s.user, s.providers, s.activeProvider, s.plan);
            showToast(`Unlinked ${provider}`, "info");
        } catch (e) {
            showToast(friendlyError(e), "error");
        }
    }

    async function signOut() {
        try {
            await cloudLogout();
            setDisconnected();
            showToast("Signed out", "info");
        } catch (e) {
            showToast(friendlyError(e), "error");
        }
    }

    async function syncNow() {
        if ($syncing) return;
        setSyncing(true);
        const startedAt = Date.now();
        try {
            const pushed = await cloudSyncPushNow();
            try {
                const s = await cloudGetStatus();
                if (s.user) {
                    setConnected(s.user, s.providers, s.activeProvider, s.plan);
                    setLastSyncedForKinds(s.lastSynced);
                }
            } catch {
                /* non-fatal */
            }
            const elapsed = Date.now() - startedAt;
            if (elapsed < 350)
                await new Promise((r) => setTimeout(r, 350 - elapsed));
            showToast(
                pushed.length ? "Synced" : "Already up to date",
                "success",
            );
        } catch (e) {
            showToast(friendlyError(e), "error");
        } finally {
            setSyncing(false);
        }
    }

    async function pullFromCloud() {
        if ($syncing) return;
        setSyncing(true);
        try {
            await cloudSyncRestore();
            const [r, s, n] = await Promise.all([
                import("$lib/modes/rest/stores"),
                import("$lib/modes/sql/stores"),
                import("$lib/modes/nosql/stores"),
            ]);
            await Promise.all([
                r.loadCollections(),
                r.loadEnvironments(),
                s.loadConnections(),
                s.loadSqlScripts(),
                n.loadNoSqlConnections(),
            ]);
            const { announceRestoreCompletion } = await import(
                "$lib/stores/missingCredentials"
            );
            const shown = await announceRestoreCompletion();
            if (!shown) showToast("Restored from cloud", "success");
        } catch (e) {
            showToast(friendlyError(e), "error");
        } finally {
            setSyncing(false);
        }
    }

    async function wipeRemote() {
        try {
            await cloudWipeRemote();
            setDisconnected();
            showToast("Cloud data wiped — local data intact", "success");
            confirmingWipe = false;
        } catch (e) {
            showToast(friendlyError(e), "error");
        }
    }

    async function deleteAccount() {
        const expected = $cloudUser?.slug ?? "";
        if (deleteSlugInput.trim() !== expected) {
            showToast("Type your handle exactly to confirm", "error");
            return;
        }
        try {
            await cloudDeleteAccount(deleteSlugInput.trim());
            setDisconnected();
            showToast("Account deleted — local data intact", "success");
            confirmingDelete = false;
            deleteSlugInput = "";
        } catch (e) {
            showToast(friendlyError(e), "error");
        }
    }

    function providerLinked(p: Provider): boolean {
        return $cloudProviders.some((x) => x.provider === p);
    }

    // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" with no timezone — actually
    // UTC, but JS treats unmarked strings as local. Append Z so the diff is right.
    function parseServerTime(s: string | undefined): number {
        if (!s) return 0;
        const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
        return new Date(hasTz ? s : s.replace(" ", "T") + "Z").getTime();
    }

    let lastSyncOverall = $derived.by(() => {
        void now;
        let max = 0;
        for (const v of Object.values($lastSyncedByKind)) {
            const t = parseServerTime(v as string | undefined);
            if (t > max) max = t;
        }
        if (!max) return null;
        const diff = Math.max(0, Date.now() - max);
        if (diff < 60_000) return "just now";
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
        return new Date(max).toLocaleDateString();
    });

    function copyHandle() {
        const slug = $cloudUser?.slug ?? "";
        if (!slug) return;
        try {
            navigator.clipboard.writeText(`@${slug}`);
            showToast("Handle copied", "info");
        } catch {
            showToast("Could not copy", "error");
        }
    }

    function openUpgrade() {
        showToast("Pro plan — coming soon", "info");
    }

    function openMenu(e: MouseEvent) {
        menuAnchor = e.currentTarget as HTMLElement;
        menuOpen = true;
    }

    let menuItems = $derived([
        {
            label: refreshing ? "Refreshing…" : "Refresh status",
            action: () => {
                refreshStatus();
            },
        },
        {
            label: "Pull from cloud",
            action: () => {
                confirmPull = true;
            },
        },
        {
            label: "Copy handle",
            action: () => {
                copyHandle();
            },
        },
        { separator: true, label: "", action: () => {} },
        {
            label: "Sign out",
            action: () => {
                signOut();
            },
            danger: true,
        },
    ]);

    // Profile avatar can 404 / time out (network down, image expired,
    // host blocked). Without this guard the <img> renders as the broken-
    // image glyph; we'd rather fall back to the initial-letter avatar.
    // Reset on URL change so a retry works after the network recovers.
    let acc_avatar_failed = $state(false);
    $effect(() => {
        const _ = $cloudUser?.avatarUrl;
        acc_avatar_failed = false;
    });
</script>

<div class="acc-pane">
    <header class="acc-page-head">
        <h1>Account settings</h1>
        <p>Manage your profile and preferences</p>
    </header>

    {#if !$cloudConnected}
        <!-- Signed-out: cloud sign-in card -->
        <section class="acc-signin">
            <div class="acc-signin-icon" aria-hidden="true">
                <svg
                    viewBox="0 0 24 24"
                    width="32"
                    height="32"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M20 16.58A5 5 0 0018 7h-1.26A8 8 0 104 15.25" />
                    <polyline points="16 16 12 12 8 16" />
                    <line x1="12" y1="12" x2="12" y2="21" />
                </svg>
            </div>
            <h2>Sign in to Clauge cloud</h2>
            <p class="acc-signin-sub">
                Sync your work across every device, automatically.
            </p>

            <!-- <ul class="acc-signin-features">
        <li><span class="acc-bullet"></span>REST collections &amp; saved queries</li>
        <li><span class="acc-bullet"></span>SQL &amp; NoSQL connections</li>
        <li><span class="acc-bullet"></span>SSH profiles &amp; agents</li>
      </ul> -->

            <div class="acc-signin-buttons">
                <button
                    class="acc-oauth-btn"
                    onclick={() => signIn("github")}
                    disabled={!!signingIn}
                >
                    {#if signingIn === "github"}
                        <span class="acc-spinner acc-spinner-light"></span>
                    {:else}
                        <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            width="15"
                            height="15"
                            ><path
                                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                            /></svg
                        >
                    {/if}
                    <span>Continue with GitHub</span>
                </button>
                <button
                    class="acc-oauth-btn"
                    onclick={() => signIn("google")}
                    disabled={!!signingIn}
                >
                    {#if signingIn === "google"}
                        <span class="acc-spinner acc-spinner-light"></span>
                    {:else}
                        <svg viewBox="0 0 24 24" width="15" height="15"
                            ><path
                                d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.32z"
                                fill="#4285F4"
                            /><path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                            /><path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                            /><path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                            /></svg
                        >
                    {/if}
                    <span>Continue with Google</span>
                </button>
            </div>

            {#if signingIn}
                <div class="acc-waiting">
                    <span class="acc-spinner acc-spinner-light"></span>
                    <span class="acc-waiting-text"
                        >Waiting for {signingIn === "github"
                            ? "GitHub"
                            : "Google"} authorization in your browser…</span
                    >
                    <button
                        class="acc-waiting-cancel"
                        onclick={() => (signingIn = null)}>Cancel</button
                    >
                </div>
            {/if}

            <hr class="acc-signin-sep" />
            <p class="acc-signin-fine">
                We only request your basic profile — no access to your repos,
                files, or email content.
            </p>
        </section>
    {:else if $cloudUser}
        <div class="acc-stack">
            <!-- Profile card -->
            <section class="acc-card">
                <div class="acc-card-head">
                    <h3 class="acc-card-title">Profile</h3>
                    <div class="acc-sync-controls">
                        <div class="acc-sync-status">
                            <span class="acc-sync-label">Last sync</span>
                            <span class="acc-sync-value"
                                >{lastSyncOverall ?? "Never"}</span
                            >
                        </div>
                        {#if $cloudConflicts.length > 0}
                            <!-- Conflict-mode replacement for the Sync
                                 button — same slot, accent-tinted, opens
                                 the resolver instead of pushing. -->
                            <button
                                class="acc-sync-btn acc-sync-btn-action"
                                onclick={() => (conflictResolverOpen = true)}
                                title="Resolve sync conflicts"
                            >
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span>Action Required ({$cloudConflicts.length})</span>
                            </button>
                        {:else}
                            <button
                                class="acc-sync-btn"
                                onclick={syncNow}
                                disabled={$syncing}
                                title="Sync now"
                            >
                                {#if $syncing}
                                    <span
                                        class="acc-spinner acc-spinner-light acc-spinner-tiny"
                                    ></span>
                                {:else}
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="13"
                                        height="13"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path d="M23 4v6h-6" />
                                        <path d="M1 20v-6h6" />
                                        <path
                                            d="M3.51 9a9 9 0 0114.85-3.36L23 10"
                                        />
                                        <path
                                            d="M1 14l4.64 4.36A9 9 0 0020.49 15"
                                        />
                                    </svg>
                                {/if}
                                <span>{$syncing ? "Syncing…" : "Sync"}</span>
                            </button>
                        {/if}
                        <button
                            class="acc-kebab-btn"
                            onclick={openMenu}
                            title="More options"
                            aria-label="Account menu"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="currentColor"
                                ><circle cx="5" cy="12" r="1.7" /><circle
                                    cx="12"
                                    cy="12"
                                    r="1.7"
                                /><circle cx="19" cy="12" r="1.7" /></svg
                            >
                        </button>
                    </div>
                </div>

                <div class="acc-profile-row">
                    {#if $cloudUser.avatarUrl && !acc_avatar_failed}
                        <img
                            class="acc-avatar"
                            src={$cloudUser.avatarUrl}
                            alt=""
                            referrerpolicy="no-referrer"
                            onerror={() => (acc_avatar_failed = true)}
                        />
                    {:else}
                        <div class="acc-avatar acc-avatar-fallback">
                            {($cloudUser.displayName ?? $cloudUser.slug)
                                .charAt(0)
                                .toUpperCase()}
                        </div>
                    {/if}
                    <div class="acc-profile-text">
                        <div class="acc-profile-name">
                            {$cloudUser.displayName ?? $cloudUser.slug}
                        </div>
                        <div class="acc-profile-email">@{$cloudUser.slug}</div>
                        <div class="acc-profile-meta">
                            <span
                                class="acc-plan-pill"
                                class:is-pro={$cloudPlan === "pro"}
                            >
                                {$cloudPlan === "pro" ? "Pro" : "Free"}
                            </span>
                            {#if $cloudUser.email}
                                <span
                                    class="acc-handle-pill"
                                    title="Provider handle"
                                    >@{$cloudUser.slug}</span
                                >
                            {/if}
                        </div>
                    </div>
                </div>

                <div class="acc-fields">
                    <label class="acc-field">
                        <span class="acc-field-label">Display name</span>
                        <input
                            type="text"
                            bind:value={displayNameInput}
                            maxlength="120"
                        />
                    </label>
                    <div class="acc-field-row">
                        <label class="acc-field">
                            <span class="acc-field-label">First name</span>
                            <input
                                type="text"
                                bind:value={firstNameInput}
                                maxlength="80"
                            />
                        </label>
                        <label class="acc-field">
                            <span class="acc-field-label">Last name</span>
                            <input
                                type="text"
                                bind:value={lastNameInput}
                                maxlength="80"
                            />
                        </label>
                    </div>
                    <div class="acc-fields-footer">
                        <p class="acc-fine"></p>
                        <button
                            class="acc-btn acc-btn-primary"
                            onclick={saveProfile}
                            disabled={!profileChanged() || savingProfile}
                        >
                            {#if savingProfile}<span
                                    class="acc-spinner acc-spinner-light acc-spinner-tiny"
                                ></span>{/if}
                            <span
                                >{savingProfile
                                    ? "Saving…"
                                    : "Save changes"}</span
                            >
                        </button>
                    </div>
                </div>
            </section>

            <!-- Linked accounts -->
            <section class="acc-card">
                <h3 class="acc-card-title acc-card-title-solo">
                    Linked accounts
                </h3>
                {#each ["github", "google"] as p}
                    {@const linked = providerLinked(p as Provider)}
                    {@const meta = linked
                        ? $cloudProviders.find((x) => x.provider === p)
                        : null}
                    <div class="acc-prov-row">
                        <span
                            class="acc-prov-icon"
                            class:gh={p === "github"}
                            class:gg={p === "google"}
                        >
                            {#if p === "github"}
                                <svg
                                    viewBox="0 0 16 16"
                                    fill="currentColor"
                                    width="16"
                                    height="16"
                                    ><path
                                        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
                                    /></svg
                                >
                            {:else}
                                <svg viewBox="0 0 24 24" width="16" height="16"
                                    ><path
                                        d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.32z"
                                        fill="#4285F4"
                                    /><path
                                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                        fill="#34A853"
                                    /><path
                                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09 0-.73.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                        fill="#FBBC05"
                                    /><path
                                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                        fill="#EA4335"
                                    /></svg
                                >
                            {/if}
                        </span>
                        <div class="acc-prov-text">
                            <span class="acc-prov-name"
                                >{p === "github" ? "GitHub" : "Google"}</span
                            >
                            {#if linked}
                                <span class="acc-prov-sub"
                                    >{meta?.providerLogin ??
                                        meta?.email ??
                                        ""}</span
                                >
                            {:else}
                                <span class="acc-prov-sub acc-prov-empty"
                                    >Not linked</span
                                >
                            {/if}
                        </div>
                        {#if linked}
                            {#if $cloudProviders.length > 1}
                                <button
                                    class="acc-mini-btn"
                                    onclick={() => unlink(p as Provider)}
                                    >Unlink</button
                                >
                            {:else}
                                <span class="acc-prov-primary"
                                    ><span class="acc-primary-dot"
                                    ></span>primary</span
                                >
                            {/if}
                        {:else}
                            <button
                                class="acc-mini-btn acc-mini-link"
                                onclick={() => linkAdditional(p as Provider)}
                                disabled={linking === p}
                            >
                                {#if linking === p}<span
                                        class="acc-spinner acc-spinner-light acc-spinner-tiny"
                                    ></span>{/if}
                                <span
                                    >{linking === p ? "Opening…" : "Link"}</span
                                >
                            </button>
                        {/if}
                    </div>
                {/each}
            </section>

            <!-- Subscription -->
            <section class="acc-card">
                <h3 class="acc-card-title acc-card-title-solo">Subscription</h3>
                <div class="acc-sub-row">
                    <div>
                        <div class="acc-sub-line">
                            <strong
                                >{$cloudPlan === "pro"
                                    ? "Pro plan"
                                    : "Free plan"}</strong
                            >
                            <span class="acc-current-pill">Current</span>
                        </div>
                        <p class="acc-sub-body">
                            {$cloudPlan === "pro"
                                ? "Pro features are enabled on this account."
                                : "Upgrade to unlock Pro features."}
                        </p>
                    </div>
                    <button
                        class="acc-btn acc-btn-primary"
                        onclick={openUpgrade}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            width="13"
                            height="13"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2.2"
                            stroke-linejoin="round"
                            ><path
                                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                            /></svg
                        >
                        <span
                            >{$cloudPlan === "pro"
                                ? "Manage"
                                : "See Pro pricing"}</span
                        >
                    </button>
                </div>
            </section>

            <!-- Danger zone -->
            <section class="acc-card acc-card-danger">
                <h3 class="acc-card-title acc-card-title-solo acc-danger-title">
                    Danger zone
                </h3>
                {#if !confirmingWipe && !confirmingDelete}
                    <div class="acc-danger-row">
                        <div>
                            <strong>Wipe cloud data</strong>
                            <p>
                                Removes synced data from our servers. Your
                                account stays, local data stays — you can
                                re-push anytime.
                            </p>
                        </div>
                        <button
                            class="acc-danger-btn"
                            onclick={() => (confirmingWipe = true)}
                            >Wipe data</button
                        >
                    </div>
                    <div class="acc-danger-row">
                        <div>
                            <strong>Delete account</strong>
                            <p>
                                Permanently removes your Clauge account, all
                                linked providers, and cloud data. Cannot be
                                undone.
                            </p>
                        </div>
                        <button
                            class="acc-danger-btn acc-danger-strong"
                            onclick={() => (confirmingDelete = true)}
                            >Delete account</button
                        >
                    </div>
                {/if}
                {#if confirmingWipe}
                    <div class="acc-confirm">
                        <p>
                            This deletes synced data from our servers. Your
                            local data stays. Confirm?
                        </p>
                        <div class="acc-confirm-row">
                            <button
                                class="acc-btn acc-btn-ghost"
                                onclick={() => (confirmingWipe = false)}
                                >Cancel</button
                            >
                            <button class="acc-danger-btn" onclick={wipeRemote}
                                >Yes, wipe cloud data</button
                            >
                        </div>
                    </div>
                {/if}
                {#if confirmingDelete}
                    <div class="acc-confirm">
                        <p>
                            This permanently removes your Clauge account. Type
                            your handle <code>{$cloudUser.slug}</code> to confirm:
                        </p>
                        <input
                            class="acc-confirm-input"
                            bind:value={deleteSlugInput}
                            placeholder={$cloudUser.slug}
                        />
                        <div class="acc-confirm-row">
                            <button
                                class="acc-btn acc-btn-ghost"
                                onclick={() => {
                                    confirmingDelete = false;
                                    deleteSlugInput = "";
                                }}>Cancel</button
                            >
                            <button
                                class="acc-danger-btn acc-danger-strong"
                                onclick={deleteAccount}
                                disabled={deleteSlugInput.trim() !==
                                    $cloudUser.slug}>Delete account</button
                            >
                        </div>
                    </div>
                {/if}
            </section>
        </div>
    {/if}
</div>

<Dropdown
    bind:show={menuOpen}
    anchor={menuAnchor}
    items={menuItems}
    onclose={() => (menuOpen = false)}
/>

<ConfirmDialog
    bind:show={confirmPull}
    title="Pull from cloud?"
    message="This overwrites local collections, connections, queries, agents, SSH profiles, and explorer paths with the latest from cloud. Local-only items that haven't been pushed yet will be lost."
    confirmText="Pull from cloud"
    confirmColor="var(--acc)"
    onconfirm={() => {
        confirmPull = false;
        pullFromCloud();
    }}
    oncancel={() => {
        confirmPull = false;
    }}
/>

<ConflictResolverModal bind:show={conflictResolverOpen} />

<style>
    .acc-pane {
        padding: 4px 2px 12px;
        font-family: var(--ui);
    }

    /* ── Page header ──────────────────────────────────────────────── */
    .acc-page-head {
        margin: 4px 0 22px;
    }
    .acc-page-head h1 {
        font-size: 20px;
        font-weight: 600;
        color: var(--t1);
        margin: 0 0 4px;
        letter-spacing: -0.01em;
    }
    .acc-page-head p {
        font-size: 12.5px;
        color: var(--t3);
        margin: 0;
    }

    /* ── Signed-out sign-in card ──────────────────────────────────── */
    .acc-signin {
        max-width: 500px;
        margin: 18px auto 24px;
        padding: 32px 36px 28px;
        text-align: center;
        border: 1px solid var(--b1);
        border-radius: 14px;
        background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.025),
            rgba(255, 255, 255, 0.005)
        );
    }
    .acc-signin-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 14px;
        background: linear-gradient(135deg, #2dd4bf, #3b82f6);
        color: #fff;
        box-shadow: 0 8px 22px -6px rgba(59, 130, 246, 0.5);
    }
    .acc-signin h2 {
        font-size: 19px;
        font-weight: 600;
        color: var(--t1);
        margin: 0 0 6px;
        letter-spacing: -0.01em;
    }
    .acc-signin-sub {
        font-size: 13px;
        color: var(--t3);
        line-height: 1.55;
        margin: 0 0 22px;
    }
    .acc-signin-features {
        list-style: none;
        padding: 0;
        margin: 0 auto 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
        max-width: 280px;
        font-size: 12.5px;
        color: var(--t2);
    }
    .acc-signin-features li {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .acc-bullet {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--acc);
        flex-shrink: 0;
    }
    .acc-signin-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 320px;
        margin: 0 auto 14px;
    }
    .acc-oauth-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 11px 16px;
        border-radius: 8px;
        font-family: var(--ui);
        font-size: 13px;
        font-weight: 500;
        cursor: default;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        color: var(--t1);
        transition:
            background 0.14s,
            border-color 0.14s,
            opacity 0.14s,
            transform 0.08s;
        min-height: 42px;
    }
    .acc-oauth-btn:active:not(:disabled) {
        transform: translateY(1px);
    }
    .acc-oauth-btn:hover:not(:disabled) {
        background: var(--surface-hover);
        border-color: var(--b2);
    }
    .acc-oauth-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .acc-waiting {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 4px auto 0;
        padding: 9px 14px;
        border-radius: 8px;
        background: var(--surface-hover);
        border: 1px solid var(--b1);
        color: var(--t2);
        font-size: 12px;
        max-width: 320px;
    }
    .acc-waiting-text {
        flex: 1;
        text-align: left;
        line-height: 1.4;
    }
    .acc-waiting-cancel {
        border: none;
        background: transparent;
        cursor: default;
        color: var(--acc);
        font-size: 12px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: var(--ui);
    }
    .acc-waiting-cancel:hover {
        background: rgba(29, 200, 128, 0.12);
    }

    .acc-signin-sep {
        margin: 22px 0 14px;
        border: none;
        border-top: 1px solid var(--b1);
    }
    .acc-signin-fine {
        font-size: 11.5px;
        color: var(--t3);
        line-height: 1.55;
        margin: 0;
    }

    /* ── Signed-in stack ──────────────────────────────────────────── */
    .acc-stack {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .acc-card {
        padding: 16px 18px;
        border: 1px solid var(--b1);
        border-radius: 10px;
        background: var(--surface-hover);
    }
    .acc-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
    }
    .acc-card-title {
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 600;
        color: var(--t3);
        margin: 0;
        padding-top: 4px;
    }
    .acc-card-title-solo {
        margin-bottom: 12px;
    }
    .acc-danger-title {
        color: #f04444;
    }

    /* Sync controls on Profile card header */
    .acc-sync-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }
    .acc-sync-status {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        line-height: 1.25;
        margin-right: 4px;
    }
    .acc-sync-label {
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--t3);
        font-weight: 500;
    }
    .acc-sync-value {
        font-size: 11.5px;
        color: var(--t2);
        font-variant-numeric: tabular-nums;
    }
    .acc-sync-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 11px;
        font-size: 12px;
        font-weight: 500;
        font-family: var(--ui);
        border-radius: 6px;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        color: var(--t1);
        cursor: default;
        transition:
            background 0.14s,
            border-color 0.14s,
            opacity 0.14s;
    }
    .acc-sync-btn:hover:not(:disabled) {
        background: var(--surface-hover);
        border-color: var(--b2);
    }
    .acc-sync-btn:disabled {
        opacity: 0.55;
    }
    .acc-sync-btn svg {
        flex-shrink: 0;
    }
    /* "Action Required" variant — accent-tinted, opens the resolver. */
    .acc-sync-btn-action {
        background: color-mix(in srgb, var(--acc) 14%, transparent);
        border-color: color-mix(in srgb, var(--acc) 35%, transparent);
        color: var(--acc);
        font-weight: 600;
    }
    .acc-sync-btn-action:hover {
        background: color-mix(in srgb, var(--acc) 22%, transparent);
        border-color: color-mix(in srgb, var(--acc) 50%, transparent);
    }
    .acc-sync-btn-action svg { stroke: var(--acc); }
    .acc-kebab-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        color: var(--t3);
        cursor: default;
        transition:
            background 0.14s,
            color 0.14s,
            border-color 0.14s;
    }
    .acc-kebab-btn:hover {
        color: var(--t1);
        background: var(--surface-hover);
        border-color: var(--b2);
    }

    /* Profile body */
    .acc-profile-row {
        display: flex;
        gap: 16px;
        align-items: center;
        margin-bottom: 22px;
    }
    .acc-avatar {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .acc-avatar-fallback {
        background: linear-gradient(135deg, #f97316, #ec4899);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 24px;
        font-weight: 600;
    }
    .acc-profile-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
    }
    .acc-profile-name {
        font-size: 17px;
        font-weight: 600;
        color: var(--t1);
        letter-spacing: -0.01em;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .acc-profile-email {
        font-size: 12.5px;
        color: var(--t3);
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .acc-profile-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
    }
    .acc-plan-pill {
        font-size: 10px;
        padding: 3px 9px;
        border-radius: 999px;
        background: var(--surface-hover);
        color: var(--t2);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .acc-plan-pill.is-pro {
        background: linear-gradient(120deg, var(--acc), #1dc880);
        color: #fff;
    }
    .acc-handle-pill {
        font-size: 10.5px;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(45, 212, 191, 0.1);
        color: #2dd4bf;
        font-family: var(--mono, ui-monospace);
        border: 1px solid rgba(45, 212, 191, 0.18);
    }

    /* Fields */
    .acc-fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .acc-field {
        display: flex;
        flex-direction: column;
        gap: 5px;
        flex: 1;
    }
    .acc-field-label {
        font-size: 11px;
        color: var(--t3);
        font-weight: 500;
        letter-spacing: 0.04em;
    }
    .acc-field input {
        padding: 9px 12px;
        font-size: 13px;
        border: 1px solid var(--b1);
        border-radius: 7px;
        background: rgba(0, 0, 0, 0.25);
        color: var(--t1);
        font-family: var(--ui);
    }
    .acc-field input:focus {
        outline: none;
        border-color: var(--acc);
    }
    .acc-field-row {
        display: flex;
        gap: 12px;
    }
    .acc-fields-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 6px;
    }
    .acc-fields-footer .acc-fine {
        margin: 0;
        flex: 1;
        max-width: 380px;
    }

    /* Generic buttons */
    .acc-btn {
        padding: 9px 16px;
        font-size: 12.5px;
        font-weight: 500;
        border-radius: 7px;
        border: 1px solid var(--b1);
        background: transparent;
        color: var(--t1);
        cursor: default;
        transition:
            background 0.14s,
            border-color 0.14s,
            opacity 0.14s;
        font-family: var(--ui);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
    }
    .acc-btn:hover:not(:disabled) {
        background: var(--surface-hover);
        border-color: var(--b2);
    }
    .acc-btn:disabled {
        opacity: 0.5;
    }
    .acc-btn-primary {
        background: var(--acc);
        border-color: transparent;
        color: #fff;
    }
    .acc-btn-primary:hover:not(:disabled) {
        opacity: 0.92;
        background: var(--acc);
    }
    .acc-btn-ghost {
        border-color: transparent;
        color: var(--t3);
    }
    .acc-btn-ghost:hover:not(:disabled) {
        color: var(--t1);
        background: var(--surface-hover);
    }

    .acc-fine {
        font-size: 11.5px;
        color: var(--t3);
        line-height: 1.55;
        margin: 6px 0 0;
    }
    .acc-fine-quiet {
        margin-top: 10px;
    }

    /* Linked accounts */
    .acc-prov-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        border: 1px solid var(--b1);
        margin-bottom: 8px;
        font-size: 12.5px;
        background: var(--surface-hover);
    }
    .acc-prov-row:last-child {
        margin-bottom: 0;
    }
    .acc-prov-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        flex-shrink: 0;
    }
    .acc-prov-icon.gh {
        background: #1a1c20;
        color: #fff;
    }
    .acc-prov-icon.gg {
        background: #fff;
    }
    .acc-prov-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }
    .acc-prov-name {
        font-weight: 600;
        color: var(--t1);
        font-size: 13px;
        line-height: 1.2;
    }
    .acc-prov-sub {
        font-size: 11.5px;
        color: var(--t3);
        font-family: var(--mono, ui-monospace);
        line-height: 1.3;
    }
    .acc-prov-empty {
        font-style: italic;
        font-family: var(--ui);
    }
    .acc-prov-primary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--t3);
        font-style: italic;
    }
    .acc-primary-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22c55e;
        flex-shrink: 0;
    }
    .acc-mini-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        font-size: 11.5px;
        border-radius: 6px;
        border: 1px solid var(--b1);
        background: var(--surface-hover);
        color: var(--t2);
        cursor: default;
        font-family: var(--ui);
    }
    .acc-mini-btn:hover:not(:disabled) {
        background: var(--surface-hover);
        color: var(--t1);
        border-color: var(--b2);
    }
    .acc-mini-link {
        color: var(--t1);
    }

    /* Subscription */
    .acc-sub-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    .acc-sub-row > div {
        flex: 1;
        min-width: 0;
    }
    .acc-sub-line {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
    }
    .acc-sub-line strong {
        font-size: 14px;
        color: var(--t1);
        font-weight: 600;
    }
    .acc-current-pill {
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--surface-hover);
        color: var(--t3);
        font-weight: 600;
    }
    .acc-sub-body {
        font-size: 12.5px;
        color: var(--t2);
        line-height: 1.55;
        margin: 0;
        max-width: 480px;
    }

    /* Danger zone */
    .acc-card-danger {
        border-color: rgba(240, 68, 68, 0.18);
    }
    .acc-danger-row {
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px 0;
        border-top: 1px solid var(--b1);
    }
    .acc-danger-row:first-of-type {
        border-top: none;
        padding-top: 4px;
    }
    .acc-danger-row > div {
        flex: 1;
    }
    .acc-danger-row strong {
        font-size: 13px;
        color: var(--t1);
        font-weight: 600;
    }
    .acc-danger-row p {
        font-size: 12px;
        color: var(--t3);
        line-height: 1.55;
        margin: 4px 0 0;
    }
    .acc-danger-btn {
        padding: 8px 14px;
        font-size: 12px;
        border-radius: 7px;
        border: 1px solid rgba(240, 68, 68, 0.3);
        background: transparent;
        color: #f04444;
        cursor: default;
        white-space: nowrap;
        font-family: var(--ui);
        font-weight: 500;
    }
    .acc-danger-btn:hover:not(:disabled) {
        background: rgba(240, 68, 68, 0.08);
    }
    .acc-danger-strong {
        border-color: #f04444;
    }

    .acc-confirm {
        margin-top: 10px;
        padding: 14px;
        border-radius: 8px;
        border: 1px solid rgba(240, 68, 68, 0.3);
        background: rgba(240, 68, 68, 0.04);
        font-size: 12.5px;
        color: var(--t2);
    }
    .acc-confirm p {
        margin: 0 0 10px;
        line-height: 1.55;
    }
    .acc-confirm p code {
        font-family: var(--mono, ui-monospace);
        color: var(--t1);
    }
    .acc-confirm-input {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 4px;
        border: 1px solid var(--b1);
        background: rgba(0, 0, 0, 0.25);
        color: var(--t1);
        font-family: var(--ui);
        font-size: 12.5px;
        margin-bottom: 10px;
    }
    .acc-confirm-row {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }

    /* Spinners */
    .acc-spinner {
        display: inline-block;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-right-color: transparent;
        animation: acc-spin 0.7s linear infinite;
        flex-shrink: 0;
    }
    .acc-spinner-tiny {
        width: 11px;
        height: 11px;
        border-width: 1.8px;
    }
    .acc-spinner-light {
        color: var(--t1);
    }
    @keyframes acc-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
