<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { agentFetchUsageLimits, agentGetUsageAnalytics } from '../commands';
  import { setSetting } from '$lib/stores/settings';
  import { agentSessionKey, agentUsageAuthStatus, agentUsageLimits, agentFooterProvider } from '../stores';
  import { showToast } from '$lib/shared/primitives/toast';
  import type { UsageAnalytics } from '../types';

  let { show = $bindable(false) } = $props();

  let days = $state(7);
  let loading = $state(false);
  let data = $state<UsageAnalytics | null>(null);
  let sessionKey = $state('');
  let keySaving = $state(false);

  function formatCost(n: number) { return '$' + n.toFixed(2); }
  function formatTokens(n: number) { return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1_000 ? (n / 1_000).toFixed(1) + 'K' : String(n); }
  function decodeName(s: string) { return s.replace(/-/g, '/'); }

  async function load() {
    loading = true;
    try {
      // Provider comes from the agent footer toggle so the dashboard
      // always reflects whichever CLI's stats the user is looking at.
      data = await agentGetUsageAnalytics(days, $agentFooterProvider);
    } catch {
      data = null;
    }
    loading = false;
  }

  // Reload when the dashboard opens, when `days` changes, or when the
  // user flips the footer provider toggle while the dashboard is open.
  $effect(() => {
    const _ = $agentFooterProvider; // dependency
    if (show) load();
  });

  function selectDays(d: number) { days = d; load(); }

  async function saveKey() {
    const key = sessionKey.trim();
    if (!key) return;
    keySaving = true;
    agentUsageAuthStatus.set({ state: 'checking', message: '' });
    try {
      const limits = await agentFetchUsageLimits(key);
      await setSetting('agent_session_key', key);
      agentSessionKey.set(key);
      agentUsageLimits.set(limits);
      agentUsageAuthStatus.set({ state: 'valid', message: 'Session key verified' });
      showToast('Session key verified and saved', 'success');
    } catch (e: any) {
      agentUsageAuthStatus.set({
        state: 'invalid',
        message: typeof e === 'string' ? e : e?.message || 'Claude session key is expired or invalid',
      });
      showToast('Invalid session key — not saved', 'error');
    } finally {
      keySaving = false;
    }
  }
</script>

