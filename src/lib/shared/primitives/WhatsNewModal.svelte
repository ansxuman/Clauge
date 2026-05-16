<script lang="ts">
  import { updateAvailable, showWhatsNewModal, whatsNewContent, restartToUpdate, openChangelogPage, renderReleaseMarkdown } from '$lib/utils/updater';
  import { onMount, onDestroy } from 'svelte';

  function close() {
    showWhatsNewModal.set(false);
  }

  function handleRestart() {
    close();
    // restartToUpdate already routes info-only updates to the changelog
    // page, but we call openChangelogPage directly here so the UI thread
    // doesn't briefly try to install. Functionally identical for the
    // installable path, since this branch only runs when !infoOnly.
    if ($updateAvailable?.infoOnly) {
      openChangelogPage();
    } else {
      restartToUpdate();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && $showWhatsNewModal) {
      e.preventDefault();
      close();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if $showWhatsNewModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="wn-overlay" onclick={handleOverlayClick}>
    <div class="wn-modal modal-card">
      {#if $updateAvailable}
        <div class="wn-hdr">
          <span class="wn-title">Update Available — v{$updateAvailable.version}</span>
          <button class="wn-close" onclick={close}>&times;</button>
        </div>
        <div class="wn-body">{@html renderReleaseMarkdown($updateAvailable.body)}</div>
        <div class="wn-actions">
          <button class="wn-btn" onclick={close}>Later</button>
          <button class="wn-btn wn-btn-primary" onclick={handleRestart}>
            {$updateAvailable.infoOnly ? 'Download' : 'Restart Now'}
          </button>
        </div>
      {:else if $whatsNewContent}
        <div class="wn-hdr">
          <span class="wn-title">What's New in v{$whatsNewContent.version}</span>
          <button class="wn-close" onclick={close}>&times;</button>
        </div>
        <div class="wn-body">{@html renderReleaseMarkdown($whatsNewContent.body)}</div>
        <div class="wn-actions">
          <button class="wn-btn" onclick={close}>Got it</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .wn-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--scrim);
    backdrop-filter: blur(8px);
    z-index: var(--z-modal);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: wnFadeIn 0.15s ease;
  }

  @keyframes wnFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .wn-modal {
    width: 480px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    animation: wnUp 0.18s ease;
    overflow: hidden;
  }

  @keyframes wnUp {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: none; }
  }

  .wn-hdr {
    display: flex;
    align-items: center;
    padding: 14px 18px;
    border-bottom: 1px solid var(--b1);
    background: var(--e);
    flex-shrink: 0;
  }

  .wn-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--t1);
    font-family: var(--ui);
  }

  .wn-close {
    margin-left: auto;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--b1);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    transition: background 0.12s;
    color: var(--t3);
    font-size: 16px;
  }

  .wn-close:hover {
    background: var(--c);
    color: var(--t1);
  }

  .wn-body {
    padding: 18px;
    overflow-y: auto;
    color: var(--t2);
    font-size: 13px;
    font-family: var(--ui);
    line-height: 1.6;
  }

  .wn-body :global(h3) {
    font-size: 15px;
    font-weight: 600;
    color: var(--t1);
    margin: 12px 0 6px;
  }

  .wn-body :global(h4) {
    font-size: 13px;
    font-weight: 600;
    color: var(--t1);
    margin: 10px 0 4px;
  }

  .wn-body :global(strong) {
    color: var(--t1);
    font-weight: 600;
  }

  .wn-body :global(code) {
    background: var(--surface-hover);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 12px;
  }

  .wn-body :global(ul) {
    list-style: none;
    padding-left: 0;
    margin: 4px 0;
  }

  .wn-body :global(li) {
    position: relative;
    padding-left: 14px;
    margin: 3px 0;
  }

  .wn-body :global(li::before) {
    content: '\2022';
    position: absolute;
    left: 0;
    color: var(--acc, var(--t3));
  }

  .wn-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--b1);
    flex-shrink: 0;
  }

  .wn-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
    font-size: 12px;
    font-family: var(--ui);
    cursor: default;
    transition: background 0.12s;
  }

  .wn-btn:hover {
    background: var(--surface-hover);
    color: var(--t1);
  }

  .wn-btn-primary {
    background: var(--acc, #7c5cf8);
    color: #fff;
    border-color: transparent;
  }

  .wn-btn-primary:hover {
    filter: brightness(1.1);
    background: var(--acc, #7c5cf8);
    color: #fff;
  }
</style>
