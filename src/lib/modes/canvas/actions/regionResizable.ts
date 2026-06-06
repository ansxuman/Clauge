import { get } from 'svelte/store';
import {
  regionsById,
  interactionState,
  markRegionDirty,
  viewport,
} from '$lib/modes/canvas/stores/canvasStore';

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface RegionResizableParams {
  regionId: string;
  dir: Dir;
}

export const REGION_MIN_WIDTH = 200;
export const REGION_MIN_HEIGHT = 150;

/**
 * Resize a region from a corner or edge handle. Children inside the
 * region are NOT moved while resizing — only the region's bounds change,
 * and the spatial containment check on the next tile drop re-evaluates.
 */
export function regionResizable(node: HTMLElement, params: RegionResizableParams) {
  let regionId = params.regionId;
  let dir = params.dir;
  let resizing = false;
  let pointerId: number | null = null;
  let startCanvasX = 0;
  let startCanvasY = 0;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const region = get(regionsById).get(regionId);
    if (!region) return;
    e.stopPropagation();
    e.preventDefault();
    resizing = true;
    pointerId = e.pointerId;
    node.setPointerCapture(e.pointerId);
    const v = get(viewport);
    startCanvasX = (e.clientX - v.offsetX) / v.zoom;
    startCanvasY = (e.clientY - v.offsetY) / v.zoom;
    startX = region.x;
    startY = region.y;
    startW = region.width;
    startH = region.height;
    interactionState.set('resizing');
    document.body.classList.add('cv-interacting');
  }

  function onPointerMove(e: PointerEvent) {
    if (!resizing || e.pointerId !== pointerId) return;
    const v = get(viewport);
    const curX = (e.clientX - v.offsetX) / v.zoom;
    const curY = (e.clientY - v.offsetY) / v.zoom;
    const dx = curX - startCanvasX;
    const dy = curY - startCanvasY;
    let x = startX;
    let y = startY;
    let w = startW;
    let h = startH;
    if (dir.includes('e')) w = Math.max(REGION_MIN_WIDTH, startW + dx);
    if (dir.includes('w')) {
      const nw = Math.max(REGION_MIN_WIDTH, startW - dx);
      x = startX + (startW - nw);
      w = nw;
    }
    if (dir.includes('s')) h = Math.max(REGION_MIN_HEIGHT, startH + dy);
    if (dir.includes('n')) {
      const nh = Math.max(REGION_MIN_HEIGHT, startH - dy);
      y = startY + (startH - nh);
      h = nh;
    }
    regionsById.update((m) => {
      const next = new Map(m);
      const cur = next.get(regionId);
      if (cur) next.set(regionId, { ...cur, x, y, width: w, height: h });
      return next;
    });
  }

  function endResize(e: PointerEvent) {
    if (!resizing || e.pointerId !== pointerId) return;
    resizing = false;
    pointerId = null;
    try {
      node.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be released.
    }
    interactionState.set('idle');
    document.body.classList.remove('cv-interacting');
    markRegionDirty(regionId);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endResize);
  node.addEventListener('pointercancel', endResize);

  return {
    update(p: RegionResizableParams) {
      regionId = p.regionId;
      dir = p.dir;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endResize);
      node.removeEventListener('pointercancel', endResize);
      if (resizing) document.body.classList.remove('cv-interacting');
    },
  };
}
