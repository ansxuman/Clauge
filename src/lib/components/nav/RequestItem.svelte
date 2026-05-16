<script lang="ts">
  import type { Request } from '$lib/types';
  import { METHOD_COLORS } from '$lib/utils/theme';
  import { activeRequestId, activeCollectionId, loadRequest, deleteRequest } from '$lib/modes/rest/stores';
  import { tabs, activeTabId, addTab, activateTab, updateTab } from '$lib/shared/stores/tabs';
  import { showContextMenu } from '$lib/shared/primitives/contextmenu';
  import { showToast } from '$lib/shared/primitives/toast';
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { get } from 'svelte/store';
  import * as cmd from '$lib/commands';
  import InlineInput from './InlineInput.svelte';
  import ConfirmDialog from '$lib/shared/primitives/ConfirmDialog.svelte';

  interface Props {
    request: Request;
    ondeleted?: () => void;
  }

  let { request, ondeleted }: Props = $props();

  let renaming = $state(false);
  let showDeleteConfirm = $state(false);

  const colors = $derived(METHOD_COLORS[request.method] ?? { color: '#888', bg: '#1a1a1a' });
  const isActive = $derived($activeRequestId === request.id);
  const methodLabel = $derived(request.method === 'DELETE' ? 'DEL' : request.method);

  async function handleClick() {
    activeCollectionId.set(request.collectionId);
    await loadRequest(request.id);

    // Open or activate a tab for this request
    const allTabs = get(tabs);
    const existing = allTabs.find(t => t.key === request.id);
    const tabColors = METHOD_COLORS[request.method] ?? { color: '#888', bg: '#1a1a1a' };
    if (existing) {
      updateTab(existing.id, { dot: tabColors.color });
      activateTab(existing.id);
    } else {
      const label = `${request.method} ${request.name || request.url || '/new'}`;
      addTab(label, 'rest', request.id, tabColors.color);
    }
  }

  function buildMenuItems() {
    return [
      {
        label: 'Rename',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        action: () => { renaming = true; },
      },
      {
        label: 'Duplicate',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
        action: async () => {
          try {
            await cmd.duplicateRequest(request.id);
            showToast('Request duplicated', 'success');
            ondeleted?.();
          } catch (err) {
            showToast('Failed to duplicate request', 'error');
          }
        },
      },
      {
        label: 'Copy as cURL',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
        action: async () => {
          try {
            const curl = await cmd.exportAsCurl(request.id);
            await writeText(curl);
            showToast('Copied cURL to clipboard', 'success');
          } catch (err) {
            showToast('Failed to copy cURL', 'error');
          }
        },
      },
      { label: '', action: () => {}, separator: true },
      {
        label: 'Delete',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
        danger: true,
        action: () => { showDeleteConfirm = true; },
      },
    ];
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, buildMenuItems());
  }

  function handleMenuBtn(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu(rect.left, rect.bottom + 4, buildMenuItems());
  }

  async function handleRename(newName: string) {
    renaming = false;
    if (newName === request.name) return;
    try {
      await cmd.updateRequest(request.id, { name: newName });
      request.name = newName;
      // Keep the topbar tab label in sync with the new name.
      const openTab = get(tabs).find(t => t.mode === 'rest' && t.key === request.id);
      if (openTab) {
        updateTab(openTab.id, { label: `${request.method} ${newName}` });
      }
      showToast('Request renamed', 'success');
    } catch (err) {
      showToast('Failed to rename request', 'error');
    }
  }

  function cancelRename() {
    renaming = false;
  }

  async function handleDelete() {
    try {
      await deleteRequest(request.id);
      showToast('Request deleted', 'success');
      ondeleted?.();
    } catch (err) {
      showToast('Failed to delete request', 'error');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="nreq"
  class:on={isActive}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
>
  <div class="drag-handle" title="Drag to reorder">
    <svg viewBox="0 0 24 24" width="10" height="10"><circle cx="8" cy="6" r="1.5" fill="currentColor"/><circle cx="16" cy="6" r="1.5" fill="currentColor"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="12" r="1.5" fill="currentColor"/><circle cx="8" cy="18" r="1.5" fill="currentColor"/><circle cx="16" cy="18" r="1.5" fill="currentColor"/></svg>
  </div>
  <span class="nreq-method" style="background:{colors.bg};color:{colors.color}">{methodLabel}</span>
  {#if renaming}
    <InlineInput
      value={request.name}
      placeholder="Request name..."
      onsubmit={handleRename}
      oncancel={cancelRename}
    />
  {:else}
    <span class="nreq-name">{request.name || request.url || 'Untitled'}</span>
    <button class="nreq-menu" onclick={handleMenuBtn} title="Options" tabindex="-1">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>
  {/if}
</div>

<ConfirmDialog
  bind:show={showDeleteConfirm}
  title="Delete Request"
  message="Are you sure you want to delete '{request.name || 'Untitled'}'? This cannot be undone."
  confirmText="Delete"
  onconfirm={handleDelete}
/>

<style>
  .nreq {
    padding: 7px 6px 7px 24px;
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    transition: background 0.1s, opacity 0.15s;
    border-left: 2px solid transparent;
    min-height: 36px;
  }
  .nreq:hover {
    background: var(--surface-hover);
    color: var(--t1);
  }
  .drag-handle {
    width: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--t4);
    flex-shrink: 0;
    cursor: grab;
    opacity: 0.3;
    transition: opacity 0.15s, color 0.15s;
  }
  .nreq:hover .drag-handle {
    opacity: 0.7;
  }
  .drag-handle:hover {
    color: var(--t2);
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .nreq.on {
    background: var(--n2);
    border-left-color: var(--acc);
  }
  .nreq-method {
    font-size: 9px;
    font-weight: 700;
    font-family: var(--mono);
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    letter-spacing: 0.04em;
  }
  .nreq-name {
    font-size: 12.5px;
    color: var(--t2);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--ui);
  }
  .nreq.on .nreq-name {
    color: var(--t1);
  }
  .nreq-menu {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--t4);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    display: none;
    align-items: center;
    justify-content: center;
    transition: background 0.1s, color 0.1s;
  }
  .nreq:hover .nreq-menu {
    display: flex;
  }
  .nreq-menu:hover {
    background: var(--surface-hover);
    color: var(--t1);
  }
</style>
