import { get } from 'svelte/store';
import {
  regionsById,
  tilesByTab,
  tilesByRegion,
  interactionState,
  markRegionDirty,
  markTileDirty,
  viewport,
} from '$lib/modes/canvas/stores/canvasStore';

interface RegionDraggableParams {
  regionId: string;
}

/**
 * Drag a region body and cascade-translate every child tile in lockstep.
 * Snapshots origin and child positions on pointerdown, then applies the
 * pointer delta as a single batched update each frame — keeps the region
 * and its tiles in sync without per-frame index lookups.
 */
export function regionDraggable(node: HTMLElement, params: RegionDraggableParams) {
  let regionId = params.regionId;
  let dragging = false;
  let pointerId: number | null = null;
  let startCanvasX = 0;
  let startCanvasY = 0;
  let startRegionX = 0;
  let startRegionY = 0;
  let childSnapshot: { tabId: string; x: number; y: number }[] = [];

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // Don't start a drag if the user clicked a button or an inline editor.
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, [contenteditable="true"]')) return;
    const region = get(regionsById).get(regionId);
    if (!region) return;
    e.stopPropagation();
    e.preventDefault();
    dragging = true;
    pointerId = e.pointerId;
    node.setPointerCapture(e.pointerId);
    const v = get(viewport);
    startCanvasX = (e.clientX - v.offsetX) / v.zoom;
    startCanvasY = (e.clientY - v.offsetY) / v.zoom;
    startRegionX = region.x;
    startRegionY = region.y;
    const children = get(tilesByRegion).get(regionId) ?? [];
    childSnapshot = children.map((c) => ({ tabId: c.tabId, x: c.x, y: c.y }));
    interactionState.set('dragging');
    document.body.classList.add('cv-interacting');
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    const v = get(viewport);
    const curCanvasX = (e.clientX - v.offsetX) / v.zoom;
    const curCanvasY = (e.clientY - v.offsetY) / v.zoom;
    const dx = curCanvasX - startCanvasX;
    const dy = curCanvasY - startCanvasY;
    regionsById.update((m) => {
      const next = new Map(m);
      const cur = next.get(regionId);
      if (cur) next.set(regionId, { ...cur, x: startRegionX + dx, y: startRegionY + dy });
      return next;
    });
    if (childSnapshot.length > 0) {
      tilesByTab.update((m) => {
        const next = new Map(m);
        for (const snap of childSnapshot) {
          const cur = next.get(snap.tabId);
          if (cur) next.set(snap.tabId, { ...cur, x: snap.x + dx, y: snap.y + dy });
        }
        return next;
      });
    }
  }

  function endDrag(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    try {
      node.releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be released.
    }
    interactionState.set('idle');
    document.body.classList.remove('cv-interacting');
    markRegionDirty(regionId);
    for (const snap of childSnapshot) markTileDirty(snap.tabId);
    childSnapshot = [];
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);

  return {
    update(p: RegionDraggableParams) {
      regionId = p.regionId;
    },
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', endDrag);
      node.removeEventListener('pointercancel', endDrag);
      if (dragging) document.body.classList.remove('cv-interacting');
    },
  };
}
