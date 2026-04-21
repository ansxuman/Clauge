<script>
  import { invoke } from "@tauri-apps/api/core";
  import { usageStore } from "$lib/stores/usage.svelte";

  let {
    claudePlan = '',
  } = $props();
</script>

{#if usageStore.showDashboard}
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="modal-backdrop">
  <div class="dash-modal">
    <div class="dash-header">
      <span class="dash-title">Usage Dashboard {#if claudePlan}<span class="dash-plan-badge">{claudePlan}</span>{/if}</span>
      <div class="dash-header-right">
        <select class="dash-period" bind:value={usageStore.dashboardDays} onchange={() => usageStore.loadDashboard()}>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={9999}>All time</option>
        </select>
        <button class="stg-close" onclick={() => usageStore.showDashboard = false}>&times;</button>
      </div>
    </div>
    {#if usageStore.dashboardLoading}
      <div class="dash-loading"><div class="dash-spinner"></div>Analyzing sessions...</div>
    {:else if usageStore.dashboardData}
      <div class="dash-body">
        <div class="dash-stats">
          <div class="dash-stat"><span class="dash-stat-value">{usageStore.formatCost(usageStore.dashboardData.totalCost)}</span><span class="dash-stat-label">Total Cost</span></div>
          <div class="dash-stat"><span class="dash-stat-value">{usageStore.dashboardData.totalApiCalls.toLocaleString()}</span><span class="dash-stat-label">API Calls</span></div>
          <div class="dash-stat"><span class="dash-stat-value">{usageStore.dashboardData.cacheHitPercent.toFixed(1)}%</span><span class="dash-stat-label">Cache Hit</span></div>
          <div class="dash-stat"><span class="dash-stat-value">{usageStore.dashboardData.totalSessions}</span><span class="dash-stat-label">Sessions</span></div>
        </div>

        <div class="dash-tokens-bar">
          <span><strong>In:</strong> {usageStore.formatTokens(usageStore.dashboardData.totalInputTokens)}</span>
          <span><strong>Out:</strong> {usageStore.formatTokens(usageStore.dashboardData.totalOutputTokens)}</span>
          <span><strong>Cache R:</strong> {usageStore.formatTokens(usageStore.dashboardData.totalCacheReadTokens)}</span>
          <span><strong>Cache W:</strong> {usageStore.formatTokens(usageStore.dashboardData.totalCacheWriteTokens)}</span>
        </div>

        {#if usageStore.dashboardData.daily.length > 0}
          <div class="dash-section">
            <div class="dash-section-label">Daily Activity</div>
            <div class="dash-chart">
              {#each usageStore.dashboardData.daily.slice(-21) as day}
                {@const mc = Math.max(...usageStore.dashboardData.daily.slice(-21).map(d => d.cost), 0.01)}
                <div class="dash-bar-wrap" title="{day.date}: {usageStore.formatCost(day.cost)} · {day.calls} calls">
                  <div class="dash-bar" style="height:{Math.max(3, (day.cost / mc) * 100)}%"></div>
                  <span class="dash-bar-label">{day.date.slice(8)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="dash-grid">
          <div class="dash-section">
            <div class="dash-section-label">Live Usage</div>
            {#if usageStore.usageLimits}
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div class="dash-live-row">
                  <span class="dash-live-lbl">Session</span>
                  <div class="dash-live-bar"><div style="width:{usageStore.usageLimits.sessionPercent}%;background:{usageStore.usageLimits.sessionPercent > 80 ? '#f85149' : usageStore.usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'};height:100%;border-radius:2px;"></div></div>
                  <span class="dash-live-pct" style="color:{usageStore.usageLimits.sessionPercent > 80 ? '#f85149' : usageStore.usageLimits.sessionPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageStore.usageLimits.sessionPercent.toFixed(1)}%</span>
                </div>
                <div class="dash-live-row">
                  <span class="dash-live-lbl">Weekly</span>
                  <div class="dash-live-bar"><div style="width:{usageStore.usageLimits.weeklyAllPercent}%;background:{usageStore.usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'};height:100%;border-radius:2px;"></div></div>
                  <span class="dash-live-pct" style="color:{usageStore.usageLimits.weeklyAllPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklyAllPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageStore.usageLimits.weeklyAllPercent.toFixed(1)}%</span>
                </div>
                {#if usageStore.usageLimits.weeklySonnetPercent != null}
                  <div class="dash-live-row">
                    <span class="dash-live-lbl">Sonnet</span>
                    <div class="dash-live-bar"><div style="width:{usageStore.usageLimits.weeklySonnetPercent}%;background:{usageStore.usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'};height:100%;border-radius:2px;"></div></div>
                    <span class="dash-live-pct" style="color:{usageStore.usageLimits.weeklySonnetPercent > 80 ? '#f85149' : usageStore.usageLimits.weeklySonnetPercent > 50 ? '#d29922' : 'var(--accent)'}">{usageStore.usageLimits.weeklySonnetPercent.toFixed(1)}%</span>
                  </div>
                {/if}
              </div>
              {#if usageStore.showKeyEdit}
                <div style="margin-top:8px;">
                  <input type="password" bind:value={usageStore.sessionKeyInput} placeholder="sk-ant-sid01-..." style="padding:5px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-primary);font-size:11px;width:100%;margin-bottom:4px;" />
                  <div style="display:flex;gap:6px;">
                    <button class="save-key-btn" onclick={async () => {
                      if (usageStore.sessionKeyInput.trim()) {
                        await invoke("save_session_key", { key: usageStore.sessionKeyInput.trim() });
                        usageStore.sessionKeyConfigured = true; usageStore.showKeyEdit = false;
                        await usageStore.loadUsageLimits();
                      }
                    }}>Save</button>
                    <button class="save-key-btn" style="color:var(--text-secondary);border-color:var(--border);" onclick={() => usageStore.showKeyEdit = false}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
                  <span style="font-size:9px;color:var(--text-secondary);">Refresh every</span>
                  <select class="dash-refresh-select" bind:value={usageStore.usageRefreshMins} onchange={() => {
                    localStorage.setItem('clauge-usage-refresh', String(usageStore.usageRefreshMins));
                    usageStore.startRefreshInterval();
                  }}>
                    <option value={5}>5 min</option><option value={15}>15 min</option><option value={30}>30 min</option>
                    <option value={60}>1 hour</option><option value={360}>6 hours</option><option value={720}>12 hours</option>
                  </select>
                  <button class="dash-edit-key" onclick={() => usageStore.showKeyEdit = true} title="Update session key">
                    Session Key
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                </div>
              {/if}
            {:else}
              <div style="padding:8px 0;">
                <p style="font-size:11px;color:var(--text-secondary);margin:0 0 8px;">Connect to see live session limits</p>
                <input type="password" bind:value={usageStore.sessionKeyInput} placeholder="sk-ant-sid01-..." style="padding:5px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-primary);font-size:11px;width:100%;margin-bottom:6px;" />
                <p style="font-size:9px;color:var(--text-secondary);margin:0 0 6px;">claude.ai → DevTools → Cookies → sessionKey</p>
                <button class="save-key-btn" onclick={async () => {
                  if (usageStore.sessionKeyInput.trim()) {
                    await invoke("save_session_key", { key: usageStore.sessionKeyInput.trim() });
                    usageStore.sessionKeyConfigured = true; usageStore.usageError = '';
                    await usageStore.loadUsageLimits();
                    usageStore.startRefreshInterval();
                  }
                }}>Connect</button>
              </div>
            {/if}
          </div>
          <div class="dash-section">
            <div class="dash-section-label">Models</div>
            {#each usageStore.dashboardData.byModel as m}
              <div class="dash-model-row">
                <div class="dash-model-info"><span class="dash-model-name">{m.model}</span><span class="dash-model-meta">{m.calls} calls · {m.cacheHitPercent.toFixed(0)}% cache</span></div>
                <span class="dash-model-cost">{usageStore.formatCost(m.cost)}</span>
              </div>
            {/each}
          </div>
        </div>

        <div class="dash-grid">
          <div class="dash-section">
            <div class="dash-section-label">Projects ({usageStore.dashboardData.byProject.length})</div>
            <div class="dash-scroll">
              {#each usageStore.dashboardData.byProject as p}
                <div class="dash-model-row">
                  <div class="dash-model-info"><span class="dash-model-name" title={p.project}>{usageStore.decodeProjectName(p.project)}</span><span class="dash-model-meta">{p.sessions} sess · {p.calls} calls</span></div>
                  <span class="dash-model-cost">{usageStore.formatCost(p.cost)}</span>
                </div>
              {/each}
            </div>
          </div>
          <div class="dash-section">
            <div class="dash-section-label">Top Sessions</div>
            <div class="dash-scroll">
              {#each usageStore.dashboardData.topSessions as s}
                <div class="dash-model-row">
                  <div class="dash-model-info"><span class="dash-model-name" title={s.project}>{usageStore.decodeProjectName(s.project)}</span><span class="dash-model-meta">{s.model} · {s.sessionId.slice(0, 8)}</span></div>
                  <span class="dash-model-cost">{usageStore.formatCost(s.cost)}</span>
                </div>
              {/each}
            </div>
          </div>
        </div>

        <div class="dash-grid">
          <div class="dash-section">
            <div class="dash-section-label">Tools</div>
            {#each usageStore.dashboardData.tools.slice(0, 6) as t}
              <div class="dash-tool-row">
                <span class="dash-tool-name">{t.name}</span>
                <div class="dash-tool-bar-bg"><div class="dash-tool-bar-fill" style="width:{Math.max(3, (t.count / (usageStore.dashboardData.tools[0]?.count || 1)) * 100)}%"></div></div>
                <span class="dash-tool-count">{t.count.toLocaleString()}</span>
              </div>
            {/each}
          </div>
          <div class="dash-section">
            <div class="dash-section-label">Shell</div>
            {#each usageStore.dashboardData.shellCommands.slice(0, 6) as s}
              <div class="dash-tool-row">
                <span class="dash-tool-name" style="font-family:monospace;">{s.name}</span>
                <div class="dash-tool-bar-bg"><div class="dash-tool-bar-fill" style="width:{Math.max(3, (s.count / (usageStore.dashboardData.shellCommands[0]?.count || 1)) * 100)}%"></div></div>
                <span class="dash-tool-count">{s.count.toLocaleString()}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="dash-loading">No usage data found</div>
    {/if}
  </div>
</div>
{/if}

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; animation: fadeIn 0.15s ease-out; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .dash-modal { width: 900px; max-height: 85vh; background: var(--sidebar-bg); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 24px 48px rgba(0,0,0,0.5); overflow: hidden; animation: modalUp 0.18s ease; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); display: flex; flex-direction: column; }
  @keyframes modalUp { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: none; } }
  .dash-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .dash-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .dash-header-right { display: flex; align-items: center; gap: 10px; }
  .dash-period { padding: 4px 8px; border-radius: 5px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; font-family: inherit; cursor: pointer; }
  .stg-close { width: 24px; height: 24px; border: none; background: transparent; color: var(--text-secondary); font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 4px; line-height: 1; transition: color 0.1s; }
  .stg-close:hover { color: var(--text-primary); }
  .dash-loading { padding: 60px; text-align: center; font-size: 13px; color: var(--text-secondary); display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .dash-spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .dash-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
  .dash-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex: 1; }
  .dash-stat { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px 6px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--border); }
  .dash-stat-value { font-size: 18px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .dash-stat-label { font-size: 9px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 3px; }
  .dash-section { flex: 1; min-width: 0; }
  .dash-section-label { font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
  .dash-chart { display: flex; align-items: flex-end; gap: 3px; height: 80px; padding: 4px 0; }
  .dash-bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; cursor: default; }
  .dash-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; transition: height 0.3s ease; opacity: 0.8; background: var(--accent); }
  .dash-bar-wrap:hover .dash-bar { opacity: 1; }
  .dash-bar-label { font-size: 8px; color: var(--text-secondary); margin-top: 3px; opacity: 0.6; }
  .dash-tokens-bar { display: flex; gap: 16px; justify-content: center; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.02); font-size: 10px; color: var(--text-secondary); }
  .dash-tokens-bar strong { color: var(--text-primary); font-weight: 500; }
  .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .dash-scroll { max-height: 160px; overflow-y: auto; }
  .dash-model-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 5px; }
  .dash-model-row:hover { background: rgba(255,255,255,0.03); }
  .dash-model-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .dash-model-name { font-size: 12px; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dash-model-meta { font-size: 10px; color: var(--text-secondary); }
  .dash-model-cost { font-size: 12px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .dash-tool-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 11px; }
  .dash-tool-name { width: 70px; flex-shrink: 0; color: var(--text-primary); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dash-tool-bar-bg { flex: 1; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
  .dash-tool-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; opacity: 0.7; }
  .dash-tool-count { width: 40px; text-align: right; color: var(--text-secondary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .dash-plan-badge { font-size: 10px; font-weight: 600; text-transform: capitalize; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
  .dash-live-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
  .dash-live-row { display: flex; align-items: center; gap: 8px; }
  .dash-live-lbl { font-size: 11px; color: var(--text-secondary); width: 50px; flex-shrink: 0; }
  .dash-live-pct { font-size: 12px; font-weight: 600; width: 40px; text-align: right; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .dash-refresh-select { padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border); background: transparent; color: var(--text-secondary); font-size: 11px; font-family: inherit; cursor: pointer; }
  .dash-edit-key { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; padding: 3px 6px; border-radius: 3px; display: flex; align-items: center; gap: 4px; margin-left: auto; font-size: 9px; font-family: inherit; opacity: 0.6; transition: all 0.1s; }
  .dash-edit-key:hover { opacity: 1; background: rgba(255,255,255,0.06); color: var(--text-primary); }
  .save-key-btn { padding: 5px 14px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
  .save-key-btn:hover { background: var(--accent); color: #fff; }
</style>
