<script lang="ts">
  import CanvasGrid from './CanvasGrid.svelte';
  import CanvasWorld from './CanvasWorld.svelte';
  import CanvasOverlay from './CanvasOverlay.svelte';
  import CanvasToolbar from './CanvasToolbar.svelte';
  import { pannable } from '$lib/modes/canvas/actions/pannable';
  import { zoomable } from '$lib/modes/canvas/actions/zoomable';
  import { tilesByTab } from '$lib/modes/canvas/stores/canvasStore';

  const isEmpty = $derived($tilesByTab.size === 0);
</script>

<!-- Phase 3 TODO: restore per-tile context menus once tile content can host them. -->
<div
  class="cv-viewport"
  use:pannable
  use:zoomable
  oncontextmenu={(e: MouseEvent) => e.preventDefault()}
>
  <CanvasGrid />
  <CanvasWorld />
  <CanvasOverlay />
  <CanvasToolbar />
  {#if isEmpty}
    <div class="cv-empty">
      <div class="cv-empty-icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="8" height="7" rx="1.5"></rect>
          <rect x="13" y="4" width="8" height="11" rx="1.5"></rect>
          <rect x="3" y="13" width="8" height="7" rx="1.5"></rect>
          <rect x="13" y="17" width="8" height="3" rx="1"></rect>
        </svg>
      </div>
      <div class="cv-empty-title">Atlas is empty</div>
      <div class="cv-empty-sub">
        Open any tab — an Agent or SSH session, a REST request, a SQL or NoSQL query, a file browser, a workspace
        note or board — or click
        <svg class="cv-empty-inline-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        to spawn a shell here. Every window lands on this canvas for free-form multitasking.
      </div>
    </div>
  {/if}
</div>

<style>
  .cv-viewport {
    position: relative;
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--cv-bg, var(--n));
    overscroll-behavior: none;
    user-select: none;
  }
  .cv-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    pointer-events: none;
    color: var(--t2);
    text-align: center;
  }
  .cv-empty-icon {
    color: var(--t3);
    opacity: 0.6;
  }
  .cv-empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--t1);
    letter-spacing: 0.2px;
  }
  .cv-empty-sub {
    max-width: 440px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--t3);
  }
  .cv-empty-inline-icon {
    vertical-align: -2px;
    margin: 0 2px;
  }
</style>
