import type { CanvasTabAdapter } from '$lib/modes/canvas/adapter';
import { get } from 'svelte/store';
import { sqlTabState, sqlPendingChanges, connections } from './stores';
import {
  attachSqlEditor,
  detachSqlEditor,
} from './services/sqlEditorReparent';
import { tabs, activateTab } from '$lib/shared/stores/tabs';
import { setMode } from '$lib/stores/app';

/**
 * Canvas adapter for SQL editor tabs. Uses the singleton reparent
 * registry so the CodeMirror EditorView (undo history, cursor,
 * selection) survives the move between SqlPanel and a Canvas tile.
 *
 * Canonical id is `tab.key` (the persisted SQL script id). Drafts
 * without a key are not surfaced as tiles — they have no stable
 * identity to bind a canvas tile to.
 */
function findTabByKey(key: string) {
  return get(tabs).find((t) => t.mode === 'sql' && t.key === key);
}

function bindingTitle(tabId: number, fallback: string): string {
  const data = get(sqlTabState).get(tabId);
  const binding = data?.binding;
  if (!binding) return fallback;
  const conn = get(connections).find((c) => c.id === binding.connectionId);
  const connLabel = conn?.name ?? binding.connectionId;
  return `${fallback} — ${connLabel} / ${binding.database}`;
}

export const sqlEditorAdapter: CanvasTabAdapter = {
  tabKind: 'sql_editor',
  mountStrategy: 'reparent',
  defaultSpawnSize: { width: 900, height: 650 },

  listOpenTabs(_workspaceId) {
    return get(tabs)
      .filter((t) => t.mode === 'sql' && t.key)
      .map((t) => ({ id: t.key as string, title: t.label }));
  },

  subscribe(_workspaceId, onChange) {
    const unsubTabs = tabs.subscribe(() => onChange());
    const unsubState = sqlTabState.subscribe(() => onChange());
    return () => {
      unsubTabs();
      unsubState();
    };
  },

  attach(tabId, slot) {
    const tab = findTabByKey(tabId);
    if (!tab) return;
    attachSqlEditor(tab.id, slot);
  },

  detach(tabId, slot) {
    const tab = findTabByKey(tabId);
    if (!tab) return;
    detachSqlEditor(tab.id, slot);
  },

  getMeta(tabId) {
    const tab = findTabByKey(tabId);
    if (!tab) return { title: tabId };
    const title = bindingTitle(tab.id, tab.label);
    const dirty = get(sqlPendingChanges).has(tab.id);
    return { title, dirty };
  },

  openInHomeMode(tabId) {
    const tab = findTabByKey(tabId);
    if (tab) activateTab(tab.id);
    void setMode('sql');
  },

  closeTab(tabId) {
    const tab = findTabByKey(tabId);
    if (!tab) return;
    window.dispatchEvent(
      new CustomEvent('canvas:request-tab-close', { detail: { tabId: tab.id } }),
    );
  },
};
