<script lang="ts">
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import ClaudeNotInstalledModal from './ClaudeNotInstalledModal.svelte';
  import CodexNotInstalledModal from './CodexNotInstalledModal.svelte';
  import GeminiNotInstalledModal from './GeminiNotInstalledModal.svelte';
  import OpenCodeNotInstalledModal from './OpenCodeNotInstalledModal.svelte';
  import { agentCreateSession, agentDiscoverSessions, agentListContexts, agentAttachContext, agentUpdateSessionId, agentCheckClaudeInstalled, agentCheckCliInstalled } from '../commands';
  import type { AgentContext, DiscoveredSession, AgentProvider } from '../types';
  import { AGENT_PROVIDERS } from '../types';

  // Provider tile icons live in /static. Same brand assets you see in
  // the agent nav session-row, so the New Session picker matches the
  // session list visually.
  const PROVIDER_ICON: Record<AgentProvider, string> = {
    claude: '/code-no-action.svg',
    codex: '/codex.svg',
    gemini: '/gemini.svg',
    opencode: '/opencode-dark.svg',
  };
  import { loadAgentSessions, agentSessions, activeAgentSession, agentFooterProvider } from '../stores';
  import { tabs as tabsStore, addTab, activateTab } from '$lib/shared/stores/tabs';
  import { showToast } from '$lib/shared/primitives/toast';
  import { SESSION_PURPOSES, getPurposeColor, getPurposePrompt } from '../ai/prompt';
  import { get } from 'svelte/store';

  let { show = $bindable(false) } = $props();

  let showClaudeNotInstalled = $state(false);
  let showCodexNotInstalled = $state(false);
  let showGeminiNotInstalled = $state(false);
  let showOpenCodeNotInstalled = $state(false);

  // Form state — matches original Clauge exactly
  let projectPath = $state('');
  let title = $state('');
  let purpose = $state('');  // Empty by default — user must pick
  // Which CLI backs this session. Defaults to the footer-selected provider
  // (whichever the user last looked at usage for) so the typical
  // "open another session in the same CLI" flow is one click. Coerced to
  // an `AgentProvider` since the footer store can technically widen.
  let provider = $state<AgentProvider>(
    (['claude', 'codex', 'gemini', 'opencode'] as const).includes(($agentFooterProvider as any))
      ? ($agentFooterProvider as AgentProvider)
      : 'claude',
  );
  // Per-provider install state — drives the disabled grey-out in the picker.
  // Loaded on modal open + when the picker mounts.
  let installedByProvider = $state<Record<string, boolean>>({ claude: true });
  let skipPermissions = $state(false);
  let customPrompt = $state('');
  let gitEnabled = $state(false);
  let gitName = $state('');
  let gitEmail = $state('');
  let loading = $state(false);

  // Resume existing session (Custom purpose only)
  let discoveredSessions = $state<DiscoveredSession[]>([]);
  let selectedSessionId = $state('');

  // Context attachment
  let contextEnabled = $state(false);
  let availableContexts = $state<AgentContext[]>([]);
  let attachedContextNames = $state<string[]>([]);
  let showContextDropdown = $state(false);

  const purposes = SESSION_PURPOSES.map(p => ({ label: p.id, color: p.color }));

  // Check if a purpose is already active for this project
  function isPurposeUsed(purposeLabel: string): boolean {
    if (!projectPath.trim()) return false;
    const sessions = get(agentSessions);
    return sessions.some(s => s.projectPath === projectPath.trim() && s.purpose === purposeLabel);
  }

  async function loadDiscoveredSessions(path: string) {
    try {
      // Pass the selected provider so the backend queries the right
      // session store (Claude per-project jsonl dir, Codex date-tree
      // sessions filtered by cwd, or OpenCode SQLite by directory).
      const sessions = await agentDiscoverSessions(path, provider);
      // Filter out sessions already linked to a profile of the same
      // provider — `claudeSessionId` is the historical column name for
      // the CLI session id (rename deferred).
      const allSessions = get(agentSessions).filter(
        (s) => (s.provider ?? 'claude') === provider,
      );
      const linkedIds = new Set(
        allSessions.filter((s) => s.claudeSessionId).map((s) => s.claudeSessionId),
      );
      discoveredSessions = sessions.filter((s) => !linkedIds.has(s.sessionId));
      selectedSessionId = '';
    } catch (_) {
      discoveredSessions = [];
    }
  }

  // Reload discovered sessions whenever the user picks a different
  // provider OR re-types the project path — keeps the "Custom" purpose
  // picker honest across provider switches.
  $effect(() => {
    const _ = provider; // dependency
    if (projectPath.trim()) {
      loadDiscoveredSessions(projectPath.trim());
    } else {
      discoveredSessions = [];
    }
  });

  async function loadContexts() {
    try {
      availableContexts = await agentListContexts();
    } catch (_) {
      availableContexts = [];
    }
  }

  // Probe each provider's binary on $PATH so the picker can grey out
  // CLIs the user hasn't installed yet. Fire-and-forget — failure leaves
  // the existing state; only Claude is assumed-true by default.
  async function loadProviderInstallStates() {
    const next: Record<string, boolean> = { ...installedByProvider };
    await Promise.all(
      AGENT_PROVIDERS.map(async (p) => {
        try { next[p.id] = await agentCheckCliInstalled(p.id); }
        catch { next[p.id] = p.id === 'claude'; }
      }),
    );
    installedByProvider = next;
  }
  // Refresh probe whenever the modal opens.
  $effect(() => {
    if (show) void loadProviderInstallStates();
  });

  async function pickFolder() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title: 'Select Project Folder' });
      if (selected) {
        projectPath = selected as string;
        if (!title) title = (selected as string).split('/').filter(Boolean).pop() || '';
        loadDiscoveredSessions(selected as string);
      }
    } catch (_) {}
  }

  async function handleCreate() {
    if (!projectPath.trim() || !title.trim() || !purpose) return;
    if (gitEnabled && (!gitName.trim() || !gitEmail.trim())) return;

    try {
      // Each provider gets its own install dialog with per-OS commands
      // and a docs link. The agentCheckClaudeInstalled call is the
      // legacy path; for Codex / OpenCode we use the generic
      // agentCheckCliInstalled.
      if (provider === 'claude') {
        if (!(await agentCheckClaudeInstalled())) {
          showClaudeNotInstalled = true;
          return;
        }
      } else if (provider === 'codex') {
        if (!(await agentCheckCliInstalled('codex'))) {
          showCodexNotInstalled = true;
          return;
        }
      } else if (provider === 'gemini') {
        if (!(await agentCheckCliInstalled('gemini'))) {
          showGeminiNotInstalled = true;
          return;
        }
      } else if (provider === 'opencode') {
        if (!(await agentCheckCliInstalled('opencode'))) {
          showOpenCodeNotInstalled = true;
          return;
        }
      }
    } catch (_) {
      // If the check fails, fall through and let the spawn surface the error.
    }

    loading = true;
    try {
      const session = await agentCreateSession({
        title: title.trim(),
        purpose,
        projectPath: projectPath.trim(),
        skipPermissions: skipPermissions || undefined,
        customPrompt: purpose === 'Custom'
          ? (customPrompt.trim() || undefined)
          : (getPurposePrompt(purpose) ?? undefined),
        gitName: gitEnabled && gitName.trim() ? gitName.trim() : undefined,
        gitEmail: gitEnabled && gitEmail.trim() ? gitEmail.trim() : undefined,
        provider,
      });

      // Link resumed Claude session if selected
      if (selectedSessionId) {
        await agentUpdateSessionId(session.id, selectedSessionId);
      }

      // Attach selected contexts
      if (contextEnabled && attachedContextNames.length > 0) {
        for (const ctx of availableContexts) {
          if (attachedContextNames.includes(ctx.name)) {
            await agentAttachContext(session.id, ctx.id);
          }
        }
      }

      await loadAgentSessions();

      // Auto-open: open the new session in a tab and activate it. Mirrors the
      // session-picker open flow in +layout.svelte so behavior is identical.
      const allTabs = get(tabsStore);
      const existing = allTabs.find((t) => t.mode === 'agent' && t.key === session.id);
      if (existing) {
        activateTab(existing.id);
      } else {
        addTab(session.title, 'agent', session.id, getPurposeColor(session.purpose));
      }
      activeAgentSession.set(session);

      show = false;
      resetForm();
    } catch (e: any) {
      showToast(String(e), 'error');
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    projectPath = ''; title = ''; purpose = ''; skipPermissions = false;
    customPrompt = ''; gitEnabled = false; gitName = ''; gitEmail = '';
    discoveredSessions = []; selectedSessionId = '';
    contextEnabled = false; attachedContextNames = []; showContextDropdown = false;
  }

  // Derived: can we enable the create button?
  let canCreate = $derived(
    projectPath.trim() !== '' &&
    title.trim() !== '' &&
    purpose !== '' &&
    (!gitEnabled || (gitName.trim() !== '' && gitEmail.trim() !== ''))
  );
</script>

<Modal bind:show title="New Session" width="440px">
  <div class="ns-form">
    <!-- Provider picker — pick the CLI this session talks to. Unavailable
         CLIs are greyed out so the user knows they can install + retry. -->
    <div class="ns-field">
      <span class="ns-label-text">Agent</span>
      <div class="ns-provider-row">
        {#each AGENT_PROVIDERS as p}
          {@const installed = installedByProvider[p.id] !== false}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <button
            class="ns-provider"
            class:selected={provider === p.id}
            class:disabled={!installed}
            disabled={!installed}
            title={installed ? `Use ${p.label}` : `${p.label} CLI is not on PATH`}
            onclick={() => { if (installed) provider = p.id; }}
          >
            <img class="ns-provider-icon" src={PROVIDER_ICON[p.id]} alt="" width="20" height="20" />
            <span class="ns-provider-label">{p.label}</span>
            {#if !installed}<span class="ns-provider-tag">not installed</span>{/if}
          </button>
        {/each}
      </div>
    </div>

    <label class="ns-field">
      <span class="ns-label">Project Folder</span>
      <div class="ns-path-row">
        <input
          class="ns-input ns-path-input"
          type="text"
          bind:value={projectPath}
          placeholder="/path/to/project"
          onblur={() => { if (projectPath.trim()) loadDiscoveredSessions(projectPath.trim()); }}
        />
        <button class="ns-btn-browse" onclick={pickFolder}>Browse</button>
      </div>
    </label>

    <label class="ns-field">
      <span class="ns-label">Title</span>
      <input class="ns-input" type="text" bind:value={title} placeholder="e.g. Auth Refactor" />
    </label>

    <div class="ns-field">
      <span class="ns-label-text">Purpose</span>
      <div class="ns-chips">
        {#each purposes as p}
          {#if !projectPath.trim()}
            <span class="ns-chip disabled">{p.label}</span>
          {:else if p.label !== 'Custom' && isPurposeUsed(p.label)}
            <span class="ns-chip disabled" title="{p.label} already active for this project">{p.label}</span>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <span
              class="ns-chip"
              class:selected={purpose === p.label}
              style={purpose === p.label ? `background:${p.color}33;color:${p.color};border-color:${p.color}` : ''}
              onclick={() => { purpose = p.label; if (p.label === 'Custom' && projectPath.trim()) loadDiscoveredSessions(projectPath.trim()); }}
            >{p.label}</span>
          {/if}
        {/each}
      </div>
    </div>

    {#if discoveredSessions.length > 0 && purpose !== 'Custom'}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="ns-hint" onclick={() => { purpose = 'Custom'; }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>{discoveredSessions.length} previous session{discoveredSessions.length > 1 ? 's' : ''} found — <strong style="color:var(--acc);cursor:pointer;">resume via Custom</strong></span>
      </div>
    {/if}

    {#if purpose === 'Custom'}
      {#if discoveredSessions.length > 0}
        <label class="ns-field">
          <span class="ns-label">Resume Existing Session</span>
          <select class="ns-select" bind:value={selectedSessionId}>
            <option value="">Start fresh</option>
            {#each discoveredSessions as s}
              <option value={s.sessionId}>{s.preview || s.sessionId.slice(0, 8)} — {new Date(s.modifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="ns-field">
        <span class="ns-label">System Prompt <span class="ns-optional">(optional)</span></span>
        <textarea class="ns-textarea" bind:value={customPrompt} placeholder="Custom instructions for this session..." rows="2"></textarea>
      </label>
    {/if}

    <div class="ns-adv-label">Advanced</div>

    <!-- Skip Permissions toggle -->
    <div class="ns-toggle-row">
      <div class="ns-toggle-info">
        <span class="ns-toggle-text">Skip permissions</span>
        <span class="ns-toggle-hint">Auto-approve all tool calls without confirmation</span>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <button class="ns-toggle" class:on={skipPermissions} onclick={() => skipPermissions = !skipPermissions}>
        <span class="ns-toggle-knob"></span>
      </button>
    </div>

    <!-- Git Identity toggle -->
    <div class="ns-toggle-row">
      <div class="ns-toggle-info">
        <span class="ns-toggle-text">Git Identity</span>
        <span class="ns-toggle-hint">Override git author name and email for this session</span>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <button class="ns-toggle" class:on={gitEnabled} onclick={() => gitEnabled = !gitEnabled}>
        <span class="ns-toggle-knob"></span>
      </button>
    </div>
    {#if gitEnabled}
      <div class="ns-adv-body">
        <div class="ns-row">
          <label class="ns-adv-field">
            <span class="ns-adv-label-sm">Name <span class="ns-required">*</span></span>
            <input type="text" class="ns-input" bind:value={gitName} placeholder="e.g. John Doe" />
          </label>
          <label class="ns-adv-field">
            <span class="ns-adv-label-sm">Email <span class="ns-required">*</span></span>
            <input type="text" class="ns-input" bind:value={gitEmail} placeholder="e.g. john@example.com" />
          </label>
        </div>
      </div>
    {/if}

    <!-- Attach Contexts toggle -->
    <div class="ns-toggle-row">
      <div class="ns-toggle-info">
        <span class="ns-toggle-text">Attach Contexts</span>
        <span class="ns-toggle-hint">Inject context snippets into CLAUDE.md before each spawn</span>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <button class="ns-toggle" class:on={contextEnabled} onclick={() => { contextEnabled = !contextEnabled; if (contextEnabled) loadContexts(); }}>
        <span class="ns-toggle-knob"></span>
      </button>
    </div>
    {#if contextEnabled}
      <div class="ns-adv-body">
        {#if attachedContextNames.length > 0}
          <div class="ns-ctx-chips">
            {#each attachedContextNames as name}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <span class="ns-ctx-chip">
                {name}
                <span class="ns-ctx-x" onclick={() => { attachedContextNames = attachedContextNames.filter(n => n !== name); }}>×</span>
              </span>
            {/each}
          </div>
        {/if}
        <div class="ns-ctx-add-wrap">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <button class="ns-ctx-add-btn" onclick={(e) => { e.stopPropagation(); showContextDropdown = !showContextDropdown; }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/></svg>
            Add
          </button>
          {#if showContextDropdown}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="ns-ctx-backdrop" onclick={() => showContextDropdown = false}></div>
            <div class="ns-ctx-dropdown">
              {#each availableContexts.filter(c => !attachedContextNames.includes(c.name)) as ctx}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="ns-ctx-dd-item" onclick={() => { attachedContextNames = [...attachedContextNames, ctx.name]; showContextDropdown = false; }}>
                  <span class="ns-ctx-dd-name">{ctx.name}</span>
                  <span class="ns-ctx-dd-preview">{ctx.content.slice(0, 60)}</span>
                </div>
              {:else}
                <div class="ns-ctx-dd-empty">No more contexts available</div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="ns-actions">
      <button class="ns-btn-cancel" onclick={() => { show = false; resetForm(); }}>Cancel</button>
      <button class="ns-btn-create" onclick={handleCreate} disabled={!canCreate || loading}>
        {loading ? 'Creating...' : 'Create'}
      </button>
    </div>
  </div>
</Modal>

<ClaudeNotInstalledModal bind:show={showClaudeNotInstalled} />
<CodexNotInstalledModal bind:show={showCodexNotInstalled} />
<GeminiNotInstalledModal bind:show={showGeminiNotInstalled} />
<OpenCodeNotInstalledModal bind:show={showOpenCodeNotInstalled} />

<style>
  .ns-form { display: flex; flex-direction: column; gap: 12px; }
  .ns-field { display: flex; flex-direction: column; gap: 4px; }

  /* Provider picker — segmented tiles using brand SVGs (the same icons
   * shown in the agent session-row). Accent on selected tile uses the
   * app accent rather than per-brand colour so it themes consistently. */
  .ns-provider-row { display: flex; gap: 8px; }
  .ns-provider {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    gap: 4px; padding: 10px 8px;
    background: var(--e); border: 1px solid var(--b1); border-radius: 8px;
    color: var(--t2); font-family: var(--ui); font-size: 11.5px;
    cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .ns-provider:hover:not(.disabled) { color: var(--t1); border-color: color-mix(in srgb, var(--t1) 22%, var(--b1)); }
  .ns-provider.selected {
    color: var(--t1);
    background: color-mix(in srgb, var(--acc) 10%, transparent);
    border-color: color-mix(in srgb, var(--acc) 45%, var(--b1));
  }
  .ns-provider.disabled { opacity: 0.45; cursor: not-allowed; }
  .ns-provider-icon { display: block; }
  .ns-provider-label { font-weight: 500; }
  .ns-provider-tag {
    font-size: 9.5px; color: var(--t4); letter-spacing: 0.04em; text-transform: uppercase;
  }
  .ns-label { font-size: 12px; font-weight: 600; color: var(--t2); text-transform: uppercase; font-family: var(--ui); }
  .ns-label-text { font-size: 13px; color: var(--t1); font-family: var(--ui); }
  .ns-optional { font-size: 10px; color: var(--t3); font-weight: normal; text-transform: none; }
  .ns-input {
    width: 100%; background: var(--e); border: 1px solid var(--b1); border-radius: 6px;
    padding: 8px 10px; font-size: 13px; color: var(--t1); outline: none; box-sizing: border-box;
    font-family: var(--mono); transition: border-color 0.15s;
  }
  .ns-input:focus { border-color: var(--acc); }
  .ns-input::placeholder { color: var(--t3); }
  .ns-textarea {
    width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--b1);
    background: var(--e); color: var(--t1); font-size: 12px; font-family: var(--mono);
    resize: vertical; min-height: 50px; line-height: 1.5; outline: none; box-sizing: border-box;
  }
  .ns-textarea:focus { border-color: var(--acc); }
  .ns-textarea::placeholder { color: var(--t3); }
  .ns-select {
    width: 100%; padding: 7px 10px; padding-right: 28px; border-radius: 6px; border: 1px solid var(--b1);
    background: var(--e); color: var(--t1); font-size: 12px; font-family: var(--ui);
    -webkit-appearance: none; appearance: none; cursor: pointer; outline: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23b0b0c8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 5 6 8 9 5'/></svg>");
    background-repeat: no-repeat; background-position: right 10px center; background-size: 10px 10px;
  }
  .ns-select option { background: var(--n); color: var(--t1); }
  .ns-path-row { display: flex; gap: 8px; }
  .ns-path-input { flex: 1; }
  .ns-btn-browse {
    background: var(--n); border: 1px solid var(--b1); border-radius: 6px;
    padding: 8px 12px; color: var(--t1); font-size: 13px; cursor: pointer;
    white-space: nowrap; font-family: var(--ui); transition: border-color 0.15s;
  }
  .ns-btn-browse:hover { border-color: var(--b2); }
  .ns-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .ns-chip {
    padding: 5px 12px; border-radius: 14px; border: 1px solid var(--b1);
    background: transparent; color: var(--t2); font-size: 12px; cursor: pointer;
    font-family: var(--ui); transition: background 0.15s, color 0.15s; user-select: none;
  }
  .ns-chip:hover:not(.selected):not(.disabled) { background: var(--surface-hover); }
  .ns-chip.disabled { opacity: 0.3; cursor: not-allowed; }
  .ns-chip.selected { font-weight: 600; }
  .ns-hint {
    display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--acc) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--acc) 20%, transparent);
  }
  .ns-hint svg { flex-shrink: 0; margin-top: 1px; }
  .ns-hint span { font-size: 11px; color: var(--t2); line-height: 1.4; }
  .ns-adv-label {
    font-size: 11px; font-weight: 600; color: var(--t3); text-transform: uppercase;
    letter-spacing: 0.1em; margin-top: 6px; font-family: var(--ui);
  }
  .ns-toggle-row {
    display: flex; align-items: center; justify-content: space-between; margin-top: 4px;
  }
  .ns-toggle-info { display: flex; flex-direction: column; gap: 2px; }
  .ns-toggle-text { font-size: 12px; color: var(--t2); font-family: var(--ui); }
  .ns-toggle-hint { font-size: 10px; color: var(--t4); font-family: var(--ui); }
  .ns-toggle {
    width: 36px; height: 20px; border-radius: 10px; border: 1px solid var(--b1);
    background: var(--surface-hover); cursor: pointer; position: relative;
    transition: all 0.2s; padding: 0;
  }
  .ns-toggle.on { background: var(--acc); border-color: var(--acc); }
  .ns-toggle-knob {
    position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
    border-radius: 50%; background: var(--t3); transition: all 0.2s;
  }
  .ns-toggle.on .ns-toggle-knob { left: 18px; background: #fff; }
  .ns-adv-body {
    display: flex; flex-direction: column; gap: 8px; padding: 4px 0 0;
    animation: advIn 0.12s ease;
  }
  @keyframes advIn { from { opacity: 0; } to { opacity: 1; } }
  .ns-row { display: flex; gap: 8px; }
  .ns-adv-field { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .ns-adv-label-sm { font-size: 11px; color: var(--t3); font-family: var(--ui); }
  .ns-required { color: var(--err, #f85149); font-weight: 600; }
  .ns-ctx-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .ns-ctx-chip {
    display: flex; align-items: center; gap: 4px; padding: 3px 6px 3px 10px;
    border-radius: 12px; background: color-mix(in srgb, var(--acc) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--acc) 25%, transparent);
    color: var(--acc); font-size: 11px; font-weight: 500;
  }
  .ns-ctx-x { cursor: pointer; font-size: 14px; line-height: 1; opacity: 0.6; transition: opacity 0.1s; }
  .ns-ctx-x:hover { opacity: 1; }
  /* Click-outside catch for the dropdown. Stays visually invisible (no
     scrim) because we're already inside a modal — dimming the viewport
     a second time would imply a second modal. The transparent fill
     still receives clicks. z-index sits above sibling modal content
     but below the dropdown itself. */
  .ns-ctx-backdrop { position: fixed; inset: 0; z-index: var(--z-popover); background: transparent; }
  .ns-ctx-add-wrap { position: relative; }
  .ns-ctx-add-btn {
    display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 4px;
    border: 1px dashed var(--b1); background: transparent; color: var(--t3);
    font-size: 11px; font-family: var(--ui); cursor: pointer; transition: all 0.1s;
  }
  .ns-ctx-add-btn:hover { border-color: var(--acc); color: var(--acc); }
  .ns-ctx-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; width: 250px;
    background: var(--modal-bg, var(--n)); border: 1px solid var(--b1); border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: calc(var(--z-popover) + 1); max-height: 180px;
    overflow-y: auto; padding: 4px;
  }
  .ns-ctx-dd-item { padding: 6px 10px; border-radius: 4px; cursor: pointer; transition: background 0.1s; }
  .ns-ctx-dd-item:hover { background: var(--surface-hover); }
  .ns-ctx-dd-name { font-size: 12px; font-weight: 500; color: var(--t1); display: block; }
  .ns-ctx-dd-preview { font-size: 10px; color: var(--t3); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ns-ctx-dd-empty { padding: 10px; text-align: center; font-size: 11px; color: var(--t3); }
  .ns-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--b1); }
  .ns-btn-cancel {
    padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: 1px solid var(--b1); background: transparent; color: var(--t2); font-family: var(--ui);
  }
  .ns-btn-cancel:hover { background: var(--surface-hover); }
  .ns-btn-create {
    padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: none; background: var(--acc); color: #fff; font-weight: 600; font-family: var(--ui);
  }
  .ns-btn-create:hover:not(:disabled) { filter: brightness(1.1); }
  .ns-btn-create:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
