import { get } from 'svelte/store';
import { viewport } from '$lib/modes/canvas/stores/canvasStore';

const EVENT_NAMES = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
] as const;

/**
 * Compensate xterm's pointer-cell math when CanvasWorld's CSS transform is
 * scaled != 1.0.
 *
 * Why this exists:
 *
 * CanvasWorld renders its children inside `transform: scale(zoom)`. xterm
 * computes the cell a click landed on as `(clientX - element.rect.left) /
 * cellWidth`. `rect` from `getBoundingClientRect()` is post-transform (in
 * screen pixels) but `cellWidth` is xterm's internal CSS-pixel value, so at
 * zoom 0.5 the math comes out off by a factor of 1 / zoom. The visible
 * highlight and the actual selected range drift apart and "drag to copy"
 * grabs the wrong text.
 *
 * Fix: in the capture phase, before pointer events reach xterm's listeners,
 * we override `clientX` / `clientY` so that `clientX - rect.left` equals
 * the rel-in-css-pixels xterm expects.
 *
 *     adjusted = rect.left + (clientX - rect.left) / zoom
 *
 * We only touch events whose target is inside a `.xterm` root, so tile drag,
 * resize, CodeMirror, etc. see the original coords.
 */
export function installXtermPointerCompensation(host: HTMLElement): () => void {
  const adjust = (e: PointerEvent | MouseEvent) => {
    const v = get(viewport);
    if (v.zoom === 1) return;
    if (!(e.target instanceof Element)) return;
    const xtermRoot = e.target.closest('.xterm') as HTMLElement | null;
    if (!xtermRoot) return;
    const rect = xtermRoot.getBoundingClientRect();
    const newClientX = rect.left + (e.clientX - rect.left) / v.zoom;
    const newClientY = rect.top + (e.clientY - rect.top) / v.zoom;
    try {
      Object.defineProperty(e, 'clientX', { value: newClientX, configurable: true });
      Object.defineProperty(e, 'clientY', { value: newClientY, configurable: true });
      Object.defineProperty(e, 'pageX', { value: newClientX + window.scrollX, configurable: true });
      Object.defineProperty(e, 'pageY', { value: newClientY + window.scrollY, configurable: true });
    } catch {
      // Some browsers may refuse defineProperty on certain event props; fall
      // through with original coords rather than breaking the gesture entirely.
    }
  };

  for (const name of EVENT_NAMES) {
    host.addEventListener(name, adjust, { capture: true });
  }
  return () => {
    for (const name of EVENT_NAMES) {
      host.removeEventListener(name, adjust, { capture: true } as EventListenerOptions);
    }
  };
}
