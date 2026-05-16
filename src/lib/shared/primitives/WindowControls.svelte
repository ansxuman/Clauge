<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { ensureNotFullscreen } from '$lib/shared/utils/window';

  let hovering = $state(false);

  async function handleClose() {
    await getCurrentWindow().close();
  }

  async function handleMinimize() {
    await ensureNotFullscreen();
    await getCurrentWindow().minimize();
  }

  async function handleMaximize() {
    const win = getCurrentWindow();
    const isFs = await win.isFullscreen();
    await win.setFullscreen(!isFs);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="window-controls"
  onmouseenter={() => hovering = true}
  onmouseleave={() => hovering = false}
>
  <button class="wc-btn wc-close" onclick={handleClose} title="Close">
    {#if hovering}
      <svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg>
    {/if}
  </button>
  <button class="wc-btn wc-minimize" onclick={handleMinimize} title="Minimize">
    {#if hovering}
      <svg viewBox="0 0 12 12"><path d="M2.5 6h7"/></svg>
    {/if}
  </button>
  <button class="wc-btn wc-maximize" onclick={handleMaximize} title="Fullscreen">
    {#if hovering}
      <svg viewBox="0 0 12 12"><path d="M2 8l3 3M7 2l3 3" stroke-width="2"/></svg>
    {/if}
  </button>
</div>

<style>
  .window-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 4px;
    -webkit-app-region: no-drag;
  }
  .wc-btn {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: none;
    cursor: default;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: opacity 0.1s;
  }
  .wc-btn svg {
    width: 8px;
    height: 8px;
    stroke: rgba(0,0,0,0.5);
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .wc-close {
    background: #ff5f57;
  }
  .wc-minimize {
    background: #febc2e;
  }
  .wc-maximize {
    background: #28c840;
  }
  .wc-close:hover { background: #ff4136; }
  .wc-minimize:hover { background: #e5a800; }
  .wc-maximize:hover { background: #1aab29; }

  /* When window is not focused, dim the buttons */
  :global(.window-blurred) .wc-btn {
    background: var(--surface-hover);
  }
  :global(.window-blurred) .wc-btn svg {
    display: none;
  }
</style>
