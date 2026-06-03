<script lang="ts">
  import { get } from 'svelte/store';
  import { tabs, draftRequests } from '$lib/shared/stores/tabs';
  import {
    activeEnvId,
    getEffectiveEnvId,
    requestEnvOverrides,
    loadHistory,
  } from '$lib/modes/rest/stores';
  import { executeRequest, quickExecute, getRequest } from '$lib/modes/rest/commands';
  import { showToast } from '$lib/shared/primitives/toast';
  import { friendlyError } from '$lib/utils/errors';
  import { METHOD_COLORS } from '$lib/utils/theme';
  import type { HttpResponse, RequestWithDetails, KVInput } from '$lib/modes/rest/types';

  interface Props {
    tabId: string;
  }

  let { tabId }: Props = $props();

  let saved = $state<RequestWithDetails | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  let response = $state<HttpResponse | null>(null);
  let activeBottomTab = $state<'body' | 'headers' | 'response'>('response');

  // Resolve the topbar tab for this request id so we can read its draft.
  // Drafts are keyed by the numeric topbar tab id, not the request uuid.
  const topbarTab = $derived($tabs.find((t) => t.mode === 'rest' && t.key === tabId));
  const draft = $derived(topbarTab ? $draftRequests.get(topbarTab.id) : undefined);

  // Per-tile env override falls back to per-request override then global env.
  // requestEnvOverrides is read so the derived recomputes on change.
  const effectiveEnvId = $derived(
    getEffectiveEnvId(tabId, $requestEnvOverrides, $activeEnvId),
  );

  // Display values, draft-first to match the active home-mode editor.
  const method = $derived((draft?.method ?? saved?.method ?? 'GET').toUpperCase());
  const url = $derived(draft?.url ?? saved?.url ?? '');
  const body = $derived(draft?.body ?? saved?.body ?? '');
  const bodyType = $derived(draft?.bodyType ?? saved?.bodyType ?? 'json');
  const headers = $derived<KVInput[]>(
    draft?.headers ??
      saved?.headers?.map((h) => ({ key: h.key, value: h.value, enabled: h.enabled })) ??
      [],
  );
  const authType = $derived(draft?.authType ?? saved?.authType ?? 'none');
  const authData = $derived(draft?.authData ?? saved?.authData ?? '{}');
  const methodStyle = $derived(METHOD_COLORS[method] ?? METHOD_COLORS.GET);
  const title = $derived(saved?.name ?? 'Untitled request');

  // Load the saved request on mount (and whenever tabId changes — adapter
  // remounts per tile, but the prop never changes within a single instance).
  $effect(() => {
    const id = tabId;
    saved = null;
    loadError = null;
    getRequest(id)
      .then((r) => {
        if (tabId === id) saved = r;
      })
      .catch((e) => {
        if (tabId === id) loadError = friendlyError(e);
      });
  });

  async function send() {
    if (loading) return;
    loading = true;
    activeBottomTab = 'response';
    try {
      const envId = effectiveEnvId ?? '';
      let resp: HttpResponse;
      if (saved && saved.id === tabId && !draft) {
        resp = await executeRequest(tabId, envId);
      } else {
        const enabledHeaders: [string, string][] = (headers ?? [])
          .filter((h) => h.enabled && h.key.trim())
          .map((h) => [h.key, h.value] as [string, string]);
        resp = await quickExecute(
          method,
          url,
          body,
          enabledHeaders,
          envId,
          authType,
          authData,
          bodyType,
        );
      }
      response = resp;
      loadHistory();
    } catch (e) {
      const msg = friendlyError(e);
      showToast(msg, 'error');
      response = {
        status: 0,
        status_text: 'Error',
        headers: [],
        body: msg,
        duration_ms: 0,
        size_bytes: 0,
      };
    } finally {
      loading = false;
    }
  }

  const responseOk = $derived(response ? response.status > 0 && response.status < 400 : false);
</script>

