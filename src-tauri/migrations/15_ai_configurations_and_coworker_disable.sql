-- Coworkers gating: when sub lapses, stamp disabled_at on coworkers
-- beyond first 3 (by created_at). NULL = active; non-NULL = grayed out
-- in UI, blocked at MCP layer.
ALTER TABLE workspace_coworkers ADD COLUMN disabled_at TEXT;
