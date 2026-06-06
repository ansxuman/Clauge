<script lang="ts">
  import { tick } from 'svelte';
  import type { CanvasRegion as Region } from '$lib/modes/canvas/commands';
  import {
    regionsById,
    markRegionDirty,
    tilesByRegion,
    tilesByTab,
    markTileDirty,
  } from '$lib/modes/canvas/stores/canvasStore';
  import { canvasDeleteRegion } from '$lib/modes/canvas/commands';
  import { regionDraggable } from '$lib/modes/canvas/actions/regionDraggable';
  import { regionResizable } from '$lib/modes/canvas/actions/regionResizable';

  let { region }: { region: Region } = $props();

  let editingName = $state(false);
  let nameInput = $state<HTMLInputElement | undefined>();
  let menuOpen = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let confirmOpen = $state(false);

  async function startRename() {
    editingName = true;
    await tick();
    nameInput?.focus();
    nameInput?.select();
  }

  function commitName(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim() || 'Region';
    if (value !== region.name) {
      regionsById.update((m) => {
        const next = new Map(m);
        const cur = next.get(region.regionId);
        if (cur) next.set(region.regionId, { ...cur, name: value });
        return next;
      });
      markRegionDirty(region.regionId);
    }
    editingName = false;
  }

  function onNameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      editingName = false;
    }
  }

  function openContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    menuX = e.clientX;
    menuY = e.clientY;
    menuOpen = true;
  }

  function closeMenu() {
    menuOpen = false;
  }

  async function deleteRegion(deleteChildren: boolean) {
    menuOpen = false;
    confirmOpen = false;
    try {
      await canvasDeleteRegion(region.workspaceId, region.regionId, deleteChildren);
    } catch {
      // Best-effort; if the delete fails the next reload picks up the truth.
    }
    regionsById.update((m) => {
      const next = new Map(m);
      next.delete(region.regionId);
      return next;
    });
    const children = $tilesByRegion.get(region.regionId) ?? [];
    if (deleteChildren) {
      tilesByTab.update((m) => {
        const next = new Map(m);
        for (const t of children) next.delete(t.tabId);
        return next;
      });
    } else {
      tilesByTab.update((m) => {
        const next = new Map(m);
        for (const t of children) {
          const cur = next.get(t.tabId);
          if (cur) next.set(t.tabId, { ...cur, regionId: null });
        }
        return next;
      });
      for (const t of children) markTileDirty(t.tabId);
    }
  }

  const childCount = $derived($tilesByRegion.get(region.regionId)?.length ?? 0);
  const fillStyle = $derived(`background: color-mix(in srgb, ${region.color} 12%, transparent);`);
  const borderStyle = $derived(`border: 1px solid ${region.color};`);

  const handles: { dir: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'; cursor: string }[] = [
    { dir: 'ne', cursor: 'nesw-resize' },
    { dir: 'nw', cursor: 'nwse-resize' },
    { dir: 'se', cursor: 'nwse-resize' },
    { dir: 'sw', cursor: 'nesw-resize' },
  ];
</script>

<div
  class="cv-region"
  style="left: {region.x}px; top: {region.y}px; width: {region.width}px; height: {region.height}px; z-index: {region.zOrder}; {fillStyle} {borderStyle}"
  oncontextmenu={openContextMenu}
  use:regionDraggable={{ regionId: region.regionId }}
