import { invoke } from '@tauri-apps/api/core';
import type {
  InboxItem,
  ProjectScanResult,
  Workspace,
  WorkspaceBoard,
  WorkspaceBoardCard,
  WorkspaceBoardColumn,
  WorkspaceCardComment,
  WorkspaceCoworker,
  WorkspaceNote,
} from './types';

// ── Workspaces ────────────────────────────────────────────────────────

export const workspaceList = () => invoke<Workspace[]>('workspace_list');
export const workspaceGet = (id: string) => invoke<Workspace>('workspace_get', { id });
export const workspaceCreate = (params: {
  name: string;
  projectPath?: string | null;
  color?: string | null;
  actor: string;
}) => invoke<Workspace>('workspace_create', params);
export const workspaceUpdate = (params: {
  id: string;
  name: string;
  projectPath?: string | null;
  color?: string | null;
  actor: string;
}) => invoke<void>('workspace_update', params);
export const workspaceDelete = (id: string, deleteWorktrees: boolean = true) =>
  invoke<void>('workspace_delete', { id, deleteWorktrees });

/** Pre-delete summary for the confirmation dialog. `activeWorktrees`
 *  enumerates cards whose claimed session has a worktree on disk —
 *  those need cleanup beyond the DB cascade. */
export interface ActiveWorktreeRow {
  cardId: string;
  cardTitle: string;
  sessionId: string;
  projectPath: string;
  worktreePath: string | null;
  worktreeBranch: string | null;
}
export interface WorkspaceDeletePreviewResult {
  noteCount: number;
  boardCount: number;
  cardCount: number;
  activeWorktrees: ActiveWorktreeRow[];
}
export const workspaceDeletePreview = (id: string) =>
  invoke<WorkspaceDeletePreviewResult>('workspace_delete_preview', { id });

// ── Notes ─────────────────────────────────────────────────────────────

export const workspaceNoteList = (workspaceId: string) =>
  invoke<WorkspaceNote[]>('workspace_note_list', { workspaceId });
export const workspaceNoteGet = (id: string) => invoke<WorkspaceNote>('workspace_note_get', { id });
export const workspaceNoteCreate = (params: {
  workspaceId: string;
  title: string;
  content?: string;
  tags?: string[];
  linkedSessionId?: string | null;
  actor: string;
}) => invoke<WorkspaceNote>('workspace_note_create', params);
export const workspaceNoteUpdate = (params: {
  id: string;
  title: string;
  content: string;
  tags: string[];
  linkedSessionId?: string | null;
  actor: string;
}) => invoke<void>('workspace_note_update', params);
export const workspaceNoteDelete = (id: string) => invoke<void>('workspace_note_delete', { id });

// ── Boards + columns ──────────────────────────────────────────────────

export const workspaceBoardList = (workspaceId: string) =>
  invoke<WorkspaceBoard[]>('workspace_board_list', { workspaceId });
export const workspaceBoardGet = (id: string) => invoke<WorkspaceBoard>('workspace_board_get', { id });
export const workspaceBoardCreate = (workspaceId: string, name: string) =>
  invoke<WorkspaceBoard>('workspace_board_create', { workspaceId, name });
export const workspaceBoardRename = (id: string, name: string) =>
  invoke<void>('workspace_board_rename', { id, name });
export const workspaceBoardSetProject = (
  id: string,
  projectPath: string | null,
  projectUrl: string | null,
) => invoke<void>('workspace_board_set_project', { id, projectPath, projectUrl });
export const workspaceBoardDelete = (id: string) => invoke<void>('workspace_board_delete', { id });

export const workspaceColumnList = (boardId: string) =>
  invoke<WorkspaceBoardColumn[]>('workspace_column_list', { boardId });

// ── Cards ─────────────────────────────────────────────────────────────

export const workspaceCardList = (boardId: string) =>
  invoke<WorkspaceBoardCard[]>('workspace_card_list', { boardId });
export const workspaceCardCreate = (params: {
  columnId: string;
  title: string;
  description?: string;
  priority?: string | null;
  tags?: string[];
  position?: number;
  externalId?: string | null;
  externalUrl?: string | null;
  linkedSessionId?: string | null;
  coworkerId?: string | null;
  actor: string;
}) => invoke<WorkspaceBoardCard>('workspace_card_create', params);
export const workspaceCardUpdate = (params: {
  id: string;
  title: string;
  description: string;
  priority?: string | null;
  tags: string[];
  reviewChecklist?: string | null;
  coworkerId?: string | null;
  actor: string;
}) => invoke<void>('workspace_card_update', params);
export const workspaceCardMove = (params: {
  id: string;
  columnId: string;
  position: number;
  actor: string;
}) => invoke<void>('workspace_card_move', params);
export const workspaceCardClearReview = (id: string, actor: string) =>
  invoke<void>('workspace_card_clear_review', { id, actor });
export const workspaceCardDelete = (id: string) => invoke<void>('workspace_card_delete', { id });
export const workspaceBoardDismissedExternals = (boardId: string) =>
  invoke<string[]>('workspace_board_dismissed_externals', { boardId });
export const workspaceCardAddComment = (id: string, body: string, actor: string) =>
  invoke<WorkspaceCardComment>('workspace_card_add_comment', { id, body, actor });
export const workspaceCardCommentList = (cardId: string) =>
  invoke<WorkspaceCardComment[]>('workspace_card_comment_list', { cardId });
export const workspaceCardCommentDelete = (id: string) =>
  invoke<void>('workspace_card_comment_delete', { id });

