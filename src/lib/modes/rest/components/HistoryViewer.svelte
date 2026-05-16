<script lang="ts">
  import { activeHistoryEntry } from '$lib/modes/rest/stores';
  import { METHOD_COLORS } from '$lib/utils/theme';

  type Tab = 'response' | 'request-body' | 'request-headers' | 'response-headers';
  let activeTab: Tab = $state('response');

  const entry = $derived($activeHistoryEntry);
  const colors = $derived(METHOD_COLORS[entry?.method ?? 'GET'] ?? METHOD_COLORS.GET);


  function formatSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatJson(str: string | null): string {
    if (!str) return '';
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }

  /** Friendly label for the body placeholder when content is no longer
   *  retained. Read the Content-Type header (still stored on the row)
   *  and map to a recognisable short name — so a dropped JSON response
   *  reads as `<json · 2.3 MB>` instead of the wrong "binary". Falls
   *  back to the raw MIME type when we don't have a nicer name for it,
   *  or just "body" when no content-type was sent. */
  function bodyTypeLabel(headersJson: string | null): string {
    const ct = parseHeaders(headersJson).find(
      (h) => h.key.toLowerCase() === 'content-type',
    )?.value ?? '';
    const mime = ct.split(';')[0].trim().toLowerCase();
    if (!mime) return 'body';
    if (mime.includes('json')) return 'json';
    if (mime.startsWith('text/html')) return 'html';
    if (mime.startsWith('text/xml') || mime.includes('xml')) return 'xml';
    if (mime.startsWith('text/css')) return 'css';
    if (mime.startsWith('text/javascript') || mime.includes('javascript')) return 'js';
    if (mime.startsWith('text/')) return 'text';
    if (mime.startsWith('image/')) return mime.slice(6); // image/png → "png"
    if (mime === 'application/pdf') return 'pdf';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return 'archive';
    if (mime.includes('octet-stream')) return 'binary';
    return mime; // unrecognised — show the raw MIME for transparency
  }

  function parseHeaders(str: string | null): { key: string; value: string }[] {
    if (!str) return [];
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.map((h: any) => ({ key: h.key || h[0] || '', value: h.value || h[1] || '' }));
      }
      if (typeof parsed === 'object') {
        return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
      }
      return [];
    } catch {
      return [];
    }
  }

  function statusClass(status: number | null): string {
    if (!status) return '';
    if (status >= 200 && status < 300) return 'ok';
    if (status >= 400) return 'err';
    return 'warn';
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }
</script>

