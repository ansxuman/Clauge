use sqlx::sqlite::SqlitePool;
use std::collections::HashSet;

use super::models::{CanvasRegion, CanvasTile, CanvasViewport, TabRef, TileGeometryUpdate};

const DEFAULT_TILE_WIDTH: f64 = 720.0;
const DEFAULT_TILE_HEIGHT: f64 = 480.0;
const CASCADE_STEP: f64 = 40.0;
const CASCADE_BASE: f64 = 80.0;
const CASCADE_WRAP: usize = 5;

const TILE_SELECT: &str = "SELECT workspace_id, tab_id, tab_kind, x, y, width, height,
                                  z_order, minimized, region_id, created_at, updated_at
                             FROM canvas_tiles";

const REGION_SELECT: &str = "SELECT workspace_id, region_id, name, x, y, width, height,
                                    color, z_order, created_at, updated_at
                               FROM canvas_regions";

/// Read all tile rows for a workspace, ordered by z_order.
pub async fn list_tiles(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<CanvasTile>, sqlx::Error> {
    sqlx::query_as::<_, CanvasTile>(
        &format!("{} WHERE workspace_id = ? ORDER BY z_order", TILE_SELECT)
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

/// Reconcile tile rows against the frontend-provided open-tab list.
/// Inserts missing tiles with cascade-layout positions, deletes
/// tile rows whose tab is no longer in the open-tab list, returns
/// the final tile set.
pub async fn resolve_tiles(
    pool: &SqlitePool,
    workspace_id: &str,
    open_tab_refs: &[TabRef],
) -> Result<Vec<CanvasTile>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let existing = sqlx::query_as::<_, CanvasTile>(
        &format!("{} WHERE workspace_id = ?", TILE_SELECT)
    )
    .bind(workspace_id)
    .fetch_all(&mut *tx)
    .await?;

    let open_keys: HashSet<(String, String)> = open_tab_refs
        .iter()
        .map(|r| (r.tab_kind.clone(), r.tab_id.clone()))
        .collect();
    let existing_keys: HashSet<(String, String)> = existing
        .iter()
        .map(|t| (t.tab_kind.clone(), t.tab_id.clone()))
        .collect();

    // Delete orphan tiles
    for (kind, id) in existing_keys.difference(&open_keys) {
        sqlx::query(
            "DELETE FROM canvas_tiles
              WHERE workspace_id = ? AND tab_kind = ? AND tab_id = ?",
        )
        .bind(workspace_id)
        .bind(kind)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }

    // Insert missing tiles with cascade layout
    let missing: Vec<&TabRef> = open_tab_refs
        .iter()
        .filter(|r| !existing_keys.contains(&(r.tab_kind.clone(), r.tab_id.clone())))
        .collect();

    let starting_z: i64 = existing.iter().map(|t| t.z_order).max().unwrap_or(-1) + 1;

    let total_existing = existing.len();

    // Cascade layout: every CASCADE_WRAP tiles wraps back to the start —
    // tiles beyond the wrap window stack directly under earlier ones.
    // Simple and predictable; users drag to disambiguate.
    for (i, r) in missing.iter().enumerate() {
        let position_index = total_existing + i;
        let step = (position_index % CASCADE_WRAP) as f64;
        let x = CASCADE_BASE + step * CASCADE_STEP;
        let y = CASCADE_BASE + step * CASCADE_STEP;
        let z = starting_z + i as i64;
        let w = r.default_width.unwrap_or(DEFAULT_TILE_WIDTH);
        let h = r.default_height.unwrap_or(DEFAULT_TILE_HEIGHT);

        sqlx::query(
            "INSERT INTO canvas_tiles
                (workspace_id, tab_id, tab_kind, x, y, width, height, z_order, minimized)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .bind(workspace_id)
        .bind(&r.tab_id)
        .bind(&r.tab_kind)
        .bind(x)
        .bind(y)
        .bind(w)
        .bind(h)
        .bind(z)
        .execute(&mut *tx)
        .await?;
    }

    let final_tiles = sqlx::query_as::<_, CanvasTile>(
        &format!("{} WHERE workspace_id = ? ORDER BY z_order", TILE_SELECT)
    )
    .bind(workspace_id)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(final_tiles)
}

/// Batched geometry write — called by the frontend debouncer.
pub async fn upsert_tiles_batch(
    pool: &SqlitePool,
    updates: &[TileGeometryUpdate],
) -> Result<(), sqlx::Error> {
    if updates.is_empty() {
        return Ok(());
    }
    let mut tx = pool.begin().await?;
    for u in updates {
        sqlx::query(
            "UPDATE canvas_tiles
                SET x = ?, y = ?, width = ?, height = ?, z_order = ?,
                    region_id = ?, updated_at = datetime('now')
              WHERE workspace_id = ? AND tab_id = ?",
        )
        .bind(u.x)
        .bind(u.y)
        .bind(u.width)
        .bind(u.height)
        .bind(u.z_order)
        .bind(&u.region_id)
        .bind(&u.workspace_id)
        .bind(&u.tab_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Read all regions for a workspace.
pub async fn list_regions(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<Vec<CanvasRegion>, sqlx::Error> {
    sqlx::query_as::<_, CanvasRegion>(
        &format!("{} WHERE workspace_id = ? ORDER BY z_order", REGION_SELECT)
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await
}

/// Insert-or-update a region.
pub async fn upsert_region(
    pool: &SqlitePool,
    region: &CanvasRegion,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO canvas_regions
             (workspace_id, region_id, name, x, y, width, height, color, z_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, region_id) DO UPDATE SET
             name = excluded.name,
             x = excluded.x,
             y = excluded.y,
             width = excluded.width,
             height = excluded.height,
             color = excluded.color,
             z_order = excluded.z_order,
             updated_at = datetime('now')",
    )
    .bind(&region.workspace_id)
    .bind(&region.region_id)
    .bind(&region.name)
    .bind(region.x)
    .bind(region.y)
    .bind(region.width)
    .bind(region.height)
    .bind(&region.color)
    .bind(region.z_order)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a region. Optionally cascade-delete its child tiles too;
/// otherwise child tiles are detached (region_id cleared).
pub async fn delete_region(
    pool: &SqlitePool,
    workspace_id: &str,
    region_id: &str,
    delete_children: bool,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    if delete_children {
        sqlx::query(
            "DELETE FROM canvas_tiles
              WHERE workspace_id = ? AND region_id = ?",
        )
        .bind(workspace_id)
        .bind(region_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "UPDATE canvas_tiles
                SET region_id = NULL, updated_at = datetime('now')
              WHERE workspace_id = ? AND region_id = ?",
        )
        .bind(workspace_id)
        .bind(region_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "DELETE FROM canvas_regions
          WHERE workspace_id = ? AND region_id = ?",
    )
    .bind(workspace_id)
    .bind(region_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Toggle the minimized flag on a single tile. Independent of geometry
/// flush so it doesn't share the debounce window.
pub async fn set_minimized(
    pool: &SqlitePool,
    workspace_id: &str,
    tab_id: &str,
    minimized: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE canvas_tiles
            SET minimized = ?, updated_at = datetime('now')
          WHERE workspace_id = ? AND tab_id = ?",
    )
    .bind(if minimized { 1 } else { 0 })
    .bind(workspace_id)
    .bind(tab_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Hard-delete a single tile row. Called when a source mode closes its tab.
/// Belt-and-braces; `resolve_tiles` also cleans orphans on next Canvas open.
pub async fn delete_tile(
    pool: &SqlitePool,
    workspace_id: &str,
    tab_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM canvas_tiles
          WHERE workspace_id = ? AND tab_id = ?",
    )
    .bind(workspace_id)
    .bind(tab_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Read the workspace's viewport. Returns in-memory defaults if no row
/// exists yet — the row is not lazily INSERTed; first `set_viewport`
/// persists it.
pub async fn get_viewport(
    pool: &SqlitePool,
    workspace_id: &str,
) -> Result<CanvasViewport, sqlx::Error> {
    let existing: Option<CanvasViewport> = sqlx::query_as::<_, CanvasViewport>(
        "SELECT workspace_id, offset_x, offset_y, zoom,
                last_focused_tab, updated_at
           FROM canvas_viewports WHERE workspace_id = ?",
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?;

    if let Some(v) = existing {
        return Ok(v);
    }

    // Lazy default — not persisted until set_viewport is called.
    Ok(CanvasViewport {
        workspace_id: workspace_id.to_string(),
        offset_x: 0.0,
        offset_y: 0.0,
        zoom: 1.0,
        last_focused_tab: None,
        updated_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Upsert the workspace's viewport. ON CONFLICT replaces all mutable
/// columns.
pub async fn set_viewport(
    pool: &SqlitePool,
    workspace_id: &str,
    offset_x: f64,
    offset_y: f64,
    zoom: f64,
    last_focused_tab: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO canvas_viewports
             (workspace_id, offset_x, offset_y, zoom, last_focused_tab, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(workspace_id) DO UPDATE SET
             offset_x = excluded.offset_x,
             offset_y = excluded.offset_y,
             zoom = excluded.zoom,
             last_focused_tab = excluded.last_focused_tab,
             updated_at = datetime('now')",
    )
    .bind(workspace_id)
    .bind(offset_x)
    .bind(offset_y)
    .bind(zoom)
    .bind(last_focused_tab)
    .execute(pool)
    .await?;
    Ok(())
}
