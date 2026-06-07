import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Channel } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  canvasShellTerminalSpawn,
  type ShellOutput,
} from '$lib/modes/canvas/commands';
import {
  shellTerminals,
  type ShellTerminalEntry,
} from '$lib/modes/canvas/stores/shellTerminalsStore';
import { agentWriteToTerminal, agentResizeTerminal } from '$lib/modes/agent/commands';
import { getTerminalTheme } from '$lib/utils/theme';
import { appearance } from '$lib/stores/settings';

// Live theme update — when the user switches theme/accent, re-apply
// the terminal theme to every existing shell xterm. Mirrors Agent
// mode's pattern (AgentPanel.svelte ~line 1263).
appearance.subscribe((app) => {
  if (!app) return;
  const termTheme = getTerminalTheme(app.theme, app.accentColor);
  const map = get(shellTerminals);
  for (const entry of map.values()) {
    const t = entry.internal?.term;
    if (t) t.options.theme = termTheme;
  }
});

/**
 * Spawn a new Canvas shell terminal. Adds a placeholder entry to the store
 * synchronously, then awaits the PTY spawn. xterm DOM creation is deferred
 * to the first `attachShellTerminal` call to avoid opening into a detached
 * container (a known WebGL gotcha from Cate).
 *
 * Returns the new tab id.
 */
export async function spawnShellTerminal(workspaceId: string, cwd: string): Promise<string> {
  const id = crypto.randomUUID();
  const entry: ShellTerminalEntry = { id, cwd, terminalId: null };
  shellTerminals.update((m) => {
    const next = new Map(m);
    next.set(id, entry);
    return next;
  });

  const channel = new Channel<ShellOutput>();
  channel.onmessage = (msg) => {
    if (!msg.data) return;
    let bytes: Uint8Array;
    try {
      const binary = atob(msg.data);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch {
      bytes = new TextEncoder().encode(msg.data);
    }
    const e = get(shellTerminals).get(id);
    if (!e) return;
    if (e.internal) {
      e.internal.term.write(bytes);
    } else {
      // xterm not yet created — buffer until first attach.
      shellTerminals.update((m) => {
        const next = new Map(m);
        const cur = next.get(id);
        if (cur) next.set(id, { ...cur, pending: [...(cur.pending ?? []), bytes] });
        return next;
      });
    }
  };

  const terminalId = await canvasShellTerminalSpawn(workspaceId, cwd, channel);
  shellTerminals.update((m) => {
    const next = new Map(m);
    const cur = next.get(id);
    if (cur) next.set(id, { ...cur, terminalId });
    return next;
  });
  // If the xterm was already created by an attach that beat the spawn,
  // catch the PTY up to the current cell grid. Without this the PTY
  // would stay at its 80x24 default because onResize already fired
  // before terminalId existed.
  const e = get(shellTerminals).get(id);
  if (e?.internal) {
    agentResizeTerminal(terminalId, e.internal.term.cols, e.internal.term.rows).catch((err) => {
      console.error('[canvas] shell terminal initial resize failed:', err);
    });
  }
  return id;
}

/**
 * Move the xterm container for `id` into `slot`. If this is the first
 * attach for this entry, the xterm is created here (`term.open(container)`)
 * and the container is parented to the slot.
 */
export function attachShellTerminal(id: string, slot: HTMLElement): void {
  const entry = get(shellTerminals).get(id);
  if (!entry) return;

  if (!entry.internal) {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", "Menlo", monospace',
      fontSize: 13,
      theme: getTerminalTheme(get(appearance).theme, get(appearance).accentColor),
      allowTransparency: true,
      scrollback: 10000,
      lineHeight: 1.35,
      smoothScrollDuration: 100,
      rescaleOverlappingGlyphs: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      rightClickSelectsWord: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    slot.appendChild(container);
    term.open(container);
    fitAddon.fit();
    // Sync PTY to the just-fit dimensions even if onResize didn't fire
    // (xterm skips the event when proposed cols/rows equal current).
    const initDims = fitAddon.proposeDimensions();
    if (initDims) {
      const live = get(shellTerminals).get(id);
      if (live?.terminalId) {
        agentResizeTerminal(live.terminalId, initDims.cols, initDims.rows).catch(() => {});
      }
    }

    // Wire keystrokes from xterm to the PTY.
    term.onData((data) => {
      const e = get(shellTerminals).get(id);
      if (e?.terminalId) {
        agentWriteToTerminal(e.terminalId, data).catch((err) => {
          console.error('[canvas] shell terminal write failed:', err);
        });
      }
    });

    // Mirror the agent terminal pattern: when xterm's cell grid changes
    // (after fitAddon.fit() runs on tile resize), tell the PTY so the
    // shell line-wraps at the same column the terminal renders at.
    // Without this, long inputs wrap inside the shell's stale column
    // count while xterm shows the actual width — backspace/arrow keys
    // operate on the wrong cell positions and the line corrupts.
    term.onResize(({ cols, rows }) => {
      const e = get(shellTerminals).get(id);
      if (e?.terminalId) {
        agentResizeTerminal(e.terminalId, cols, rows).catch((err) => {
          console.error('[canvas] shell terminal resize failed:', err);
        });
      }
    });

    // Flush any bytes the PTY emitted before the xterm existed.
    const pending = entry.pending;
    if (pending && pending.length > 0) {
      for (const chunk of pending) term.write(chunk);
    }

    shellTerminals.update((m) => {
      const next = new Map(m);
      const cur = next.get(id);
      if (cur) {
        const { pending: _, ...rest } = cur;
        next.set(id, { ...rest, internal: { term, fitAddon, container } });
      }
      return next;
    });
  } else {
    slot.appendChild(entry.internal.container);
    try {
      entry.internal.fitAddon.fit();
      // Same belt-and-suspenders as the create branch: catch the PTY
      // up to the (potentially-changed) slot dimensions after a reparent.
      const dims = entry.internal.fitAddon.proposeDimensions();
      if (dims && entry.terminalId) {
        agentResizeTerminal(entry.terminalId, dims.cols, dims.rows).catch(() => {});
      }
    } catch {
      // First resize tick will fit.
    }
  }
}

/**
 * Move the xterm container OUT of `slot` if it currently sits there.
 * Does not destroy the xterm or kill the PTY.
 */
export function detachShellTerminal(id: string, slot: HTMLElement): void {
  const entry = get(shellTerminals).get(id);
  if (!entry?.internal) return;
  if (entry.internal.container.parentElement === slot) {
    slot.removeChild(entry.internal.container);
  }
}