{#if entry}
  <div class="hv">
    <!-- Request summary bar -->
    <div class="hv-bar">
      <span class="hv-method" style="background:{colors.bg};color:{colors.color}">{entry.method}</span>
      <span class="hv-url">{entry.resolvedUrl || entry.url}</span>
      <div class="hv-bar-spacer"></div>
      {#if entry.responseStatus}
        <span class="hv-status {statusClass(entry.responseStatus)}">{entry.responseStatus}</span>
      {/if}
      {#if entry.durationMs}
        <span class="hv-meta">{formatDuration(entry.durationMs)}</span>
      {/if}
      {#if entry.responseSizeBytes}
        <span class="hv-meta">{formatSize(entry.responseSizeBytes)}</span>
      {/if}
      <span class="hv-meta">{formatTime(entry.createdAt)}</span>
    </div>

    <!-- Tabs -->
    <div class="hv-tabs">
      <button class="hv-tab" class:active={activeTab === 'response'} onclick={() => activeTab = 'response'}>Response Body</button>
      <button class="hv-tab" class:active={activeTab === 'response-headers'} onclick={() => activeTab = 'response-headers'}>Response Headers</button>
      <button class="hv-tab" class:active={activeTab === 'request-body'} onclick={() => activeTab = 'request-body'}>Request Body</button>
      <button class="hv-tab" class:active={activeTab === 'request-headers'} onclick={() => activeTab = 'request-headers'}>Request Headers</button>
    </div>

    <!-- Content -->
    <div class="hv-content">
      {#if activeTab === 'response'}
        {#if entry.responseBody}
          <pre class="hv-pre">{formatJson(entry.responseBody)}</pre>
        {:else if entry.responseSizeBytes && entry.responseSizeBytes > 0}
          <!-- Body intentionally not retained — see history INSERT in
               http_executor.rs. Placeholder is type-aware (read from
               the still-stored Content-Type header) so a dropped JSON
               response reads as `<json · 2.3 MB>` instead of an
               inaccurate "binary file". Re-run the request to inspect
               the actual content. -->
          <div class="hv-empty-tab">&lt;{bodyTypeLabel(entry.responseHeaders)} · {formatSize(entry.responseSizeBytes)}&gt;</div>
        {:else}
          <div class="hv-empty-tab">No response body</div>
        {/if}
      {:else if activeTab === 'response-headers'}
        <div class="hv-headers">
          {#each parseHeaders(entry.responseHeaders) as h}
            <div class="hv-header-row">
              <span class="hv-hkey">{h.key}</span>
              <span class="hv-hval">{h.value}</span>
            </div>
          {/each}
          {#if parseHeaders(entry.responseHeaders).length === 0}
            <div class="hv-empty-tab">No response headers</div>
          {/if}
        </div>
      {:else if activeTab === 'request-body'}
        {#if entry.requestBody}
          <pre class="hv-pre">{formatJson(entry.requestBody)}</pre>
        {:else if ['POST', 'PUT', 'PATCH'].includes(entry.method.toUpperCase())}
          <!-- Body intentionally not retained. For methods that typically
               carry a body, show a type-aware placeholder using the
               request's Content-Type (still stored). For GET/DELETE/HEAD
               we fall through to "No request body" since one likely
               wasn't sent in the first place. -->
          <div class="hv-empty-tab">&lt;{bodyTypeLabel(entry.requestHeaders)}&gt;</div>
        {:else}
          <div class="hv-empty-tab">No request body</div>
        {/if}
      {:else if activeTab === 'request-headers'}
        <div class="hv-headers">
          {#each parseHeaders(entry.requestHeaders) as h}
            <div class="hv-header-row">
              <span class="hv-hkey">{h.key}</span>
              <span class="hv-hval">{h.value}</span>
            </div>
          {/each}
          {#if parseHeaders(entry.requestHeaders).length === 0}
            <div class="hv-empty-tab">No request headers</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .hv {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .hv-bar {
    height: 40px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--b1);
    background: var(--n2);
    flex-shrink: 0;
  }
  .hv-method {
    font-size: 10px;
    font-weight: 700;
    font-family: var(--mono);
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .hv-url {
    font-size: 12px;
    font-family: var(--mono);
    color: var(--t1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .hv-bar-spacer { flex-shrink: 100; }
  .hv-status {
    font-size: 11px;
    font-weight: 700;
    font-family: var(--mono);
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
  }
  .hv-status.ok { background: rgba(29,200,128,0.12); color: var(--ok); }
  .hv-status.err { background: rgba(240,68,68,0.12); color: var(--err); }
  .hv-status.warn { background: rgba(245,166,35,0.12); color: var(--warn); }
  .hv-meta {
    font-size: 10px;
    color: var(--t3);
    font-family: var(--mono);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .hv-tabs {
    display: flex;
    height: 32px;
    border-bottom: 1px solid var(--b1);
    background: var(--n2);
    padding: 0 8px;
    gap: 2px;
    flex-shrink: 0;
  }
  .hv-tab {
    padding: 0 12px;
    border: none;
    background: transparent;
    color: var(--t3);
    font-size: 11px;
    font-family: var(--ui);
    cursor: default;
    border-bottom: 2px solid transparent;
    transition: color 0.1s;
  }
  .hv-tab:hover { color: var(--t2); }
  .hv-tab.active {
    color: var(--t1);
    border-bottom-color: var(--acc);
  }
  .hv-content {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  .hv-content::-webkit-scrollbar { width: 4px; }
  .hv-content::-webkit-scrollbar-thumb { background: var(--b1); border-radius: 2px; }
  .hv-pre {
    margin: 0;
    padding: 14px;
    font-size: 11px;
    font-family: var(--mono);
    color: var(--t1);
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
  }
  .hv-headers {
    padding: 8px 0;
  }
  .hv-header-row {
    display: flex;
    padding: 4px 14px;
    gap: 12px;
    font-size: 11px;
    font-family: var(--mono);
    border-bottom: 1px solid var(--b-subtle);
  }
  .hv-header-row:hover {
    background: var(--surface-hover);
  }
  .hv-hkey {
    color: var(--t2);
    min-width: 120px;
    flex-shrink: 0;
    font-weight: 500;
  }
  .hv-hval {
    color: var(--t1);
    word-break: break-all;
  }
  .hv-empty-tab {
    padding: 24px;
    color: var(--t3);
    font-size: 12px;
    font-family: var(--mono);
    text-align: center;
  }
</style>
