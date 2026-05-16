<script lang="ts">
  import { onMount } from 'svelte';
  import {
    history,
    loadHistory,
    clearHistory,
    openHistoryTab,
  } from '$lib/modes/rest/stores';
  import { tabs, activeTabId } from '$lib/shared/stores/tabs';
  import { settings } from '$lib/stores/settings';
  import { METHOD_COLORS } from '$lib/utils/theme';
  import { showToast } from '$lib/shared/primitives/toast';
  import ConfirmDialog from '$lib/shared/primitives/ConfirmDialog.svelte';
  import type { HistoryEntry } from '$lib/types';

  /** entry id of the currently active history tab in the global Topbar
   *  (null when the active tab is in another mode, or no tabs are open). */
  const activeHistoryEntryId = $derived.by(() => {
    const t = $tabs.find(x => x.id === $activeTabId);
    return t && t.mode === 'history' ? t.key : null;
  });

  let showClearConfirm = $state(false);

  onMount(() => {
    loadHistory(50, $settings['chat_history_retention']);
  });

  function methodLabel(method: string) {
    return method === 'DELETE' ? 'DEL' : method;
  }

  function extractPath(url: string): string {
    try {
      const u = new URL(url);
      return u.pathname + (u.search || '');
    } catch {
      return url;
    }
  }

  /** Title for a history row: saved request name when present, else URL path. */
  function entryTitle(entry: HistoryEntry): string {
    const name = entry.requestName?.trim();
    return name ? name : extractPath(entry.url);
  }

  function extractHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return '';
    // Handle SQLite datetime format "YYYY-MM-DD HH:MM:SS" (no T, no Z)
    const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function statusClass(status: number | null): string {
    if (!status) return '';
    if (status >= 200 && status < 300) return 'status-ok';
    if (status >= 400) return 'status-err';
    return 'status-warn';
  }

  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function openHistoryEntry(entry: HistoryEntry) {
    openHistoryTab(entry);
  }

  async function handleClear() {
    try {
      await clearHistory();
      showToast('History cleared', 'success');
    } catch {
      showToast('Failed to clear history', 'error');
    }
  }
</script>

<div class="history-panel">
  {#if $history.length === 0}
    <div class="hist-empty">No history yet</div>
  {:else}
    <div class="hist-list">
      {#each $history as entry (entry.id)}
        {@const colors = METHOD_COLORS[entry.method] ?? { color: '#888', bg: '#1a1a1a' }}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="hist-item"
          class:active={activeHistoryEntryId === entry.id}
          onclick={() => openHistoryEntry(entry)}
        >
          <div class="hist-top">
            <span class="hist-method" style="background:{colors.bg};color:{colors.color}">{methodLabel(entry.method)}</span>
            <span class="hist-path" title={entry.url}>{entryTitle(entry)}</span>
            {#if entry.responseStatus}
              <span class="hist-status {statusClass(entry.responseStatus)}">{entry.responseStatus}</span>
            {/if}
          </div>
          <div class="hist-bottom">
            <span class="hist-host">{extractHost(entry.url)}</span>
            {#if entry.durationMs}
              <span class="hist-duration">{formatDuration(entry.durationMs)}</span>
            {/if}
            {#if formatTime(entry.createdAt)}
              <span class="hist-time">{formatTime(entry.createdAt)}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  {#if $history.length > 0}
    <div class="hist-footer">
      <button class="hist-clear" onclick={() => showClearConfirm = true}>Clear History</button>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:show={showClearConfirm}
  title="Clear History"
  message="Are you sure you want to clear all request history? This cannot be undone."
  confirmText="Clear"
  onconfirm={handleClear}
/>

<style>
  .history-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .hist-empty {
    padding: 24px 12px;
    color: var(--t3);
    font-size: 12px;
    font-family: var(--mono);
    text-align: center;
  }
  .hist-list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .hist-list::-webkit-scrollbar {
    width: 3px;
  }
  .hist-list::-webkit-scrollbar-thumb {
    background: var(--b1);
    border-radius: 2px;
  }
  .hist-item {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: default;
    transition: background 0.08s;
    border-bottom: 1px solid var(--b1);
  }
  .hist-item:hover {
    background: var(--surface-hover);
  }
  .hist-item.active {
    background: var(--surface-hover);
    border-left: 2px solid var(--acc);
    padding-left: 10px;
  }
  .hist-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hist-method {
    font-size: 9px;
    font-weight: 700;
    font-family: var(--mono);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    letter-spacing: 0.04em;
  }
  .hist-path {
    font-size: 11px;
    color: var(--t1);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
  }
  .hist-status {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    font-family: var(--mono);
    flex-shrink: 0;
  }
  .hist-status.status-ok {
    background: rgba(29,200,128,0.1);
    color: var(--ok);
  }
  .hist-status.status-err {
    background: rgba(240,68,68,0.1);
    color: var(--err);
  }
  .hist-status.status-warn {
    background: rgba(245,166,35,0.1);
    color: var(--warn);
  }
  .hist-bottom {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 32px;
  }
  .hist-host {
    font-size: 10px;
    color: var(--t3);
    font-family: var(--mono);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hist-duration {
    font-size: 9px;
    color: var(--t3);
    font-family: var(--mono);
    flex-shrink: 0;
  }
  .hist-time {
    font-size: 9px;
    color: var(--t3);
    flex-shrink: 0;
    font-family: var(--mono);
  }
  /* Sticky footer. NavPanel's .nav-body is the scroll container, so a
     plain flex-shrink:0 footer would still scroll out of view when the
     list overflows. position: sticky pins this footer to the bottom of
     the nav viewport regardless of scroll, while still occupying layout
     space at the end of the list (no overlap on the last row). */
  .hist-footer {
    position: sticky;
    bottom: 0;
    z-index: 1;
    padding: 8px 12px;
    border-top: 1px solid var(--b1);
    background: var(--n2, var(--e, #1a1a20));
    flex-shrink: 0;
  }
  .hist-clear {
    width: 100%;
    height: 28px;
    border-radius: 5px;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t3);
    font-size: 11px;
    font-family: var(--ui);
    cursor: default;
    transition: border-color 0.1s, color 0.1s;
  }
  .hist-clear:hover {
    border-color: var(--b2);
    color: var(--t1);
  }
</style>
