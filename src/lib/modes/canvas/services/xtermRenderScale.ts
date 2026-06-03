import { get } from 'svelte/store';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { viewport, interactionState } from '$lib/modes/canvas/stores/canvasStore';
import { agentTerminalMap } from '$lib/modes/agent/stores';
import { sshTerminalMap } from '$lib/modes/ssh/stores';
import { shellTerminals } from '$lib/modes/canvas/stores/shellTerminalsStore';

export const RENDER_SCALE_STEPS: number[] = [1.0, 1.5, 2.0, 2.5];
export const BASE_FONT = 13;

const MIN_STEP = RENDER_SCALE_STEPS[0];
const MAX_STEP = RENDER_SCALE_STEPS[RENDER_SCALE_STEPS.length - 1];
const SNAP_DEBOUNCE_MS = 150;
const TILE_SLOT_SELECTOR = '.cv-tile-body';

export function snapRenderScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_STEP;
  if (zoom <= MIN_STEP) return MIN_STEP;
  if (zoom >= MAX_STEP) return MAX_STEP;
  let snapped = MIN_STEP;
  for (const step of RENDER_SCALE_STEPS) {
    if (step <= zoom) snapped = step;
    else break;
  }
  return snapped;
}

export type RenderScaleCallback = (step: number) => void;

export function subscribeRenderScale(callback: RenderScaleCallback): () => void {
  let current = snapRenderScale(get(viewport).zoom);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (next: number) => {
    if (next === current) return;
    current = next;
    callback(next);
  };

  const unsubscribe = viewport.subscribe((v) => {
    const next = snapRenderScale(v.zoom);
    if (next === current) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fire(snapRenderScale(get(viewport).zoom));
    }, SNAP_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

interface XtermLike {
  container?: HTMLElement | null;
  term?: Terminal;
  fitAddon?: FitAddon;
}

function isInCanvasTile(container: HTMLElement | null | undefined): boolean {
  if (!container) return false;
  return container.closest(TILE_SLOT_SELECTOR) !== null;
}

function applyToEntry(entry: XtermLike, step: number): void {
  const term = entry.term;
  const fitAddon = entry.fitAddon;
  if (!term || !fitAddon) return;
  if (!isInCanvasTile(entry.container)) return;
  const nextFont = Math.round(BASE_FONT * step);
  if (term.options.fontSize === nextFont) return;
  try {
    term.options.fontSize = nextFont;
    fitAddon.fit();
  } catch (err) {
    console.error('[canvas] render-scale apply failed:', err);
  }
}

export function applyRenderScale(step: number): void {
  for (const entry of get(agentTerminalMap).values()) {
    applyToEntry(
      { container: entry?.container, term: entry?.term, fitAddon: entry?.fitAddon },
      step,
    );
  }
  for (const entry of get(sshTerminalMap).values()) {
    applyToEntry(
      { container: entry?.container, term: entry?.term, fitAddon: entry?.fitAddon },
      step,
    );
  }
  for (const entry of get(shellTerminals).values()) {
    const internal = entry?.internal;
    if (!internal) continue;
    applyToEntry(
      { container: internal.container, term: internal.term, fitAddon: internal.fitAddon },
      step,
    );
  }
}

export function startRenderScaleSync(): () => void {
  let pending: number | null = null;

  const flushIfIdle = (step: number) => {
    if (get(interactionState) === 'idle') {
      pending = null;
      applyRenderScale(step);
    } else {
      pending = step;
    }
  };

  const unsubscribeScale = subscribeRenderScale((step) => {
    flushIfIdle(step);
  });

  const unsubscribeInteraction = interactionState.subscribe((state) => {
    if (state !== 'idle') return;
    if (pending === null) return;
    const step = pending;
    pending = null;
    applyRenderScale(step);
  });

  const initial = snapRenderScale(get(viewport).zoom);
  flushIfIdle(initial);

  return () => {
    unsubscribeScale();
    unsubscribeInteraction();
    pending = null;
  };
}