<Modal bind:show title="Usage Dashboard" width="920px">
  <div class="ud">
    <div class="ud-days">
      {#each [7, 14, 30, 90] as d}
        <button class="ud-day-btn" class:active={days === d} onclick={() => selectDays(d)}>{d}d</button>
      {/each}
    </div>

    {#if loading}
      <div class="ud-loading"><div class="ud-spinner"></div>Loading analytics...</div>
    {:else if data}
      <!-- Summary cards -->
      <div class="ud-cards">
        <div class="ud-card"><span class="ud-val">{formatCost(data.totalCost)}</span><span class="ud-lbl">Total Cost</span></div>
        <div class="ud-card"><span class="ud-val">{data.totalApiCalls.toLocaleString()}</span><span class="ud-lbl">API Calls</span></div>
        <div class="ud-card"><span class="ud-val">{data.totalSessions}</span><span class="ud-lbl">Sessions</span></div>
        <div class="ud-card"><span class="ud-val">{data.cacheHitPercent.toFixed(1)}%</span><span class="ud-lbl">Cache Hit</span></div>
      </div>

      <!-- Daily chart -->
      {#if data.daily.length > 0}
        <div class="ud-section">
          <div class="ud-section-title">Daily Cost</div>
          <div class="ud-chart">
            {#each data.daily.slice(-21) as day}
              {@const maxCost = Math.max(...data.daily.slice(-21).map(d => d.cost), 0.01)}
              <div class="ud-bar-wrap" title="{day.date}: {formatCost(day.cost)} / {day.calls} calls">
                <div class="ud-bar" style="height:{Math.max(3, (day.cost / maxCost) * 100)}%"></div>
                <span class="ud-bar-lbl">{day.date.slice(8)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- By Model + By Project -->
      <div class="ud-grid">
        <div class="ud-section">
          <div class="ud-section-title">By Model</div>
          <div class="ud-scroll">
            {#each data.byModel as m}
              <div class="ud-row">
                <div class="ud-row-info">
                  <span class="ud-row-name">{m.model}</span>
                  <span class="ud-row-meta">{m.calls} calls &middot; {formatTokens(m.inputTokens + m.outputTokens)} tok</span>
                </div>
                <span class="ud-row-cost">{formatCost(m.cost)}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="ud-section">
          <div class="ud-section-title">By Project</div>
          <div class="ud-scroll">
            {#each data.byProject as p}
              <div class="ud-row">
                <div class="ud-row-info">
                  <span class="ud-row-name" title={p.project}>{decodeName(p.project)}</span>
                  <span class="ud-row-meta">{p.sessions} sess &middot; {p.calls} calls</span>
                </div>
                <span class="ud-row-cost">{formatCost(p.cost)}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Top Sessions + Tool Usage -->
      <div class="ud-grid">
        <div class="ud-section">
          <div class="ud-section-title">Top Sessions</div>
          <div class="ud-scroll">
            {#each data.topSessions.slice(0, 5) as s}
              <div class="ud-row">
                <div class="ud-row-info">
                  <span class="ud-row-name" title={s.project}>{decodeName(s.project)}</span>
                  <span class="ud-row-meta">{s.model} &middot; {s.sessionId.slice(0, 8)}</span>
                </div>
                <span class="ud-row-cost">{formatCost(s.cost)}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="ud-section">
          <div class="ud-section-title">Tool Usage</div>
          <div class="ud-scroll">
            {#each data.tools.slice(0, 10) as t}
              <div class="ud-tool-row">
                <span class="ud-tool-name">{t.name}</span>
                <div class="ud-tool-bar"><div class="ud-tool-fill" style="width:{Math.max(3, (t.count / (data.tools[0]?.count || 1)) * 100)}%"></div></div>
                <span class="ud-tool-ct">{t.count.toLocaleString()}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Session Key -->
      <div class="ud-section ud-key-section">
        <div class="ud-section-title">Session Key</div>
        <div class="ud-key-row">
          <input type="password" class="ud-key-input" bind:value={sessionKey} placeholder="sk-ant-sid01-..." />
          <button class="ud-key-btn" onclick={saveKey} disabled={keySaving}>{keySaving ? 'Verifying...' : 'Save'}</button>
        </div>
        <span class="ud-key-hint">claude.ai &rarr; DevTools &rarr; Cookies &rarr; sessionKey</span>
      </div>
    {:else}
      <div class="ud-loading">No usage data found</div>
    {/if}
  </div>
</Modal>

<style>
  .ud { display: flex; flex-direction: column; gap: 16px; }
  .ud-days { display: flex; gap: 6px; }
  .ud-day-btn { padding: 4px 12px; border-radius: 6px; border: 1px solid var(--b1); background: transparent; color: var(--t3); font-size: 11px; font-family: var(--ui); cursor: default; transition: all 0.12s; }
  .ud-day-btn.active { background: var(--acc); color: #fff; border-color: var(--acc); }
  .ud-day-btn:hover:not(.active) { background: var(--c); color: var(--t1); }

  .ud-loading { padding: 48px; text-align: center; font-size: 13px; color: var(--t3); display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .ud-spinner { width: 22px; height: 22px; border: 2px solid var(--b1); border-top-color: var(--acc); border-radius: 50%; animation: ud-spin 0.6s linear infinite; }
  @keyframes ud-spin { to { transform: rotate(360deg); } }

  .ud-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .ud-card { display: flex; flex-direction: column; align-items: center; padding: 12px 8px; border-radius: 8px; background: var(--n); border: 1px solid var(--b1); }
  .ud-val { font-size: 20px; font-weight: 700; color: var(--t1); font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .ud-lbl { font-size: 9px; color: var(--t3); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 4px; }

  .ud-section { flex: 1; min-width: 0; }
  .ud-section-title { font-size: 10px; font-weight: 600; color: var(--t3); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }

  .ud-chart { display: flex; align-items: flex-end; gap: 3px; height: 80px; padding: 4px 0; }
  .ud-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; cursor: default; }
  .ud-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; background: var(--acc); opacity: 0.8; transition: height 0.3s ease; }
  .ud-bar-wrap:hover .ud-bar { opacity: 1; }
  .ud-bar-lbl { font-size: 8px; color: var(--t4); margin-top: 3px; }

  .ud-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .ud-scroll { max-height: 160px; overflow-y: auto; }

  .ud-row { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 5px; }
  .ud-row:hover { background: var(--surface-hover); }
  .ud-row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .ud-row-name { font-size: 12px; font-weight: 500; color: var(--t1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ud-row-meta { font-size: 10px; color: var(--t3); }
  .ud-row-cost { font-size: 12px; font-weight: 600; color: var(--acc); font-family: var(--mono); font-variant-numeric: tabular-nums; flex-shrink: 0; }

  .ud-tool-row { display: flex; align-items: center; gap: 8px; padding: 3px 8px; font-size: 11px; }
  .ud-tool-name { width: 80px; flex-shrink: 0; color: var(--t1); font-weight: 500; font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ud-tool-bar { flex: 1; height: 4px; background: var(--surface-hover); border-radius: 2px; overflow: hidden; }
  .ud-tool-fill { height: 100%; background: var(--acc); border-radius: 2px; opacity: 0.7; }
  .ud-tool-ct { width: 44px; text-align: right; color: var(--t3); font-family: var(--mono); font-variant-numeric: tabular-nums; flex-shrink: 0; }

  .ud-key-section { margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--b1); }
  .ud-key-row { display: flex; gap: 8px; align-items: center; }
  .ud-key-input { flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--b1); background: var(--n); color: var(--t1); font-size: 12px; font-family: var(--mono); }
  .ud-key-input::placeholder { color: var(--t4); }
  .ud-key-btn { padding: 6px 16px; border-radius: 6px; border: 1px solid var(--acc); background: transparent; color: var(--acc); font-size: 11px; font-family: var(--ui); cursor: default; transition: all 0.15s; }
  .ud-key-btn:hover { background: var(--acc); color: #fff; }
  .ud-key-hint { font-size: 9px; color: var(--t4); margin-top: 4px; display: block; }
</style>
