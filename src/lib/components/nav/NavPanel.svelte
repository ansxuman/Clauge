<script lang="ts">
  import { mode, navOpen } from '$lib/stores/app';
  import RestNav from './RestNav.svelte';
  import SqlNav from '$lib/modes/sql/components/SqlNav.svelte';
  import NoSqlNav from '$lib/modes/nosql/components/NoSqlNav.svelte';
  import AgentNav from '$lib/modes/agent/components/AgentNav.svelte';
  import SshNav from '$lib/modes/ssh/components/SshNav.svelte';
  import ExplorerNav from '$lib/modes/explorer/components/ExplorerNav.svelte';
  import HistoryPanel from './HistoryPanel.svelte';
  import WorkspaceNav from '$lib/modes/workspace/components/WorkspaceNav.svelte';
  import ImportExportModal from '$lib/shared/primitives/ImportExportModal.svelte';
  import { getNavPinned, setNavPinned } from '$lib/shared/constants/storage';
  import { AGENT_EVENT, WORKSPACE_EVENT } from '$lib/shared/constants/events';
  import { showContextMenu } from '$lib/shared/primitives/contextmenu';
  import { get } from 'svelte/store';
  import { inboxUnreadCount, markInboxRead, coworkers } from '$lib/modes/workspace/stores';
  import { tabs as sharedTabs, activeTabId, addTab, activateTab, openSettingsTab } from '$lib/shared/stores/tabs';

  const inboxActive = $derived(
    $mode === 'workspace' && !!$sharedTabs.find(t => t.id === $activeTabId && t.key === 'inbox'),
  );
  const coworkersActive = $derived(
    $mode === 'workspace' && !!$sharedTabs.find(t => t.id === $activeTabId && t.key === 'coworkers'),
  );

  function openInbox() {
    const key = 'inbox';
    const existing = get(sharedTabs).find(t => t.mode === 'workspace' && t.key === key);
    if (existing) activateTab(existing.id);
    else addTab('Inbox', 'workspace', key, 'var(--acc)');
    mode.set('workspace');
    markInboxRead();
  }

  function openCoworkers() {
    const key = 'coworkers';
    const existing = get(sharedTabs).find(t => t.mode === 'workspace' && t.key === key);
    if (existing) activateTab(existing.id);
    else addTab('Co-workers', 'workspace', key, 'var(--acc)');
    mode.set('workspace');
  }

  let searchPerMode = $state<Record<string, string>>({ rest: '', sql: '', nosql: '', agent: '', ssh: '', workspace: '' });
  let searchQuery = $derived(searchPerMode[$mode] ?? '');
  let restNavRef: ReturnType<typeof RestNav> | undefined = $state();
  let sqlNavRef: ReturnType<typeof SqlNav> | undefined = $state();
  let nosqlNavRef: ReturnType<typeof NoSqlNav> | undefined = $state();
  let agentNavRef: ReturnType<typeof AgentNav> | undefined = $state();
  let sshNavRef: ReturnType<typeof SshNav> | undefined = $state();
  let showImportExport = $state(false);

  // Pin/unpin: pinned = always visible in layout, unpinned = overlay panel.
  let navPinned = $state(getNavPinned());

  function togglePin() {
    navPinned = !navPinned;
    setNavPinned(navPinned);
    navOpen.set(navPinned);
  }

  let navPanelEl: HTMLElement;

  function handleMouseLeavePanel(e: MouseEvent) {
    if (navPinned) return;
    if (!navPanelEl) return;
    const rect = navPanelEl.getBoundingClientRect();
    if (e.clientX >= rect.right - 2) {
      navOpen.set(false);
    }
  }

  function handleOverlayDismiss() {
    if (!navPinned) navOpen.set(false);
  }

  import { onMount, onDestroy } from 'svelte';
  onMount(() => {
    window.addEventListener(AGENT_EVENT.EDIT_SESSION, handleOverlayDismiss);
    window.addEventListener(AGENT_EVENT.RESET_SESSION, handleOverlayDismiss);
    window.addEventListener(AGENT_EVENT.RELAUNCH_SESSION, handleOverlayDismiss);
    window.addEventListener(AGENT_EVENT.NEW_SESSION, handleOverlayDismiss);
  });
  onDestroy(() => {
    window.removeEventListener(AGENT_EVENT.EDIT_SESSION, handleOverlayDismiss);
    window.removeEventListener(AGENT_EVENT.RESET_SESSION, handleOverlayDismiss);
    window.removeEventListener(AGENT_EVENT.RELAUNCH_SESSION, handleOverlayDismiss);
    window.removeEventListener(AGENT_EVENT.NEW_SESSION, handleOverlayDismiss);
  });

  function setSearch(val: string) {
    searchPerMode[$mode] = val;
  }

  const searchPlaceholders = {
    rest: 'Search collections…',
    sql: 'Search connections…',
    nosql: 'Search connections…',
    agent: 'Search sessions…',
    ssh: 'Search SSH profiles…',
    explorer: 'Search connections…',
    history: 'Search history…',
    workspace: 'Search workspaces…',
  } as const;

  function handleAddClick() {
    if ($mode === 'rest') {
      restNavRef?.showAddCollection();
    } else if ($mode === 'sql') {
      sqlNavRef?.showAddConnection();
    } else if ($mode === 'nosql') {
      nosqlNavRef?.showAddConnection();
    } else if ($mode === 'agent') {
      window.dispatchEvent(new CustomEvent(AGENT_EVENT.NEW_SESSION));
    } else if ($mode === 'ssh') {
      sshNavRef?.showAddProfile();
    } else if ($mode === 'explorer') {
      window.dispatchEvent(new CustomEvent('explorer:add-connection'));
    } else if ($mode === 'workspace') {
      // Workspaces aren't name-only — they accept an optional project
      // link, so the full modal is the right surface (REST collections
      // are name-only and inline creation makes sense there).
      window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT.NEW_WORKSPACE));
    }
  }

  /** Per-mode add button tooltip — drives the title attr only. */
  const addLabels = {
    rest: 'New collection',
    sql: 'New connection',
    nosql: 'New connection',
    agent: 'New session',
    ssh: 'New SSH profile',
    explorer: 'New connection',
    workspace: 'New workspace',
  } as const;

  /** Open the overflow menu at a button's position. Per-mode items are
   *  appended above the always-present Pin/Unpin entry so each mode's
   *  secondary action (REST: import/export, SSH: import ssh_config)
   *  stays one click away without polluting the bar with extra icons. */
  function openOverflow(ev: MouseEvent) {
    ev.stopPropagation();
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const items: any[] = [];
    if ($mode === 'rest') {
      items.push({
        label: 'Import / Export',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        action: () => (showImportExport = true),
      });
      items.push({ label: '', action: () => {}, separator: true });
    }
    items.push({
      label: navPinned ? 'Unpin sidebar' : 'Pin sidebar',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/><path d="M9 3v18"/></svg>',
      action: togglePin,
    });
    showContextMenu(rect.right - 4, rect.bottom + 4, items);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<nav
  bind:this={navPanelEl}
  class="nav-panel glass-surface-light"
  class:shut={!$navOpen}
  class:overlay={!navPinned && $navOpen}
  onmouseleave={handleMouseLeavePanel}
>
  {#snippet searchBar()}
    <div class="nav-search-wrap nav-search-inline">
      <svg class="nav-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        type="text"
        class="nav-search-input"
        placeholder={searchPlaceholders[$mode] ?? 'Search…'}
        value={searchQuery}
        oninput={(e) => setSearch((e.target as HTMLInputElement).value)}
      />
    </div>
  {/snippet}

  {#if $mode === 'sql' || $mode === 'nosql' || $mode === 'ssh' || $mode === 'explorer'}
    {@const ctaLabel = $mode === 'ssh' ? 'New SSH Profile' : 'New Connection'}
    {@const sectionLabel = $mode === 'ssh' ? 'PROFILES' : 'CONNECTIONS'}
    <div class="nav-header-agent" data-drag-region>
      <div class="ah-cta-row">
        <button class="ah-cta" onclick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>{ctaLabel}</span>
        </button>
        <button class="ah-pin-btn" title={navPinned ? 'Unpin sidebar' : 'Pin sidebar'} onclick={togglePin}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            {#if !navPinned}<line x1="3" y1="3" x2="21" y2="21"/>{/if}
          </svg>
        </button>
      </div>
      {@render searchBar()}
      <div class="ah-divider"></div>
      <div class="ah-section">{sectionLabel}</div>
    </div>
  {:else if $mode === 'rest'}
    <div class="nav-header-agent" data-drag-region>
      <div class="ah-cta-row">
        <button class="ah-cta" onclick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>New Collection</span>
        </button>
        <button class="ah-pin-btn" title={navPinned ? 'Unpin sidebar' : 'Pin sidebar'} onclick={togglePin}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            {#if !navPinned}<line x1="3" y1="3" x2="21" y2="21"/>{/if}
          </svg>
        </button>
      </div>
      <div class="ah-grid">
        <button class="ah-card" onclick={() => mode.set('history')}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span class="ah-card-label">History</span>
        </button>
        <button class="ah-card" onclick={() => (showImportExport = true)}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="ah-card-label">Import / Export</span>
        </button>
      </div>
      {@render searchBar()}
      <div class="ah-divider"></div>
      <div class="ah-section">COLLECTIONS</div>
    </div>
  {:else if $mode === 'workspace'}
    <div class="nav-header-agent" data-drag-region>
      <div class="ah-cta-row">
        <button class="ah-cta" onclick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>New Workspace</span>
        </button>
        <button class="ah-pin-btn" title={navPinned ? 'Unpin sidebar' : 'Pin sidebar'} onclick={togglePin}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            {#if !navPinned}<line x1="3" y1="3" x2="21" y2="21"/>{/if}
          </svg>
        </button>
      </div>
      <div class="ah-grid">
        <button class="ah-card" class:active={inboxActive} onclick={openInbox}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <span class="ah-card-label">
            Inbox
            {#if $inboxUnreadCount > 0}<span class="ah-card-badge">{$inboxUnreadCount > 99 ? '99+' : $inboxUnreadCount}</span>{/if}
          </span>
        </button>
        <button class="ah-card" class:active={coworkersActive} onclick={openCoworkers}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="6" r="2.4"/><path d="M14 13a4.5 4.5 0 0 1 8.5 2"/></svg>
          <span class="ah-card-label">
            Co-workers
            {#if $coworkers.length > 0}<span class="ah-card-badge muted">{$coworkers.length}</span>{/if}
          </span>
        </button>
      </div>
      {@render searchBar()}
      <div class="ah-divider"></div>
      <div class="ah-section">WORKSPACES</div>
    </div>
  {:else if $mode === 'agent'}
    <div class="nav-header-agent" data-drag-region>
      <div class="ah-cta-row">
        <button class="ah-cta" onclick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>New Session</span>
        </button>
        <button class="ah-pin-btn" title={navPinned ? 'Unpin sidebar' : 'Pin sidebar'} onclick={togglePin}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2.5"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            {#if !navPinned}<line x1="3" y1="3" x2="21" y2="21"/>{/if}
          </svg>
        </button>
      </div>
      <div class="ah-grid">
        <button class="ah-card" onclick={() => openSettingsTab('agent:contexts')}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
          <span class="ah-card-label">Contexts</span>
        </button>
        <button class="ah-card" onclick={() => openSettingsTab('agent:plugins')}>
          <svg class="ah-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11V9a2 2 0 00-2-2h-4V3a2 2 0 00-2-2h-4a2 2 0 00-2 2v4H4a2 2 0 00-2 2v2a4 4 0 010 8v2a2 2 0 002 2h4v-2a4 4 0 018 0v2h4a2 2 0 002-2v-4a4 4 0 010-8z"/></svg>
          <span class="ah-card-label">Plugins</span>
        </button>
      </div>
      {@render searchBar()}
      <div class="ah-divider"></div>
      <div class="ah-section">SESSIONS</div>
    </div>
  {:else}
    <div class="nav-header" data-drag-region>
      <div class="nav-search-wrap">
        <svg class="nav-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          class="nav-search-input"
          placeholder={searchPlaceholders[$mode] ?? 'Search…'}
          value={searchQuery}
          oninput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
      </div>
      {#if $mode !== 'history'}
        <button class="nav-action nav-add" title={addLabels[$mode]} onclick={handleAddClick}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
      {/if}
      <button class="nav-action nav-overflow" title="More" onclick={openOverflow}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>
        </svg>
      </button>
    </div>
  {/if}

  <div class="nav-body">
    {#if $mode === 'history'}
      <HistoryPanel />
    {:else if $mode === 'workspace'}
      <WorkspaceNav {searchQuery} />
    {:else if $mode === 'rest'}
      <RestNav bind:this={restNavRef} {searchQuery} />
    {:else if $mode === 'sql'}
      <SqlNav bind:this={sqlNavRef} {searchQuery} />
    {:else if $mode === 'agent'}
      <AgentNav bind:this={agentNavRef} {searchQuery} />
    {:else if $mode === 'ssh'}
      <SshNav bind:this={sshNavRef} {searchQuery} />
    {:else if $mode === 'explorer'}
      <ExplorerNav {searchQuery} />
    {:else}
      <NoSqlNav bind:this={nosqlNavRef} {searchQuery} />
    {/if}
  </div>
</nav>

<ImportExportModal bind:show={showImportExport} />

<style>
  .nav-panel {
    width: 300px;
    min-width: 300px;
    background: var(--n);
    border-right: 1px solid var(--b1);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                min-width 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.15s ease,
                transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .nav-panel.shut {
    width: 0;
    min-width: 0;
    border-right-width: 0;
    overflow: hidden;
  }

  /* Overlay mode: floats on top of content, doesn't take layout space */
  .nav-panel.overlay {
    position: absolute;
    top: 0;
    left: 72px; /* after sidebar */
    bottom: 0;
    z-index: 100;
    box-shadow: 8px 0 24px rgba(0, 0, 0, 0.3);
    animation: navSlideIn 0.15s ease;
  }
  @keyframes navSlideIn {
    from { opacity: 0; transform: translateX(-8px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* Single combined header. Search input is the centerpiece, with the
     primary (+) action and a (⋯) overflow on the right. No mode title —
     that's already shown by the highlighted sidebar mode button + the
     topbar tab marker, so a third repeat would just be noise. */
  .nav-header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 48px;
    flex-shrink: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--b1);
    background: var(--n2);
  }
  .nav-search-wrap {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
  }
  /* Inline variant for custom headers (.nav-header-agent uses column flex,
     so the default `flex: 1` would make the search input grow vertically). */
  .nav-search-inline { flex: initial; width: 100%; }
  .nav-search-icon {
    position: absolute;
    left: 9px;
    width: 14px;
    height: 14px;
    color: var(--t4);
    pointer-events: none;
  }
  .nav-search-input {
    width: 100%;
    height: 32px;
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    border-radius: var(--radius-md, 6px);
    padding: 0 10px 0 30px;
    font-size: 12.5px;
    color: var(--t1);
    font-family: var(--ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .nav-search-input::placeholder { color: var(--t3); }
  .nav-search-input:focus {
    border-color: var(--acc);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 12%, transparent);
  }

  /* Action buttons — same 32px height as search to read as one bar.
     (+) is the primary action so it gets accent treatment. */
  .nav-action {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 1px solid var(--b1);
    background: transparent;
    border-radius: var(--radius-md, 6px);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: default;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    color: var(--t3);
  }
  .nav-action svg { width: 14px; height: 14px; }
  .nav-action:hover { color: var(--t1); border-color: var(--b2); background: var(--surface-hover); }
  .nav-add {
    color: var(--acc);
    border-color: color-mix(in srgb, var(--acc) 35%, var(--b1));
    background: color-mix(in srgb, var(--acc) 10%, transparent);
  }
  .nav-add:hover {
    color: #fff;
    background: var(--acc);
    border-color: var(--acc);
  }
  .nav-overflow svg { width: 16px; height: 16px; }

  .nav-header-agent {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    padding: 14px 12px 0;
    gap: 14px;
  }

  .ah-cta-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ah-pin-btn {
    width: 44px;
    height: 44px;
    border: 1px solid color-mix(in srgb, var(--acc) 22%, var(--b1));
    background: color-mix(in srgb, var(--acc) 6%, transparent);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: color-mix(in srgb, var(--acc) 80%, var(--t1));
    transition: background 0.12s, color 0.12s, border-color 0.12s;
    padding: 0;
    flex-shrink: 0;
  }
  .ah-pin-btn svg { width: 16px; height: 16px; }
  .ah-pin-btn:hover {
    background: color-mix(in srgb, var(--acc) 14%, transparent);
    border-color: color-mix(in srgb, var(--acc) 45%, var(--b1));
    color: var(--t1);
  }

  .ah-cta {
    flex: 1;
    height: 44px;
    border: 1px solid color-mix(in srgb, var(--acc) 22%, var(--b1));
    background: color-mix(in srgb, var(--acc) 6%, transparent);
    color: var(--t2);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    font-family: var(--ui);
    font-size: 14px;
    font-weight: 600;
    transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.08s;
  }
  .ah-cta svg {
    width: 16px;
    height: 16px;
    color: color-mix(in srgb, var(--acc) 80%, var(--t1));
  }
  .ah-cta:hover {
    background: color-mix(in srgb, var(--acc) 14%, transparent);
    border-color: color-mix(in srgb, var(--acc) 45%, var(--b1));
    color: var(--t1);
  }
  .ah-cta:active { transform: scale(0.985); }

  .ah-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ah-card {
    border: 1px solid color-mix(in srgb, var(--acc) 22%, var(--b1));
    background: color-mix(in srgb, var(--acc) 6%, transparent);
    color: var(--t2);
    border-radius: 10px;
    padding: 14px 14px 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    font-family: var(--ui);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.08s;
  }
  .ah-card:hover {
    background: color-mix(in srgb, var(--acc) 14%, transparent);
    border-color: color-mix(in srgb, var(--acc) 45%, var(--b1));
    color: var(--t1);
  }
  .ah-card:active { transform: scale(0.985); }
  .ah-card.active {
    background: color-mix(in srgb, var(--acc) 18%, transparent);
    border-color: color-mix(in srgb, var(--acc) 55%, var(--b1));
    color: var(--t1);
  }
  .ah-card-icon {
    width: 18px;
    height: 18px;
    color: color-mix(in srgb, var(--acc) 80%, var(--t1));
  }
  .ah-card-label {
    line-height: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ah-card-badge {
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--acc);
    color: #fff;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    font-family: var(--ui);
  }
  .ah-card-badge.muted {
    background: color-mix(in srgb, var(--t1) 14%, transparent);
    color: var(--t2);
    font-weight: 600;
  }

  .ah-divider {
    height: 1px;
    background: var(--b1);
    opacity: 0.6;
    margin: 4px 0;
  }
  .ah-section {
    padding: 0 4px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--acc);
    font-family: var(--ui);
  }

  .nav-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .nav-body::-webkit-scrollbar { width: 3px; }
  .nav-body::-webkit-scrollbar-thumb { background: var(--b1); border-radius: 2px; }
</style>
