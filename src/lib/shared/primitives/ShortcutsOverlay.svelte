<script lang="ts">
  interface Props {
    show: boolean;
    onclose?: () => void;
  }

  import { mod as platformMod } from '$lib/utils/platform';

  let { show, onclose }: Props = $props();

  const mod = platformMod();

  const shortcuts = [
    [`${mod}+Enter`, 'Send request / Run query'],
    [`${mod}+1`, 'Switch to REST'],
    [`${mod}+2`, 'Switch to SQL'],
    [`${mod}+3`, 'Switch to NoSQL'],
    [`${mod}+B`, 'Toggle nav panel'],
    [`${mod}+L`, 'Toggle AI assistant'],
    [`${mod}+/`, 'Show shortcuts'],
    ['?', 'Show shortcuts (when not in input)'],
    ['Escape', 'Close modal/overlay']
  ];

  function close() {
    onclose?.();
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="shortcuts-overlay" onclick={handleOverlayClick}>
    <div class="shortcuts-card">
      <div class="shortcuts-title">Keyboard Shortcuts</div>
      <div class="shortcuts-grid">
        {#each shortcuts as [key, desc]}
          <div class="shortcuts-key">
            <span class="kbd">{key}</span>
          </div>
          <div class="shortcuts-desc">{desc}</div>
        {/each}
      </div>
      <div class="shortcuts-dismiss">Press Escape or click to dismiss</div>
    </div>
  </div>
{/if}

<style>
  .shortcuts-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--scrim);
    backdrop-filter: blur(6px);
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .shortcuts-card {
    background: var(--n);
    border: 1px solid var(--b1);
    border-radius: 10px;
    padding: 24px 32px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    min-width: 380px;
    animation: modalUp 0.18s ease;
  }

  @keyframes modalUp {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }

  .shortcuts-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--t1);
    margin-bottom: 18px;
    font-family: var(--ui);
  }

  .shortcuts-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 20px;
  }

  .shortcuts-key {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--t1);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .shortcuts-key :global(.kbd) {
    padding: 2px 7px;
    font-size: 11px;
  }

  .shortcuts-desc {
    font-size: 12px;
    color: var(--t2);
    font-family: var(--ui);
    display: flex;
    align-items: center;
  }

  .shortcuts-dismiss {
    margin-top: 16px;
    text-align: center;
    font-size: 11px;
    color: var(--t3);
    font-family: var(--ui);
  }
</style>
