<script lang="ts">
  // Minimal action-aware banner that sits above the kanban columns.
  // Renders one of seven states based on the most recent scan result.
  // Each non-success state surfaces a single primary action so the
  // user always knows what to do next.

  import type { ProjectScanResult } from '../types';

  interface Props {
    /** Workspace's bound project path. Banner stays hidden if null. */
    projectPath: string | null;
    /** Result of the most recent scan, or null before any scan. */
    state: ProjectScanResult | null;
    /** Are we currently scanning? */
    busy?: boolean;
    /** Epoch ms of last successful sync — drives the "Synced 2m ago" pill. */
    lastSyncedAt?: number | null;
    /** "Sync now" / "Retry" pressed. */
    onsync?: () => void;
    /** User dismissed the banner — caller can hide it for this session. */
    ondismiss?: () => void;
  }

  let { projectPath, state, busy = false, lastSyncedAt = null, onsync, ondismiss }: Props = $props();

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  /** A live "X ago" string. Re-evaluated each time the banner re-renders
   *  (success state changes, busy toggles, dismissed flag flips), which
   *  is enough granularity for human-scale timestamps. No setInterval
   *  needed for v1 — costs more than it's worth. */
  function relTime(ts: number): string {
    const d = Date.now() - ts;
    if (d < 30_000) return 'just now';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
  }
</script>