export interface CardPushResult {
  id: string;
  externalId: string;
  externalUrl: string;
  source: 'github' | 'gitlab' | string;
}
export const workspaceCardPushToRepo = (id: string, actor: string) =>
  invoke<CardPushResult>('workspace_card_push_to_repo', { id, actor });

export interface RaisePrResult {
  prUrl: string;
  /** True when the PR existed before this call — push updated it
   *  rather than opening a new one. UI uses this to flip the toast
   *  copy between "PR raised" and "Pushed update to PR". */
  alreadyExisted: boolean;
  branch: string;
}
export const workspaceCardRaisePr = (
  cardId: string,
  actor: string,
  title?: string,
  body?: string,
) =>
  invoke<RaisePrResult>('workspace_card_raise_pr', { cardId, actor, title, body });

// ── Card claim + drawer chat (migration 14) ──────────────────────

import type { AgentSession } from '$lib/modes/agent/types';

export interface CardClaimState {
  claimedSessionId: string | null;
  claimedCoworkerId: string | null;
  /** Full session row when claimed; null otherwise. */
  session: AgentSession | null;
  /** Full coworker row when a persona-claim is active; null otherwise. */
  coworker: WorkspaceCoworker | null;
  /** True when the claim is held by a *card-origin* hidden session
   *  for THIS card — drawer can chat. False when held by a manual
   *  terminal session — drawer is in conflict mode. */
  drawerOwns: boolean;
}

export const workspaceCardGetClaim = (id: string) =>
  invoke<CardClaimState>('workspace_card_get_claim', { id });

export interface DrawerChatResult {
  userComment: WorkspaceCardComment;
  replyComment: WorkspaceCardComment | null;
  sessionId: string;
  /** Soft error from the agent run — surface as an inline note in the
   *  thread, not a hard failure. The user comment was still saved. */
  agentError: string | null;
}

export const workspaceCardDrawerChat = (
  id: string,
  coworkerId: string,
  body: string,
  actor: string,
) =>
  invoke<DrawerChatResult>('workspace_card_drawer_chat', { id, coworkerId, body, actor });

// ── Coworkers (personas) ─────────────────────────────────────────

export const workspaceCoworkerList = () =>
  invoke<WorkspaceCoworker[]>('workspace_coworker_list');
export const workspaceCoworkerGet = (id: string) =>
  invoke<WorkspaceCoworker>('workspace_coworker_get', { id });

export interface CoworkerInput {
  name: string;
  role?: string;
  systemPrompt?: string;
  provider?: string;
  avatarSeed?: string;
  avatarStyle?: string;
  actor: string;
}
export const workspaceCoworkerCreate = (input: CoworkerInput) =>
  invoke<WorkspaceCoworker>('workspace_coworker_create', { input });

export interface CoworkerUpdate {
  id: string;
  name: string;
  role?: string;
  systemPrompt?: string;
  provider?: string;
  avatarSeed?: string;
  avatarStyle?: string;
}
export const workspaceCoworkerUpdate = (input: CoworkerUpdate) =>
  invoke<WorkspaceCoworker>('workspace_coworker_update', { input });

export const workspaceCoworkerDelete = (id: string) =>
  invoke<void>('workspace_coworker_delete', { id });

export const workspaceCardRelease = (
  id: string,
  actor: string,
  deleteWorktree: boolean = false,
) =>
  invoke<void>('workspace_card_release', { id, actor, deleteWorktree });

export interface StartWorkResult {
  worktreePath: string;
  worktreeBranch: string;
}

export const workspaceCardStartWork = (id: string, actor: string) =>
  invoke<StartWorkResult>('workspace_card_start_work', { id, actor });

// ── Inbox ────────────────────────────────────────────────────────────

export const workspaceInboxList = (limit?: number) =>
  invoke<InboxItem[]>('workspace_inbox_list', { limit });

// ── MCP server lifecycle ─────────────────────────────────────────────

export interface McpStatus { running: boolean; port: number | null; }

export const workspaceMcpStatus = () =>
  invoke<McpStatus>('workspace_mcp_status');
export const workspaceMcpStart = (port: number, token: string) =>
  invoke<McpStatus>('workspace_mcp_start', { port, token });
export const workspaceMcpStop = () =>
  invoke<McpStatus>('workspace_mcp_stop');
/** `agent` defaults to `'claude-code'` server-side. Pass `'codex'`,
 *  `'gemini'`, or `'opencode'` once those arms land in Rust. */
export const workspaceMcpRegister = (port: number, token: string, agent?: string) =>
  invoke<void>('workspace_mcp_register', { agent, port, token });
export const workspaceMcpUnregister = (agent?: string) =>
  invoke<void>('workspace_mcp_unregister', { agent });
/** Rotates the MCP bearer token. Persists the new value under
 *  `workspace_mcp_token` AND, if `~/.claude.json` already lists
 *  `clauge-workspace`, rewrites the entry with the new token —
 *  so the registered config never goes stale relative to the
 *  server's. Pass the port currently in use (or the requested
 *  port if the server isn't running yet). */
export const workspaceMcpNewToken = (port: number) =>
  invoke<string>('workspace_mcp_new_token', { port });

// ── Project issue scan ───────────────────────────────────────────────

export const workspaceScanProjectIssues = (projectPath: string) =>
  invoke<ProjectScanResult>('workspace_scan_project_issues', { projectPath });

export const workspaceScanProjectIssuesByUrl = (projectUrl: string) =>
  invoke<ProjectScanResult>('workspace_scan_project_issues_by_url', { projectUrl });
