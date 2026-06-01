<script lang="ts">
  import { onMount } from 'svelte';
  import { viewport, tilesSortedByZ } from '$lib/modes/canvas/stores/canvasStore';
  import CanvasTile from './CanvasTile.svelte';

  let worldEl: HTMLDivElement | undefined = $state();

  onMount(() => {
    const apply = (v: { offsetX: number; offsetY: number; zoom: number }) => {
      const el = worldEl;
      if (!el) return;
      el.style.transform = `scale(${v.zoom}) translate(${v.offsetX / v.zoom}px, ${v.offsetY / v.zoom}px)`;
      el.style.setProperty('--cv-zoom', String(v.zoom));
    };
    const unsubscribe = viewport.subscribe(apply);
    return () => unsubscribe();
  });
</script>

<div bind:this={worldEl} class="cv-world">
  {#each $tilesSortedByZ as tile (tile.tabId)}
    <CanvasTile {tile} />
  {/each}
</div>

<style>
  .cv-world {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    will-change: transform;
    pointer-events: none;
  }
</style>
