// Companion lifecycle bridge: the desktop server fires these Tauri
// events when a phone opens or closes a session. We open/close a REAL
// desktop tab the normal way (so it renders + registers with the D3
// fanout), capture the resulting terminalId, and report it back so the
// parked REST handler can answer the phone. Open/close go through the
// SAME panel flows a desktop user triggers — no parallel spawn path.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get } from 'svelte/store';

import { setMode } from '$lib/stores/app';
import { tabs } from '$lib/shared/stores/tabs';
import { SSH_EVENT, APP_EVENT } from '$lib/shared/constants/events';
import {
  agentSessions,
  activeAgentSession,
  agentTerminalIds,
  loadAgentSessions,
} from '$lib/modes/agent/stores';
import { sshProfiles, sshTerminalIds, loadSshProfiles } from '$lib/modes/ssh/stores';
import { profileIdFromTabKey } from '$lib/modes/ssh/tabkey';
import { addTab } from '$lib/shared/stores/tabs';
import { getPurposeColor } from '$lib/modes/agent/ai/prompt';

interface OpenSessionEvent {
  requestId: string;
  kind: 'agent' | 'ssh';
  sessionId?: string;
  profileId?: string;
}

interface CloseSessionEvent {
  terminalId: string;
}

// The panels spawn asynchronously (rAF + capture polling), so the
// terminalId lands in its store a beat after we trigger the open. Poll
// until it appears or we run out of patience; the Rust side parks for
// 30s, so stay comfortably inside that.
const TERMINAL_POLL_INTERVAL = 100;
const TERMINAL_POLL_TIMEOUT = 25_000;

function pollFor(read: () => string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const id = read();
      if (id) {
        resolve(id);
        return;
      }
      if (Date.now() - started >= TERMINAL_POLL_TIMEOUT) {
        reject(new Error('terminal did not come up in time'));
        return;
      }
      setTimeout(tick, TERMINAL_POLL_INTERVAL);
    };
    tick();
  });
}

async function openAgent(sessionId: string): Promise<string> {
  let session = get(agentSessions).find((s) => s.id === sessionId);
  if (!session) {
    // Row may have been created backend-side this request — reload.
    await loadAgentSessions();
    session = get(agentSessions).find((s) => s.id === sessionId);
  }
  if (!session) throw new Error('unknown agent session');

  // Switch the user to the agent mode + session. Setting the active
  // session drives AgentPanel's subscriber: it activates the tab (adding
  // one if needed) and spawns the terminal — the same path as clicking
  // the session in the sidebar.
  await setMode('agent');
  const existing = get(tabs).find((t) => t.mode === 'agent' && t.key === sessionId);
  if (!existing) {
    addTab(session.title, 'agent', sessionId, getPurposeColor(session.purpose));
  }
  activeAgentSession.set(session);

  return pollFor(() => get(agentTerminalIds).get(sessionId) ?? null);
}

async function openSsh(profileId: string): Promise<string> {
  let profile = get(sshProfiles).find((p) => p.id === profileId);
  if (!profile) {
    await loadSshProfiles();
    profile = get(sshProfiles).find((p) => p.id === profileId);
  }
  if (!profile) throw new Error('unknown ssh profile');

  await setMode('ssh');
  // The OPEN_TAB flow finds-or-creates a tab for this profile and
  // SshPanel spawns its terminal reactively — identical to picking the
  // profile from the SSH nav.
  window.dispatchEvent(new CustomEvent(SSH_EVENT.OPEN_TAB, { detail: profile }));

  // Resolve the tabKey OPEN_TAB landed on (newest tab for the profile),
  // then poll that tab's terminalId.
  return pollFor(() => {
    const tab = get(tabs)
      .filter((t) => t.mode === 'ssh' && t.key && profileIdFromTabKey(t.key) === profileId)
      .pop();
    if (!tab?.key) return null;
    return get(sshTerminalIds).get(tab.key) ?? null;
  });
}

async function handleOpen(ev: OpenSessionEvent) {
  try {
    const terminalId =
      ev.kind === 'agent'
        ? await openAgent(ev.sessionId ?? '')
        : await openSsh(ev.profileId ?? '');
    await invoke('companion_report_opened', { requestId: ev.requestId, terminalId });
  } catch (e) {
    await invoke('companion_report_open_failed', {
      requestId: ev.requestId,
      error: String(e),
    }).catch(() => {});
  }
}

function handleClose(ev: CloseSessionEvent) {
  // Match the tab by its live terminalId (agent keyed by sessionId, ssh
  // by tabKey) and ask the topbar to close it WITHOUT a confirm prompt.
  // No match → ignore; the backend's grace-period fallback kills it.
  const agentIds = get(agentTerminalIds);
  for (const [sessionId, termId] of agentIds) {
    if (termId !== ev.terminalId) continue;
    const tab = get(tabs).find((t) => t.mode === 'agent' && t.key === sessionId);
    if (tab) closeTabProgrammatically(tab.id);
    return;
  }
  const sshIds = get(sshTerminalIds);
  for (const [tabKey, termId] of sshIds) {
    if (termId !== ev.terminalId) continue;
    const tab = get(tabs).find((t) => t.mode === 'ssh' && t.key === tabKey);
    if (tab) closeTabProgrammatically(tab.id);
    return;
  }
}

function closeTabProgrammatically(tabId: number) {
  window.dispatchEvent(
    new CustomEvent(APP_EVENT.CLOSE_TAB_PROGRAMMATIC, { detail: { tabId } }),
  );
}

/** Wire the companion open/close listeners. Returns a cleanup fn. */
export async function setupCompanionLifecycle(): Promise<UnlistenFn> {
  const unOpen = await listen<OpenSessionEvent>('companion:open-session', (e) =>
    handleOpen(e.payload),
  );
  const unClose = await listen<CloseSessionEvent>('companion:close-session', (e) =>
    handleClose(e.payload),
  );
  return () => {
    unOpen();
    unClose();
  };
}