>
  <div class="cv-region-label" style="color: {region.color};">
    {#if editingName}
      <input
        bind:this={nameInput}
        class="cv-region-name-input"
        value={region.name}
        onblur={commitName}
        onkeydown={onNameKey}
        style="color: {region.color};"
      />
    {:else}
      <button
        type="button"
        class="cv-region-name"
        ondblclick={startRename}
      >{region.name}</button>
    {/if}
    {#if childCount > 0}<span class="cv-region-count">{childCount}</span>{/if}
  </div>

  {#each handles as h (h.dir)}
    <div
      class="cv-region-handle cv-rh-{h.dir}"
      style="cursor: {h.cursor};"
      use:regionResizable={{ regionId: region.regionId, dir: h.dir }}
    ></div>
  {/each}
</div>

{#if menuOpen}
  <div
    class="cv-region-menu"
    style="left: {menuX}px; top: {menuY}px;"
    onpointerdown={(e) => e.stopPropagation()}
  >
    <button type="button" onclick={() => { closeMenu(); void startRename(); }}>Rename</button>
    <button type="button" onclick={() => { menuOpen = false; confirmOpen = true; }}>Delete…</button>
  </div>
  <div
    class="cv-region-menu-scrim"
    onpointerdown={closeMenu}
    onclick={closeMenu}
    role="presentation"
  ></div>
{/if}

{#if confirmOpen}
  <div
    class="cv-region-confirm-scrim"
    onpointerdown={() => (confirmOpen = false)}
    role="presentation"
  ></div>
  <div class="cv-region-confirm" onpointerdown={(e) => e.stopPropagation()}>
    <div class="cv-region-confirm-title">Delete &ldquo;{region.name}&rdquo;?</div>
    <div class="cv-region-confirm-body">
      {#if childCount === 0}
        This region has no tiles inside it.
      {:else}
        Delete the {childCount} tile{childCount === 1 ? '' : 's'} inside it as well, or detach them?
      {/if}
    </div>
    <div class="cv-region-confirm-actions">
      <button type="button" onclick={() => (confirmOpen = false)}>Cancel</button>
      {#if childCount > 0}
        <button type="button" onclick={() => deleteRegion(false)}>Detach tiles</button>
        <button type="button" class="danger" onclick={() => deleteRegion(true)}>Delete with tiles</button>
      {:else}
        <button type="button" class="danger" onclick={() => deleteRegion(false)}>Delete</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cv-region {
    position: absolute;
    border-radius: 10px;
    pointer-events: auto;
    cursor: grab;
    contain: layout paint;
  }
  .cv-region:active {
    cursor: grabbing;
  }
  .cv-region-label {
    position: absolute;
    top: -22px;
    left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--ui);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    user-select: none;
  }
  .cv-region-name {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: text;
  }
  .cv-region-name-input {
    background: var(--c);
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 1px 6px;
    font: inherit;
    outline: none;
    min-width: 80px;
  }
  .cv-region-count {
    font-weight: 500;
    color: var(--t3);
    font-size: 11px;
  }
  .cv-region-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    z-index: 1;
  }
  .cv-rh-ne { top: -7px; right: -7px; }
  .cv-rh-nw { top: -7px; left: -7px; }
  .cv-rh-se { bottom: -7px; right: -7px; }
  .cv-rh-sw { bottom: -7px; left: -7px; }

  .cv-region-menu {
    position: fixed;
    z-index: 1000;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 6px;
    padding: 3px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 140px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .cv-region-menu button {
    background: transparent;
    border: none;
    text-align: left;
    padding: 6px 10px;
    color: var(--t1);
    font: 12px var(--ui);
    border-radius: 3px;
    cursor: pointer;
  }
  .cv-region-menu button:hover {
    background: var(--surface-hover);
  }
  .cv-region-menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 999;
  }

  .cv-region-confirm-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    z-index: 1001;
  }
  .cv-region-confirm {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1002;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 8px;
    padding: 18px 20px;
    width: 360px;
    max-width: calc(100vw - 32px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    font-family: var(--ui);
  }
  .cv-region-confirm-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--t1);
  }
  .cv-region-confirm-body {
    font-size: 13px;
    color: var(--t2);
    margin-bottom: 16px;
    line-height: 1.5;
  }
  .cv-region-confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .cv-region-confirm-actions button {
    background: var(--surface-hover);
    color: var(--t1);
    border: 1px solid var(--b1);
    border-radius: 4px;
    padding: 6px 14px;
    font: 12px var(--ui);
    cursor: pointer;
  }
  .cv-region-confirm-actions button:hover {
    border-color: var(--b2);
  }
  .cv-region-confirm-actions button.danger {
    background: #b34141;
    color: white;
    border-color: #b34141;
  }
  .cv-region-confirm-actions button.danger:hover {
    background: #c04848;
    border-color: #c04848;
  }
</style>
