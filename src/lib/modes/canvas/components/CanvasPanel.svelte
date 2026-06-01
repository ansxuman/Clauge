<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    loadCanvas,
    flushViewportNow,
    flushDirtyTilesNow,
    setActiveWorkspace,
    viewport,
  } from '$lib/modes/canvas/stores/canvasStore';
  import { canvasGetViewport } from '$lib/modes/canvas/commands';
  import { canvasAdapterRegistry } from '$lib/modes/canvas/adapter-registry';
  import { stubBlockAdapter } from '$lib/modes/canvas/adapters/stub-block';
  import CanvasViewport from './CanvasViewport.svelte';

  // Phase 2 stub: hardcoded workspace id so the surface mounts. Phase 4
  // wires this to the real active-workspace store.
  const ACTIVE_WORKSPACE_ID = '__phase2_stub__';

  // Register the stub adapter ONCE per session.
  if (!canvasAdapterRegistry.has(stubBlockAdapter.tabKind)) {
    canvasAdapterRegistry.register(stubBlockAdapter);
  }

  onMount(async () => {
    setActiveWorkspace(ACTIVE_WORKSPACE_ID);
    const v = await canvasGetViewport(ACTIVE_WORKSPACE_ID);
    viewport.set({ offsetX: v.offsetX, offsetY: v.offsetY, zoom: v.zoom });

    // Phase 3 stub: feed the registered adapter's tab list into the resolver.
    const openTabs = stubBlockAdapter
      .listOpenTabs(ACTIVE_WORKSPACE_ID)
      .map((t) => ({ tabKind: stubBlockAdapter.tabKind, tabId: t.id }));
    await loadCanvas(ACTIVE_WORKSPACE_ID, openTabs);
  });

  onDestroy(() => {
    // Svelte does not await async onDestroy callbacks; fire-and-forget.
    void flushViewportNow();
    void flushDirtyTilesNow();
  });
</script>

<div class="cv-panel">
  <CanvasViewport />
</div>

<style>
  .cv-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
</style>
