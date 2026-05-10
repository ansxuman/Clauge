-- Workspace mode — full schema (consolidated 2026-05-09).
--
-- Includes everything: core tables (workspaces / notes / boards /
-- columns / cards), comments, coworkers (personas), card claims,
-- frozen flags, workspace repo URL, and FTS5 virtuals + sync triggers.
--
-- Workspaces have an optional project link. Items inherit Project from
-- their parent workspace; we never store project on notes/boards.
--
-- Attribution columns: every editable row carries created_by /
-- updated_by. Format: 'user' (anonymous) | 'user:<github-login>'
-- (GitHub-synced) | the agent slug ('claude', 'codex', …) when an
-- agent mutates via MCP.

-- ── Workspaces ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    project_path TEXT,
    project_name TEXT,
    color        TEXT,
    -- repo_url: workspace-level GitHub/GitLab URL. Default remote when
    -- a board has no per-board override; powers `cards_push_to_repo`.
    repo_url     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_by   TEXT NOT NULL DEFAULT 'user',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   TEXT NOT NULL DEFAULT 'user'
);

-- ── Notes ─────────────────────────────────────────────────────────
-- frozen=1 blocks ALL agent mutations (UI edits unaffected) — escape
-- hatch for canonical docs.
CREATE TABLE IF NOT EXISTS workspace_notes (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL,
    title              TEXT NOT NULL,
    content            TEXT NOT NULL DEFAULT '',
    tags               TEXT NOT NULL DEFAULT '[]',
    linked_session_id  TEXT,
    frozen             INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    created_by         TEXT NOT NULL DEFAULT 'user',
    updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by         TEXT NOT NULL DEFAULT 'user',
    FOREIGN KEY (workspace_id)      REFERENCES workspaces(id)     ON DELETE CASCADE,
    FOREIGN KEY (linked_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
);

-- ── Boards + Columns ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_boards (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    name          TEXT NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    source_config TEXT,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_board_columns (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT,
    position    INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (board_id) REFERENCES workspace_boards(id) ON DELETE CASCADE
);

-- ── Coworkers (personas) ──────────────────────────────────────────
-- Defined before cards so the FK in workspace_board_cards is forward-
-- safe at table-creation time. Global to the user (not workspace-
-- scoped). Each is a persona built on top of an underlying agent CLI:
-- name + role + a free-form system_prompt added at spawn time so the
-- agent stays in character. avatar_seed feeds @dicebear; avatar_style
-- picks the dicebear sprite collection.
CREATE TABLE IF NOT EXISTS workspace_coworkers (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    provider      TEXT NOT NULL DEFAULT 'claude',
    avatar_seed   TEXT NOT NULL,
    avatar_style  TEXT NOT NULL DEFAULT 'personas',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    created_by    TEXT NOT NULL DEFAULT 'user'
);

-- ── Cards ─────────────────────────────────────────────────────────
-- review_pending: 1 when an agent moved this card into a Review-class
-- column. Cleared on Approve / Request changes.
--
-- claimed_coworker_id + claimed_session_id: the active conversation.
-- One coworker (persona) at a time may have an active chat on a card.
-- claimed_session_id is the underlying hidden session that backs that
-- conversation. Both NULL = unclaimed; any drawer can start a chat.
-- Two-column attribution: `created_by` / `updated_by` always carry the
-- underlying agent slug ('claude') or 'user[:login]'. The companion
-- `*_by_coworker_id` FKs identify which persona was acting at the
-- time. Renaming a coworker doesn't break historical attribution
-- because we resolve the name through the FK at render time.
CREATE TABLE IF NOT EXISTS workspace_board_cards (
    id                       TEXT PRIMARY KEY,
    column_id                TEXT NOT NULL,
    title                    TEXT NOT NULL,
    description              TEXT NOT NULL DEFAULT '',
    priority                 TEXT,
    tags                     TEXT NOT NULL DEFAULT '[]',
    position                 INTEGER NOT NULL,
    external_id              TEXT,
    external_url             TEXT,
    -- pr_url: GitHub/GitLab PR/MR URL once raised. Stamped by
    -- `cards_raise_pr` (UI button or MCP tool); subsequent raises
    -- detect this and just push commits to the existing PR's branch
    -- instead of opening a new PR.
    pr_url                   TEXT,
    linked_session_id        TEXT,
    review_pending           INTEGER NOT NULL DEFAULT 0,
    review_checklist         TEXT,
    frozen                   INTEGER NOT NULL DEFAULT 0,
    claimed_coworker_id      TEXT,
    claimed_session_id       TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    created_by               TEXT NOT NULL DEFAULT 'user',
    created_by_coworker_id   TEXT,
    updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by               TEXT NOT NULL DEFAULT 'user',
    updated_by_coworker_id   TEXT,
    FOREIGN KEY (column_id)               REFERENCES workspace_board_columns(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_session_id)       REFERENCES agent_sessions(id)          ON DELETE SET NULL,
    FOREIGN KEY (claimed_session_id)      REFERENCES agent_sessions(id)          ON DELETE SET NULL,
    FOREIGN KEY (claimed_coworker_id)     REFERENCES workspace_coworkers(id)     ON DELETE SET NULL,
    FOREIGN KEY (created_by_coworker_id)  REFERENCES workspace_coworkers(id)     ON DELETE SET NULL,
    FOREIGN KEY (updated_by_coworker_id)  REFERENCES workspace_coworkers(id)     ON DELETE SET NULL
);

-- ── Card comments (replaces the markdown-blockquote-in-description
--    pattern from earlier drafts; comments are first-class rows). ──
-- coworker_id stamps which persona authored an agent reply. NULL for
-- plain user comments.
CREATE TABLE IF NOT EXISTS workspace_card_comments (
    id          TEXT PRIMARY KEY,
    card_id     TEXT NOT NULL,
    actor       TEXT NOT NULL,           -- 'user' | 'user:<login>' | 'claude' | …
    coworker_id TEXT,                    -- which persona (when an agent reply)
    body        TEXT NOT NULL,
    parent_id   TEXT,                    -- reserved for threaded replies
    created_at  TEXT NOT NULL,
    FOREIGN KEY (card_id)     REFERENCES workspace_board_cards(id)   ON DELETE CASCADE,
    FOREIGN KEY (parent_id)   REFERENCES workspace_card_comments(id) ON DELETE SET NULL,
    FOREIGN KEY (coworker_id) REFERENCES workspace_coworkers(id)     ON DELETE SET NULL
);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workspace_notes_workspace
    ON workspace_notes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_boards_workspace
    ON workspace_boards(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_columns_board
    ON workspace_board_columns(board_id);
CREATE INDEX IF NOT EXISTS idx_workspace_cards_column
    ON workspace_board_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_card_comments_card_id_created_at
    ON workspace_card_comments(card_id, created_at);

-- ── FTS5 — full-text search over notes + cards. ──────────────────
-- Contentless FTS pointing at the base tables; explicit triggers keep
-- them in sync (no `content_rowid` integration — sqlx-lite quirks).
CREATE VIRTUAL TABLE IF NOT EXISTS workspace_notes_fts USING fts5(
    title,
    content,
    workspace_id UNINDEXED,
    note_id      UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS workspace_notes_ai
    AFTER INSERT ON workspace_notes
BEGIN
    INSERT INTO workspace_notes_fts (title, content, workspace_id, note_id)
    VALUES (new.title, new.content, new.workspace_id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS workspace_notes_ad
    AFTER DELETE ON workspace_notes
BEGIN
    DELETE FROM workspace_notes_fts WHERE note_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS workspace_notes_au
    AFTER UPDATE OF title, content ON workspace_notes
BEGIN
    DELETE FROM workspace_notes_fts WHERE note_id = old.id;
    INSERT INTO workspace_notes_fts (title, content, workspace_id, note_id)
    VALUES (new.title, new.content, new.workspace_id, new.id);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS workspace_board_cards_fts USING fts5(
    title,
    description,
    column_id UNINDEXED,
    card_id   UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS workspace_cards_ai
    AFTER INSERT ON workspace_board_cards
BEGIN
    INSERT INTO workspace_board_cards_fts (title, description, column_id, card_id)
    VALUES (new.title, new.description, new.column_id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS workspace_cards_ad
    AFTER DELETE ON workspace_board_cards
BEGIN
    DELETE FROM workspace_board_cards_fts WHERE card_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS workspace_cards_au
    AFTER UPDATE OF title, description, column_id ON workspace_board_cards
BEGIN
    DELETE FROM workspace_board_cards_fts WHERE card_id = old.id;
    INSERT INTO workspace_board_cards_fts (title, description, column_id, card_id)
    VALUES (new.title, new.description, new.column_id, new.id);
END;
