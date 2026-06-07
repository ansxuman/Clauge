import { invoke, Channel } from '@tauri-apps/api/core';

/** Must match the tab_kind CHECK constraint in the latest canvas_tiles migration. */
export type TabKind =
  | 'agent_terminal'
  | 'ssh_terminal'
  | 'shell_terminal'
  | 'sql_editor'
  | 'rest_request'
  | 'mongo_query'
  | 'redis_query'
  | 'explorer_file_browser'
  | 'workspace_note'
  | 'workspace_board';

export interface CanvasTile {
  workspaceId: string;
  tabId: string;
  tabKind: TabKind;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrder: number;
  /** SQLite INTEGER on wire; 0 = visible, 1 = minimized. */
  minimized: number;
  regionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasRegion {
  workspaceId: string;
  regionId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  zOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasViewport {
  workspaceId: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
  lastFocusedTab: string | null;
  updatedAt: string;
}

export interface TabRef {
  tabKind: TabKind;
  tabId: string;
  /** Width to spawn new tiles at (per-kind default). Omit = backend default. */
  defaultWidth?: number;
  /** Height to spawn new tiles at (per-kind default). Omit = backend default. */
  defaultHeight?: number;
}

export interface TileGeometryUpdate {
  workspaceId: string;
  tabId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zOrder: number;
  regionId: string | null;
}

export const canvasResolveTiles = (workspaceId: string, openTabRefs: TabRef[]) =>
  invoke<CanvasTile[]>('canvas_resolve_tiles', { workspaceId, openTabRefs });

export const canvasListTiles = (workspaceId: string) =>
  invoke<CanvasTile[]>('canvas_list_tiles', { workspaceId });

export const canvasUpsertTilesBatch = (updates: TileGeometryUpdate[]) =>
  invoke<void>('canvas_upsert_tiles_batch', { updates });

export const canvasMinimizeTile = (workspaceId: string, tabId: string, minimized: boolean) =>
  invoke<void>('canvas_minimize_tile', { workspaceId, tabId, minimized });

export const canvasDeleteTile = (workspaceId: string, tabId: string) =>
  invoke<void>('canvas_delete_tile', { workspaceId, tabId });

export const canvasGetViewport = (workspaceId: string) =>
  invoke<CanvasViewport>('canvas_get_viewport', { workspaceId });

export const canvasListRegions = (workspaceId: string) =>
  invoke<CanvasRegion[]>('canvas_list_regions', { workspaceId });

export const canvasUpsertRegion = (region: CanvasRegion) =>
  invoke<void>('canvas_upsert_region', { region });

export const canvasDeleteRegion = (
  workspaceId: string,
  regionId: string,
  deleteChildren: boolean,
) =>
  invoke<void>('canvas_delete_region', { workspaceId, regionId, deleteChildren });

export const canvasSetViewport = (
  workspaceId: string,
  offsetX: number,
  offsetY: number,
  zoom: number,
  lastFocusedTab: string | null,
) =>
  invoke<void>('canvas_set_viewport', { workspaceId, offsetX, offsetY, zoom, lastFocusedTab });

export interface ShellOutput {
  terminalId: string;
  data: string; // base64-encoded PTY output; empty string on exit
  exit?: boolean; // true when PTY closed
}

export const canvasShellTerminalSpawn = (
  workspaceId: string,
  cwd: string,
  onOutput: Channel<ShellOutput>,
) =>
  invoke<string>('canvas_shell_terminal_spawn', { workspaceId, cwd, onOutput });
