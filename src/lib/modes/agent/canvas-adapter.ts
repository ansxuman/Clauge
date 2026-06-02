import type { CanvasTabAdapter } from '$lib/modes/canvas/adapter';
import { get } from 'svelte/store';
import { agentTerminalMap, activeAgentSession, agentSessions } from '$lib/modes/agent/stores';
import { mode, setMode } from '$lib/stores/app';
import {
  attachAgentTerminal,
  detachAgentTerminal,
  listOpenAgentTerminals,
} from '$lib/modes/canvas/services/agentTerminalReparent';
import { tabs } from '$lib/shared/stores/tabs';

export const agentTerminalAdapter: CanvasTabAdapter = {
  tabKind: 'agent_terminal',
  mountStrategy: 'reparent',

  listOpenTabs(_workspaceId) {
    return listOpenAgentTerminals();
  },

  subscribe(_workspaceId, onChange) {
    return agentTerminalMap.subscribe(() => onChange());
  },

  attach(tabId, slot) {
    attachAgentTerminal(tabId, slot);
  },

  detach(tabId, slot) {
    detachAgentTerminal(tabId, slot);
  },

  getMeta(tabId) {
    const sessions = get(agentSessions);
    const s = sessions.find((x) => x.id === tabId);
    return {
      title: s?.title ?? tabId,
    };
  },

  openInHomeMode(tabId) {
    const sessions = get(agentSessions);
    const s = sessions.find((x) => x.id === tabId) ?? null;
    activeAgentSession.set(s);
    void setMode('agent');
  },

  closeTab(tabId) {
    const allTabs = get(tabs);
    const topbarTab = allTabs.find((t) => t.mode === 'agent' && t.key === tabId);
    if (!topbarTab) return;
    window.dispatchEvent(
      new CustomEvent('canvas:request-tab-close', { detail: { tabId: topbarTab.id } }),
    );
  },
};
