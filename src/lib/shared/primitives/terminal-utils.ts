// Pure terminal helpers shared between AgentPanel and SshPanel.
// These are stateless utilities — no xterm lifecycle, no mode-specific assumptions.
// If you need anything stateful (entry maps, capture state, channel handlers),
// keep it in the panel; this module is intentionally narrow.

import type { Terminal } from '@xterm/xterm';
import { isLinux } from '$lib/utils/platform';

/**
 * Decode the base64-encoded PTY chunk emitted by the Rust backend into a
 * Uint8Array suitable for `Terminal.write()`. The PTY reader thread base64s
 * raw bytes (not UTF-8) so that arbitrary control sequences round-trip
 * through the Tauri Channel as a string.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Run `callback` after two successive animation frames.
 *
 * Why 2-rAF and not 1: when the first PTY chunk arrives, calling
 * `term.write(bytes)` does not paint synchronously — xterm batches writes
 * into the next frame. If we hide the loader on rAF #1, xterm has only
 * just *scheduled* the paint, so the user sees a blank gap before the
 * terminal appears. Waiting one more frame lets that batched paint commit
 * before we flip `spawning = false` / `termReady = true`.
 */
export function deferUntilFrame(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

// Trade-off: hard cap > per-tile pause. Browsers cap concurrent WebGL contexts
// at 8–16; the 11th xterm silently fails to render on Atlas tile grids. We cap
// at 6 live WebGL terminals — overflow falls back to xterm's canvas renderer,
// which still renders correctly (just without GPU acceleration).
const WEBGL_TERMINAL_CAP = 6;
let liveWebGLCount = 0;

/**
 * Lazily load and attach the WebGL renderer addon to an xterm terminal.
 *
 * Falls back silently to xterm's canvas renderer if WebGL is unavailable
 * (e.g., GPU blacklisted, software rendering, headless CI), if the live
 * WebGL terminal count is at the cap, or if context is lost. The counter
 * is decremented when the addon is disposed (context loss / Terminal.dispose).
 *
 * Fire-and-forget: callers don't await this. Loading is async only because
 * the addon module is dynamically imported to keep it out of the main bundle.
 */
export async function loadWebGLAddon(term: Terminal): Promise<void> {
  // WebGL crashes the WebKitGTK GPU/compositor process on Linux (Wayland and X11),
  // leaving a blank window with no JS console error. Canvas renderer is stable.
  if (isLinux()) return;
  if (liveWebGLCount >= WEBGL_TERMINAL_CAP) return;
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl');
    const webgl = new WebglAddon();
    liveWebGLCount++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      liveWebGLCount = Math.max(0, liveWebGLCount - 1);
    };
    const originalDispose = webgl.dispose.bind(webgl);
    webgl.dispose = () => {
      try { originalDispose(); } finally { release(); }
    };
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    // Falls back to canvas renderer silently
  }
}