{#if projectPath}
  <div
    class="sb"
    class:sb-success={state?.kind === 'success'}
    class:sb-warn={state && (state.kind === 'noRemote' || state.kind === 'unsupportedRemote' || state.kind === 'notGitRepo')}
    class:sb-action={state && (state.kind === 'toolNotInstalled' || state.kind === 'notAuthenticated' || state.kind === 'noAccess' || state.kind === 'networkError' || state.kind === 'apiError')}
  >
    <div class="sb-body">
      {#if busy}
        <span class="sb-dot sb-busy"></span>
        <span class="sb-text">Scanning {projectPath} for issues…</span>

      {:else if !state}
        <span class="sb-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.7.8 6.3 2.5L21 8"/><path d="M21 3v5h-5"/></svg>
        </span>
        <span class="sb-text">Pull open issues from this project's Git remote into the board.</span>
        <button class="sb-btn primary" onclick={() => onsync?.()} disabled={busy}>
          Sync issues
        </button>

      {:else if state.kind === 'success'}
        <span class="sb-icon sb-icon-ok">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <span class="sb-text">
          Imported <strong>{state.issues.length}</strong> {state.source === 'github' ? 'GitHub' : state.source === 'gitlab' ? 'GitLab' : ''} issue{state.issues.length === 1 ? '' : 's'} from <span class="sb-mono">{state.remote}</span>
        </span>
        {#if lastSyncedAt}
          <span class="sb-stamp">Synced {relTime(lastSyncedAt)}</span>
        {/if}
        <button class="sb-btn ghost" onclick={() => onsync?.()} disabled={busy}>Re-sync</button>

      {:else if state.kind === 'notGitRepo'}
        <span class="sb-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        </span>
        <span class="sb-text">This folder isn't a Git repository — nothing to pull.</span>

      {:else if state.kind === 'noRemote'}
        <span class="sb-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        </span>
        <span class="sb-text">No <span class="sb-mono">origin</span> remote — add one with <span class="sb-mono">git remote add origin &lt;url&gt;</span> and try again.</span>
        <button class="sb-btn ghost" onclick={() => onsync?.()} disabled={busy}>Retry</button>

      {:else if state.kind === 'unsupportedRemote'}
        <span class="sb-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
        </span>
        <span class="sb-text">Issue sync supports GitHub and GitLab only — <span class="sb-mono">{state.url}</span> isn't recognised.</span>

      {:else if state.kind === 'toolNotInstalled'}
        <span class="sb-icon sb-icon-warn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>
        </span>
        <span class="sb-text">
          <strong>{state.tool}</strong> isn't installed. {#if state.tool === 'gh'}Install GitHub CLI{:else}Install GitLab CLI{/if} to sync issues.
        </span>
        <a class="sb-btn primary" href={state.installUrl} target="_blank" rel="noopener">Install {state.tool}</a>
        <button class="sb-btn ghost" onclick={() => ondismiss?.()}>Skip</button>

      {:else if state.kind === 'notAuthenticated'}
        <span class="sb-icon sb-icon-warn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </span>
        <span class="sb-text">
          <strong>{state.tool}</strong> isn't signed in. Run this in a terminal, then retry:
          <button class="sb-cmd" onclick={() => copyToClipboard(state.loginCommand)} title="Copy">
            <span class="sb-mono">{state.loginCommand}</span>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </span>
        <button class="sb-btn primary" onclick={() => onsync?.()} disabled={busy}>Retry</button>

      {:else if state.kind === 'noAccess'}
        <!-- Most common multi-account confusion: gh is signed in to a
             different account that can't see this repo. Surface the
             specific repo + a clear "switch accounts" path. -->
        <span class="sb-icon sb-icon-warn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        </span>
        <span class="sb-text">
          <strong>{state.tool}</strong> is signed in to an account that can't access <span class="sb-mono">{state.repo}</span>. Switch accounts:
          <button class="sb-cmd" onclick={() => copyToClipboard(state.tool === 'gh' ? 'gh auth switch' : 'glab auth status')} title="Copy">
            <span class="sb-mono">{state.tool === 'gh' ? 'gh auth switch' : 'glab auth status'}</span>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          or sign in with the right one:
          <button class="sb-cmd" onclick={() => copyToClipboard(state.loginCommand)} title="Copy">
            <span class="sb-mono">{state.loginCommand}</span>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </span>
        <button class="sb-btn primary" onclick={() => onsync?.()} disabled={busy}>Retry</button>

      {:else if state.kind === 'networkError'}
        <span class="sb-icon sb-icon-warn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/></svg>
        </span>
        <span class="sb-text" title={state.message}>Network error: {state.message}. Retry in a moment.</span>
        <button class="sb-btn primary" onclick={() => onsync?.()} disabled={busy}>Retry</button>

      {:else if state.kind === 'apiError'}
        <span class="sb-icon sb-icon-warn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </span>
        <span class="sb-text" title={state.message}>Sync failed: {state.message.slice(0, 120)}{state.message.length > 120 ? '…' : ''}</span>
        <button class="sb-btn primary" onclick={() => onsync?.()} disabled={busy}>Retry</button>
      {/if}
    </div>

    {#if state && state.kind !== 'success' && state.kind !== 'apiError'}
      <button class="sb-x" onclick={() => ondismiss?.()} title="Dismiss">×</button>
    {/if}
  </div>
{/if}

<style>
  .sb {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    margin: 12px 16px 0;
    border: 1px solid var(--b1);
    border-radius: 8px;
    background: var(--surface-hover);
    font-family: var(--ui);
    font-size: 12px;
    color: var(--t2);
  }
  .sb-success {
    border-color: color-mix(in srgb, var(--state-saved) 35%, var(--b1));
    background: color-mix(in srgb, var(--state-saved) 8%, transparent);
  }
  .sb-warn {
    background: var(--surface-hover);
  }
  .sb-action {
    border-color: color-mix(in srgb, var(--acc) 35%, var(--b1));
    background: color-mix(in srgb, var(--acc) 6%, transparent);
  }
  .sb-body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .sb-icon {
    display: inline-flex;
    color: var(--t3);
    flex-shrink: 0;
  }
  .sb-icon-ok { color: var(--state-saved); }
  .sb-icon-warn { color: var(--acc); }
  .sb-text {
    color: var(--t1);
    line-height: 1.45;
    flex: 1;
    min-width: 200px;
  }
  .sb-text strong { color: var(--t1); font-weight: 600; }
  .sb-mono {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--t2);
    background: var(--surface-hover);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .sb-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--acc);
    flex-shrink: 0;
  }
  .sb-busy {
    animation: sbpulse 1.2s ease-in-out infinite;
  }
  @keyframes sbpulse {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .sb-btn {
    flex-shrink: 0;
    height: 26px;
    padding: 0 12px;
    border-radius: 5px;
    font-family: var(--ui);
    font-size: 11.5px;
    cursor: default;
    transition: opacity 0.12s, border-color 0.12s, color 0.12s, background 0.12s;
  }
  .sb-btn.primary {
    border: none;
    background: var(--acc);
    color: #fff;
    font-weight: 500;
  }
  .sb-btn.primary:hover:not(:disabled) { opacity: 0.9; }
  .sb-btn.primary:disabled { opacity: 0.5; }
  .sb-btn.ghost {
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
  }
  .sb-btn.ghost:hover { border-color: var(--b2); color: var(--t1); }
  .sb-cmd {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--b1);
    background: var(--surface-hover);
    color: var(--t1);
    padding: 2px 7px;
    border-radius: 4px;
    cursor: default;
    font-family: var(--mono);
    font-size: 11px;
    transition: border-color 0.12s;
  }
  .sb-cmd:hover { border-color: var(--acc); }
  .sb-x {
    border: none;
    background: transparent;
    color: var(--t3);
    font-size: 16px;
    line-height: 1;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: default;
    flex-shrink: 0;
  }
  .sb-x:hover { background: var(--surface-hover); color: var(--t1); }
  .sb-stamp {
    flex-shrink: 0;
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--t4);
    padding: 2px 7px;
    border-radius: 8px;
    background: var(--surface-hover);
  }
</style>