<div class="rest-tile">
  <div class="rest-tile-bar">
    <span
      class="method-pill"
      style="color: {methodStyle.color}; background: {methodStyle.bg};"
    >
      {method}
    </span>
    <div class="url-box" title={url}>{url || '(no url)'}</div>
    <button class="send-btn" disabled={loading || !url} onclick={send}>
      {loading ? 'Sending…' : 'Send'}
    </button>
  </div>

  <div class="rest-tile-title">{title}</div>

  <div class="rest-tile-tabs">
    <button
      class="tab"
      class:active={activeBottomTab === 'response'}
      onclick={() => (activeBottomTab = 'response')}
    >
      Response{response ? ` · ${response.status}` : ''}
    </button>
    <button
      class="tab"
      class:active={activeBottomTab === 'headers'}
      onclick={() => (activeBottomTab = 'headers')}
    >
      Headers · {headers.length}
    </button>
    <button
      class="tab"
      class:active={activeBottomTab === 'body'}
      onclick={() => (activeBottomTab = 'body')}
    >
      Body
    </button>
  </div>

  <div class="rest-tile-body">
    {#if loadError && !saved && !draft}
      <div class="rest-tile-empty">{loadError}</div>
    {:else if activeBottomTab === 'response'}
      {#if loading}
        <div class="rest-tile-empty">Sending…</div>
      {:else if !response}
        <div class="rest-tile-empty">Press Send to run this request.</div>
      {:else}
        <div class="resp-meta">
          <span class="resp-status" class:ok={responseOk} class:err={!responseOk}>
            {response.status} {response.status_text}
          </span>
          <span class="resp-meta-item">{response.duration_ms} ms</span>
          <span class="resp-meta-item">{response.size_bytes} B</span>
        </div>
        <pre class="resp-body">{response.body}</pre>
      {/if}
    {:else if activeBottomTab === 'headers'}
      {#if headers.length === 0}
        <div class="rest-tile-empty">No headers.</div>
      {:else}
        <table class="kv">
          <tbody>
            {#each headers as h}
              <tr class:disabled={!h.enabled}>
                <td class="kv-key">{h.key}</td>
                <td class="kv-val">{h.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else}
      <pre class="req-body">{body || '(empty body)'}</pre>
    {/if}
  </div>
</div>

<style>
  .rest-tile {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    font-family: var(--ui);
    color: var(--t1);
  }
  .rest-tile-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--b1);
    flex-shrink: 0;
  }
  .method-pill {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.3px;
  }
  .url-box {
    flex: 1;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--t2);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding: 3px 6px;
    border: 1px solid var(--b1);
    border-radius: 3px;
    background: var(--b0);
  }
  .send-btn {
    font-family: var(--ui);
    font-size: 11px;
    padding: 4px 12px;
    border: 1px solid var(--b1);
    border-radius: 3px;
    background: var(--accent, var(--t1));
    color: var(--b0);
    cursor: pointer;
  }
  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .rest-tile-title {
    font-size: 11px;
    color: var(--t3);
    padding: 4px 10px;
    border-bottom: 1px solid var(--b1);
    flex-shrink: 0;
  }
  .rest-tile-tabs {
    display: flex;
    gap: 2px;
    padding: 4px 6px 0;
    border-bottom: 1px solid var(--b1);
    flex-shrink: 0;
  }
  .tab {
    font-family: var(--ui);
    font-size: 11px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--t3);
    padding: 4px 8px;
    cursor: pointer;
  }
  .tab.active {
    color: var(--t1);
    border-bottom-color: var(--t1);
  }
  .rest-tile-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 10px;
  }
  .rest-tile-empty {
    color: var(--t4);
    font-size: 11px;
    padding: 12px 0;
  }
  .resp-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 10px;
    font-family: var(--mono);
    color: var(--t3);
    margin-bottom: 6px;
  }
  .resp-status {
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .resp-status.ok {
    color: #4ade80;
    background: rgba(74, 222, 128, 0.1);
  }
  .resp-status.err {
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
  }
  .resp-body,
  .req-body {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--t2);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .kv {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    font-family: var(--mono);
  }
  .kv td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--b1);
    vertical-align: top;
  }
  .kv-key {
    color: var(--t2);
    width: 35%;
  }
  .kv-val {
    color: var(--t3);
    word-break: break-all;
  }
  .kv tr.disabled {
    opacity: 0.4;
  }
</style>
