<script lang="ts">
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { isMac, isWindows } from '$lib/utils/platform';
  import { PROVIDER_INSTALL_INFO, type AgentProvider } from './providers';

  interface Props {
    show: boolean;
    provider: AgentProvider;
  }
  let { show = $bindable(false), provider }: Props = $props();

  const info = $derived(PROVIDER_INSTALL_INFO[provider]);
  const platform = isMac() ? 'mac' : isWindows() ? 'windows' : 'linux';
  const commands = $derived(info[platform]);

  let copiedCmd = $state<string | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedCmd = text;
      setTimeout(() => { copiedCmd = null; }, 2000);
    } catch (_) {}
  }

  async function openDocs() {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(info.docsUrl);
    } catch (_) {}
  }
</script>

<Modal bind:show title="{info.name} Not Found" width="440px">
  <div class="cn-body">
    <p class="cn-desc">
      {info.name} wasn't found on your <code class="cn-code">PATH</code>.
      Install it to start agent sessions.
    </p>

    {#each commands as c (c.label)}
      <div class="cn-section">
        <span class="cn-label">{c.label}</span>
        <div class="cn-cmd-block">
          <code>{c.cmd}</code>
          <button
            class="cn-copy"
            onclick={() => copy(c.cmd)}
            title="Copy"
            aria-label="Copy command"
          >
            {#if copiedCmd === c.cmd}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {:else}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>
    {/each}

    <div class="cn-after">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      After installing, restart Clauge so it picks up your updated <code class="cn-code">PATH</code>.
    </div>

    <div class="cn-footer">
      <button class="cn-btn-docs" onclick={openDocs}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Setup docs
      </button>
      <button class="cn-btn-close" onclick={() => (show = false)}>Close</button>
    </div>
  </div>
</Modal>

<style>
  .cn-body { display: flex; flex-direction: column; gap: 12px; }
  .cn-desc { margin: 0; font-size: 13px; color: var(--t2); line-height: 1.55; }
  .cn-code {
    font-family: var(--mono, monospace);
    font-size: 11.5px;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 4px;
    padding: 1px 5px;
    color: var(--t1);
  }
  .cn-section { display: flex; flex-direction: column; gap: 5px; }
  .cn-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--t3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-family: var(--ui);
  }
  .cn-cmd-block {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 8px;
    padding: 10px 14px;
  }
  .cn-cmd-block code {
    flex: 1;
    font-family: var(--mono, monospace);
    font-size: 13px;
    color: var(--acc);
    user-select: all;
  }
  .cn-copy {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--b1);
    border-radius: 6px;
    background: transparent;
    color: var(--t3);
    cursor: default;
    transition: color 0.1s, border-color 0.1s, background 0.1s;
  }
  .cn-copy:hover {
    color: var(--t1);
    border-color: var(--b2);
    background: var(--surface-hover);
  }
  .cn-after {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 12px;
    color: var(--t3);
    line-height: 1.5;
    padding: 9px 12px;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 8px;
  }
  .cn-after svg { flex-shrink: 0; margin-top: 1px; color: var(--t3); }
  .cn-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
  .cn-btn-docs {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
    font-size: 12px;
    font-family: var(--ui);
    cursor: default;
    transition: border-color 0.1s, color 0.1s;
  }
  .cn-btn-docs:hover { border-color: var(--acc); color: var(--acc); }
  .cn-btn-close {
    height: 30px;
    padding: 0 16px;
    border-radius: 8px;
    border: none;
    background: var(--acc);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--ui);
    cursor: default;
    transition: opacity 0.12s;
  }
  .cn-btn-close:hover { opacity: 0.85; }
</style>
