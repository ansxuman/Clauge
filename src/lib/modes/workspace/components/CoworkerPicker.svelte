<script lang="ts">
  // Inline coworker picker for the card drawer. Compact button that
  // opens a popover list of all coworkers. The "+ New coworker"
  // affordance opens the modal in-place so the user doesn't lose
  // their drawer context.

  import { coworkers, loadCoworkers } from '../stores';
  import CoworkerAvatar from './CoworkerAvatar.svelte';
  import CoworkerModal from './CoworkerModal.svelte';
  import type { WorkspaceCoworker } from '../types';

  interface Props {
    /** Currently picked coworker id, if any. Drives the trigger label. */
    value: string | null;
    /** Disable the picker (e.g. claim is held by a manual session). */
    disabled?: boolean;
    /** Compact mode: smaller trigger for the chat row. */
    compact?: boolean;
    onpick?: (cw: WorkspaceCoworker) => void;
  }

  let { value, disabled = false, compact = false, onpick }: Props = $props();

  let open = $state(false);
  let modalOpen = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let searchEl: HTMLInputElement | undefined = $state();
  let searchQuery = $state('');

  const selected = $derived(
    value ? $coworkers.find((c) => c.id === value) ?? null : null,
  );

  /** Filter by name OR role (case-insensitive). When the search is
   *  empty, the full list shows. */
  const filtered = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return $coworkers;
    return $coworkers.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.role ?? '').toLowerCase().includes(q),
    );
  });

  function toggle() {
    if (disabled) return;
    if (!open && $coworkers.length === 0) loadCoworkers();
    open = !open;
    if (open) {
      searchQuery = '';
      // Focus the search input after the popover renders.
      queueMicrotask(() => searchEl?.focus());
    }
  }

  function pick(cw: WorkspaceCoworker) {
    open = false;
    onpick?.(cw);
  }

  function openNew() {
    open = false;
    modalOpen = true;
  }

  /** Close on outside click. */
  function handleWindowClick(e: MouseEvent) {
    if (!open) return;
    if (triggerEl && triggerEl.contains(e.target as Node)) return;
    const popover = document.getElementById('coworker-picker-popover');
    if (popover && popover.contains(e.target as Node)) return;
    open = false;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="cp" class:cp-compact={compact}>
  <button
    bind:this={triggerEl}
    class="cp-trigger"
    class:cp-trigger-empty={!selected}
    onclick={toggle}
    {disabled}
    type="button"
    title={selected ? `Currently chatting with @${selected.name}` : 'Pick a coworker to chat with'}
  >
    {#if selected}
      <CoworkerAvatar seed={selected.avatarSeed} style={selected.avatarStyle} size={compact ? 18 : 22} />
      <span class="cp-trigger-name">@{selected.name}</span>
      {#if selected.role && !compact}
        <span class="cp-trigger-role">· {selected.role}</span>
      {/if}
    {:else}
      <span class="cp-trigger-empty-icon">@</span>
      <span class="cp-trigger-empty-label">Pick a coworker</span>
    {/if}
    <svg class="cp-trigger-chev" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  </button>

  {#if open}
    <div id="coworker-picker-popover" class="cp-pop">
      {#if $coworkers.length === 0}
        <div class="cp-empty">
          No coworkers yet.
          <button class="cp-empty-btn" onclick={openNew}>+ Create one</button>
        </div>
      {:else}
        <!-- Search input — auto-focused when popover opens. With 10+
             coworkers the list gets long fast; type-to-filter scales
             without UI changes. -->
        <div class="cp-search-row">
          <input
            bind:this={searchEl}
            class="cp-search"
            type="text"
            bind:value={searchQuery}
            placeholder="Search coworkers…"
            spellcheck="false"
          />
        </div>
        <div class="cp-list">
          {#if filtered.length === 0}
            <div class="cp-no-match">No matches for "{searchQuery}"</div>
          {/if}
          {#each filtered as cw (cw.id)}
            <button
              class="cp-item"
              class:cp-item-selected={cw.id === value}
              onclick={() => pick(cw)}
              type="button"
            >
              <CoworkerAvatar seed={cw.avatarSeed} style={cw.avatarStyle} size={28} />
              <div class="cp-item-text">
                <div class="cp-item-name">@{cw.name}</div>
                {#if cw.role}<div class="cp-item-role">{cw.role}</div>{/if}
              </div>
              {#if cw.id === value}<span class="cp-item-check">✓</span>{/if}
            </button>
          {/each}
        </div>
        <button class="cp-add" onclick={openNew} type="button">+ New coworker</button>
      {/if}
    </div>
  {/if}
</div>

<CoworkerModal bind:show={modalOpen} />

<style>
  .cp { position: relative; }
  .cp-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 4px;
    border: 1px solid var(--b1);
    background: var(--surface-hover);
    border-radius: 6px;
    cursor: default;
    color: var(--t1);
    font-family: var(--ui);
    font-size: 12px;
    transition: border-color 0.12s, background 0.12s;
  }
  .cp-trigger:hover:not(:disabled) { border-color: var(--acc); background: var(--surface-hover); }
  .cp-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
  .cp-compact .cp-trigger { height: 26px; font-size: 11.5px; padding-left: 4px; }

  .cp-trigger-name { font-weight: 600; }
  .cp-trigger-role { color: var(--t3); }
  .cp-trigger-chev { color: var(--t4); margin-left: 2px; }
  .cp-trigger-empty {
    color: var(--t3);
    border-style: dashed;
    background: transparent;
    padding-left: 8px;
  }
  .cp-trigger-empty:hover:not(:disabled) { color: var(--t1); }
  .cp-trigger-empty-icon {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--acc);
    font-weight: 700;
  }
  .cp-trigger-empty-label { font-style: italic; }

  .cp-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 240px;
    max-width: 320px;
    background: var(--n, #0d1117);
    border: 1px solid var(--b1);
    border-radius: 8px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    z-index: 220;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: pop 0.12s ease;
  }
  @keyframes pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

  .cp-search-row {
    padding: 4px 4px 0;
  }
  .cp-search {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    border-radius: 5px;
    padding: 5px 8px;
    color: var(--t1);
    font-family: var(--ui);
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.12s;
  }
  .cp-search:focus { border-color: var(--acc); }
  .cp-no-match {
    padding: 10px 8px;
    font-family: var(--ui);
    font-size: 11px;
    color: var(--t4);
    text-align: center;
  }

  .cp-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 280px;
    overflow-y: auto;
  }
  .cp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 5px;
    text-align: left;
    cursor: default;
    color: var(--t1);
    font-family: var(--ui);
    transition: background 0.1s;
  }
  .cp-item:hover { background: var(--surface-hover); }
  .cp-item-selected { background: color-mix(in srgb, var(--acc) 12%, transparent); }
  .cp-item-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .cp-item-name { font-size: 12px; font-weight: 600; }
  .cp-item-role { font-size: 10.5px; color: var(--t3); }
  .cp-item-check { color: var(--acc); font-weight: 700; }

  .cp-add {
    border: none;
    background: transparent;
    text-align: left;
    padding: 7px 10px;
    color: var(--acc);
    font-family: var(--ui);
    font-size: 11.5px;
    border-top: 1px solid var(--b1);
    margin-top: 4px;
    cursor: default;
  }
  .cp-add:hover { background: var(--surface-hover); }

  .cp-empty {
    padding: 10px 12px;
    font-family: var(--ui);
    font-size: 11.5px;
    color: var(--t3);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cp-empty-btn {
    border: none;
    background: transparent;
    color: var(--acc);
    font-family: var(--ui);
    font-size: 11.5px;
    text-align: left;
    padding: 0;
    cursor: default;
  }
  .cp-empty-btn:hover { text-decoration: underline; }
</style>
