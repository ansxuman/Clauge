import { writable } from 'svelte/store';
import type { CanvasTabAdapter } from '$lib/modes/canvas/adapter';
import type { TabKind } from '$lib/modes/canvas/commands';
import { mode } from '$lib/stores/app';

const STUB_KIND: TabKind = 'agent_terminal';

// In-memory list of "open" stub tabs. Phase 4 replaces with real adapter listings.
const stubTabs = writable<{ id: string; title: string }[]>([
  { id: 'stub-1', title: 'Stub terminal 1' },
  { id: 'stub-2', title: 'Stub terminal 2' },
  { id: 'stub-3', title: 'Stub SQL editor' },
]);

export function getStubTabs(): { id: string; title: string }[] {
  let value: { id: string; title: string }[] = [];
  const u = stubTabs.subscribe((v) => (value = v));
  u();
  return value;
}

export const stubBlockAdapter: CanvasTabAdapter = {
  tabKind: STUB_KIND,
  mountStrategy: 'remount',

  listOpenTabs() {
    return getStubTabs();
  },

  subscribe(_workspaceId, onChange) {
    return stubTabs.subscribe(() => onChange());
  },

  render(tabId, slot) {
    const el = document.createElement('div');
    el.className = 'cv-stub-body';
    el.textContent = `Tile ${tabId}\n\nDrag the title bar.\nResize from any edge.\nDouble-click title to jump.`;
    el.style.whiteSpace = 'pre';
    el.style.padding = '12px';
    el.style.fontFamily = 'ui-monospace, monospace';
    el.style.fontSize = '12px';
    el.style.color = 'rgba(255,255,255,0.7)';
    slot.appendChild(el);
    return {
      destroy() {
        el.remove();
      },
    };
  },

  getMeta(tabId) {
    const t = getStubTabs().find((x) => x.id === tabId);
    return {
      title: t?.title ?? tabId,
      statusDot: '#7dd3fc',
    };
  },

  openInHomeMode() {
    mode.set('agent');
  },
};
