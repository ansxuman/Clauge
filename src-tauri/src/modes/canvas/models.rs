use serde::{Deserialize, Serialize};

/// A single window on the Canvas. One row per open tab per workspace.
/// `tab_id` is opaque (whatever ID the source mode uses); `tab_kind`
/// selects which frontend adapter renders the content.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CanvasTile {
    pub workspace_id: String,
    pub tab_id: String,
    pub tab_kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_order: i64,
    pub minimized: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Per-workspace viewport state (pan offset + zoom). One row per
/// workspace, lazily created on first viewport write.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CanvasViewport {
    pub workspace_id: String,
    pub offset_x: f64,
    pub offset_y: f64,
    pub zoom: f64,
    pub last_focused_tab: Option<String>,
    pub updated_at: String,
}

/// A reference to a currently-open tab in some mode. The frontend
/// passes a `Vec<TabRef>` to `canvas_resolve_tiles` so the backend
/// can reconcile tile rows without needing to query per-mode tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabRef {
    pub tab_kind: String,
    pub tab_id: String,
}

/// Geometry update payload for batched tile flush.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TileGeometryUpdate {
    pub workspace_id: String,
    pub tab_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_order: i64,
}
