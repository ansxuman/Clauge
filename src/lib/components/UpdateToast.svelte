<script>
  import { updater } from "$lib/stores/updater.svelte";

  let {
    appVersion,
    onOpenExternal,
  } = $props();
</script>

{#if updater.updateReady && !updater.updateDismissed}
  <div class="update-notif">
    <div class="un-header">
      <svg class="un-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <div class="un-text">
        <span class="un-title">Clauge v{updater.updateReady.version} is available</span>
        <span class="un-desc">A new version has been downloaded. Restart to apply.</span>
      </div>
      <button class="un-close" onclick={() => updater.updateDismissed = true}>&times;</button>
    </div>
    <div class="un-actions">
      <button class="un-btn primary" onclick={() => { updater.restartToUpdate(); }}>Restart to Update</button>
      <button class="un-btn secondary" onclick={() => onOpenExternal('https://clauge.ssh-i.in/changelog.html')}>
        What's New
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    </div>
  </div>
{/if}

{#if updater.showWhatsNew}
<div class="modal-backdrop">
  <div class="modal whats-new-modal">
    {#if updater.updateReady}
      <h2>v{updater.updateReady.version}</h2>
      <div class="whats-new-body">{@html (updater.updateReady.body || '')
        .replace(/\r\n/g, '\n')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
        .replace(/\n\n+/g, '<br>')
        .replace(/\n/g, '<br>')
      }</div>
      <div class="modal-actions">
        <button onclick={() => updater.showWhatsNew = false}>Later</button>
        <button class="create-btn" onclick={() => { updater.showWhatsNew = false; updater.restartToUpdate(); }}>Restart</button>
      </div>
    {:else}
      <h2>What's New in v{appVersion}</h2>
      <div class="whats-new-body">{@html updater.whatsNewBody
        .replace(/\r\n/g, '\n')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
        .replace(/\n\n+/g, '<br>')
        .replace(/\n/g, '<br>')
      }</div>
      <div class="modal-actions">
        <button onclick={() => updater.showWhatsNew = false}>Got it</button>
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  .update-notif { position: fixed; bottom: 40px; right: 16px; width: 320px; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); padding: 14px; z-index: 900; animation: unSlideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; gap: 12px; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
  @keyframes unSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .un-header { display: flex; align-items: flex-start; gap: 10px; }
  .un-icon { width: 18px; height: 18px; stroke: var(--accent); fill: none; stroke-width: 1.6; stroke-linecap: round; flex-shrink: 0; margin-top: 1px; }
  .un-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .un-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .un-desc { font-size: 11px; color: var(--text-secondary); }
  .un-close { width: 20px; height: 20px; border: none; background: transparent; color: var(--text-secondary); font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; flex-shrink: 0; line-height: 1; transition: color 0.1s; }
  .un-close:hover { color: var(--text-primary); }
  .un-actions { display: flex; gap: 8px; }
  .un-btn { height: 30px; padding: 0 14px; border-radius: 6px; font-size: 12px; font-family: inherit; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; transition: opacity 0.12s; }
  .un-btn.primary { border: none; background: var(--accent); color: #fff; }
  .un-btn.primary:hover { opacity: 0.85; }
  .un-btn.secondary { border: 1px solid var(--border); background: transparent; color: var(--text-secondary); }
  .un-btn.secondary:hover { border-color: var(--text-secondary); color: var(--text-primary); }
  .un-btn.secondary svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn 0.15s ease-out; }
  .modal { background: var(--modal-bg, #161b22); border: 1px solid var(--border); border-radius: 12px; padding: 20px; width: 420px; max-width: 90vw; animation: slideIn 0.2s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(-10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .modal h2 { font-size: 15px; color: var(--text-primary); margin: 0 0 16px; }
  .whats-new-modal { max-height: 70vh; display: flex; flex-direction: column; }
  .whats-new-body { flex: 1; overflow-y: auto; font-size: 13px; color: var(--text-secondary); line-height: 1.7; padding: 4px 0 12px; }
  .whats-new-body :global(h2) { font-size: 15px; color: var(--text-primary); margin: 14px 0 6px; font-weight: 600; }
  .whats-new-body :global(h3) { font-size: 15px; color: var(--text-primary); margin: 14px 0 6px; font-weight: 600; }
  .whats-new-body :global(h4) { font-size: 13px; color: var(--text-primary); margin: 10px 0 4px; font-weight: 500; }
  .whats-new-body :global(ul) { padding-left: 16px; margin: 4px 0; }
  .whats-new-body :global(li) { margin-bottom: 3px; }
  .whats-new-body :global(code) { font-family: monospace; font-size: 11px; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; }
  .whats-new-body :global(strong) { color: var(--text-primary); font-weight: 600; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  .modal-actions button { padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid var(--border); background: var(--btn-bg, #21262d); color: var(--text-primary); font-family: inherit; }
  .create-btn { background: var(--accent) !important; border-color: transparent !important; color: #fff !important; }
</style>
