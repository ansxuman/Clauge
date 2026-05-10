// Workspace mode types — mirror of the Rust models in
// `src-tauri/src/modes/workspace/models.rs`. Camel-cased because the
// Rust serde annotations rename on the boundary.

export interface Workspace {
  id: string;
  name: string;
  projectPath: string | null;
  projectName: string | null;
  color: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Workspace-level GitHub/GitLab URL — added in migration 12.
   *  Used as the agent's default remote when no per-board override
   *  is set. */
  repoUrl: string | null;
}

export interface WorkspaceNote {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  /** JSON-encoded `string[]` on the wire — parsed by the store helper. */
  tags: string;
  linkedSessionId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** `1` = blocked from agent edits; UI edits allowed. */
  frozen: number;
}

export interface WorkspaceBoard {
  id: string;
  workspaceId: string;
  name: string;
  /** `'manual' | 'github_issues'` etc. Always `'manual'` in v1. */
  source: string;
  sourceConfig: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBoardColumn {
  id: string;
  boardId: string;
  name: string;
  color: string | null;
  position: number;
  createdAt: string;
}

export interface WorkspaceBoardCard {
  id: string;
  columnId: string;
  title: string;
  description: string;
  priority: string | null;
  /** JSON-encoded `string[]` on the wire — parsed by the store helper. */
  tags: string;
  position: number;
  externalId: string | null;
  externalUrl: string | null;
  /** PR / MR URL once `cards_raise_pr` (UI button or MCP) has run for
   *  this card. null until the first PR is raised. Subsequent raises
   *  detect this and just push commits to the same branch. */
  prUrl: string | null;
  linkedSessionId: string | null;
  /** `1` when an agent moved this card into a Review-class column. */
  reviewPending: number;
  reviewChecklist: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** `1` = blocked from agent edits. */
  frozen: number;
  /** Session id that currently owns this card's work-stream (drawer
   *  chat or terminal). null = unclaimed; any surface can start a chat
   *  and claim. */
  claimedSessionId: string | null;
  /** Coworker (persona) currently owning the active conversation. May
   *  be null even when claimedSessionId is set if a manual terminal
   *  session claimed the card. */
  claimedCoworkerId: string | null;
  /** Persona that created the card, when known. UI looks up the
   *  current name via the coworker store so renames are safe. */
  createdByCoworkerId: string | null;
  /** Persona behind the most-recent mutation. */
  updatedByCoworkerId: string | null;
  /** Total comments on this card (computed by the board listing
   *  query). 0 when the card has no comments yet. */
  commentCount: number;
}

/** Card comment row. Each comment carries an `actor` (raw author tag —
 *  'user', 'user:<login>', or the persona's display name for agent
 *  replies) and an optional `coworkerId` linking it to the persona that
 *  authored it (NULL for plain user comments). */
export interface WorkspaceCardComment {
  id: string;
  cardId: string;
  actor: string;
  coworkerId: string | null;
  body: string;
  parentId: string | null;
  createdAt: string;
  /** Optional — drawer-only marker for a transient row that's not a
   *  real comment yet. `'thinking'` = "@alex is composing"; `'error'`
   *  = the agent run failed (body holds the error message). Server
   *  never sets these; cleaned up before refresh. */
  pending?: 'thinking' | 'error';
}

/** Coworker (persona) — global to the user, not workspace-scoped.
 *  Each is a persona built on top of an underlying agent CLI. The
 *  user's friendly handle (@<name>) maps to a `system_prompt` that's
 *  appended to every agent run for this coworker. */
export interface WorkspaceCoworker {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  provider: string;
  /** dicebear seed — defaults to the name, user can re-roll. */
  avatarSeed: string;
  /** dicebear collection name ('personas', 'bottts', …). */
  avatarStyle: string;
  createdAt: string;
  createdBy: string;
}

/** Attribution actor format. Use the helper in `attribution.ts` to derive
 *  the right string from the GitHub-sync state. */
export type WorkspaceActor =
  | 'user'
  | `user:${string}` // GitHub-synced: 'user:<login>'
  | 'claude'
  | 'codex'
  | 'gemini'
  | (string & {});

// Project-issue scan — mirror of `ProjectScanResult` enum on the Rust
// side. Each variant maps to a distinct UI banner state.

export interface ProjectIssue {
  externalId: string;
  title: string;
  body: string;
  url: string;
  source: 'github' | 'gitlab' | string;
  labels: string[];
}

// Inbox row — a note or card recently mutated by an agent (any
// `updated_by` not starting with 'user'). Shape matches Rust's
// `InboxItem` repo struct.
export interface InboxItem {
  kind: 'note' | 'card' | (string & {});
  id: string;
  workspaceId: string;
  workspaceName: string;
  label: string;
  boardId: string | null;
  boardName: string | null;
  updatedBy: string;
  updatedAt: string;
}

export type ProjectScanResult =
  | { kind: 'success'; issues: ProjectIssue[]; remote: string; source: string }
  | { kind: 'notGitRepo' }
  | { kind: 'noRemote' }
  | { kind: 'unsupportedRemote'; url: string }
  | { kind: 'toolNotInstalled'; tool: string; installUrl: string }
  | { kind: 'notAuthenticated'; tool: string; loginCommand: string }
  /** CLI is signed in but the active account can't see this repo —
   *  most often a multi-account `gh` setup with the wrong account
   *  active. Banner suggests `gh auth switch` (or login). */
  | { kind: 'noAccess'; tool: string; repo: string; loginCommand: string }
  /** DNS / connectivity failure — banner suggests retry. */
  | { kind: 'networkError'; message: string }
  | { kind: 'apiError'; message: string };
