-- Atlas regions: named, colored rectangles that group tiles by project.
-- Membership is spatial-implicit at drop time but stored explicitly as
-- canvas_tiles.region_id, so cascading drags and per-region operations
-- are cheap lookups instead of bounding-box scans.

CREATE TABLE IF NOT EXISTS canvas_regions (
    workspace_id  TEXT NOT NULL,
    region_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    x             REAL NOT NULL,
    y             REAL NOT NULL,
    width         REAL NOT NULL,
    height        REAL NOT NULL,
    color         TEXT NOT NULL,
    z_order       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, region_id)
);

-- canvas_tiles gains an optional region_id. NULL = not in any region.
-- No foreign key: orphan tiles are silently detached at app level when
-- a region is deleted (same pattern as the no-FK tile <-> workspace
-- relationship in migration 19).
ALTER TABLE canvas_tiles ADD COLUMN region_id TEXT;
