// Frontend → backend log forwarder.
//
// Patches `console.log/info/warn/error/debug` and installs window-level
// error / unhandledrejection listeners so every JS-side event lands in
// the same rolling log file as Rust events — instead of being trapped
// in the WebView's devtools console (which is disabled in release
// builds, so production users never see it).
//
// Each console call:
//   1. Fires the ORIGINAL console method (so dev tools still works).
//   2. Fires-and-forgets a Tauri `app_log` command which calls
//      `log::log!` on the Rust side → writes to
//      `<app_log_dir>/YYYY-MM-DD/HH.log` via `shared::logger`.
//
// Call `installLogForwarder()` ONCE at app boot, as early as possible
// in `+layout.svelte`'s `<script>` (or `app.html`'s inline boot) so
// every console call that happens during startup is captured. Idempotent
// — repeat calls are no-ops.

import { invoke } from '@tauri-apps/api/core';

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';

let installed = false;

/** Best-effort stringification of arbitrary console args.
 *  - Errors become `name: message\nstack`.
 *  - Objects/arrays go through JSON.stringify; circular refs and
 *    non-serializable values fall back to String(...).
 *  - Primitives stringify directly. */
function stringifyArg(arg: unknown): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  }
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
    return String(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/** Map a console method name to a Rust log::Level string. */
function levelFor(method: Level): string {
  switch (method) {
    case 'debug': return 'debug';
    case 'info':  return 'info';
    case 'warn':  return 'warn';
    case 'error': return 'error';
    case 'log':
    default:      return 'info';
  }
}

function forward(level: string, target: string, message: string) {
  // Fire-and-forget. If the IPC fails the user still sees the dev
  // console (in debug builds) — we never want a logger to throw and
  // disturb the caller.
  invoke('app_log', { level, target, message }).catch(() => { /* ignore */ });
}

export function installLogForwarder() {
  if (installed) return;
  installed = true;

  const methods: Level[] = ['log', 'info', 'warn', 'error', 'debug'];
  for (const m of methods) {
    const original = console[m] as (...args: unknown[]) => void;
    console[m] = (...args: unknown[]) => {
      // Preserve dev-tools behaviour first.
      try { original.apply(console, args); } catch { /* ignore */ }
      // Forward to backend rolling log.
      try {
        const message = args.map(stringifyArg).join(' ');
        forward(levelFor(m), 'frontend', message);
      } catch { /* ignore */ }
    };
  }

  // Uncaught exceptions — these don't pass through console.error
  // automatically, so wire them explicitly. Window 'error' fires for
  // synchronous throws, ResizeObserver loop errors, image load
  // failures, etc.
  window.addEventListener('error', (ev: ErrorEvent) => {
    const where = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '<unknown>';
    const detail = ev.error instanceof Error
      ? `${ev.error.name}: ${ev.error.message}${ev.error.stack ? `\n${ev.error.stack}` : ''}`
      : stringifyArg(ev.message);
    forward('error', 'frontend.window', `${detail} (at ${where})`);
  });

  // Unhandled promise rejections — same idea, this is a separate event.
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    const detail = reason instanceof Error
      ? `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
      : stringifyArg(reason);
    forward('error', 'frontend.unhandledrejection', detail);
  });
}
