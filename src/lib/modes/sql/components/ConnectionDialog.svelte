<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import type { SqlConnectionConfig, SqlDriver, SqlConnection } from '../types';
  import { SQL_DIALECTS, defaultPortFor, descriptorFor } from '../dialects';
  import { sqlTestConnection } from '../commands';
  import { showToast } from '$lib/shared/primitives/toast';
  import { friendlyError } from '$lib/utils/errors';
  import { sshProfiles, loadSshProfiles } from '$lib/modes/ssh/stores';
  import type { SshProfile } from '$lib/modes/ssh/types';
  import NewSshProfileModal from '$lib/modes/ssh/components/NewSshProfileModal.svelte';

  interface Props {
    show: boolean;
    editConnection?: SqlConnection | null;
    onsave?: (config: SqlConnectionConfig) => void;
    onclose?: () => void;
  }

  let { show = $bindable(false), editConnection = null, onsave, onclose }: Props = $props();

  const DEFAULT_DRIVER: SqlDriver = SQL_DIALECTS[0].key;
  const DEFAULT_PORT = SQL_DIALECTS[0].defaultPort;

  let name = $state('');
  let driver = $state<SqlDriver>(DEFAULT_DRIVER);
  let host = $state('');
  let port = $state(DEFAULT_PORT);
  let database = $state('');
  let username = $state('');
  let password = $state('');
  let ssl = $state(false);
  let testing = $state(false);
  let testStatus = $state('');
  let testOk = $state(false);

  let useSshTunnel = $state(false);
  let selectedSshProfileId = $state<string | null>(null);
  let showNewSshModal = $state(false);

  let tab = $state<'general' | 'advanced'>('general');

  $effect(() => {
    if (show && editConnection) {
      name = editConnection.name;
      driver = editConnection.driver;
      host = editConnection.host;
      port = editConnection.port;
      database = editConnection.databaseName;
      username = editConnection.username;
      password = editConnection.password;
      ssl = !!editConnection.ssl;
      const sid = editConnection.sshProfileId ?? null;
      useSshTunnel = !!sid;
      selectedSshProfileId = sid;
      tab = 'general';
      testOk = false;
    } else if (show && !editConnection) {
      name = '';
      driver = DEFAULT_DRIVER;
      host = '';
      port = DEFAULT_PORT;
      database = '';
      username = '';
      password = '';
      ssl = false;
      useSshTunnel = false;
      selectedSshProfileId = null;
      tab = 'general';
      testOk = false;
    }
  });

  // `loadSshProfiles` writes to the store unconditionally (even on empty
  // result), so without a one-shot guard this effect would loop: empty
  // list → reload → empty → reload …
  let sshLoadAttempted = $state(false);
  $effect(() => {
    if (show && !sshLoadAttempted) {
      sshLoadAttempted = true;
      loadSshProfiles();
    }
  });

  $effect(() => {
    if (useSshTunnel && !selectedSshProfileId && $sshProfiles.length > 0) {
      selectedSshProfileId = $sshProfiles[0].id;
    }
  });

  function pickDriver(key: SqlDriver) {
    driver = key;
    port = defaultPortFor(key);
    testOk = false;
  }

  async function browseForSqliteFile() {
    const picked = await openFileDialog({
      multiple: false,
      directory: false,
      title: 'Choose SQLite database file',
      filters: [
        { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof picked === 'string' && picked) {
      database = picked;
      if (!name.trim()) {
        const base = picked.split(/[\\/]/).pop() ?? '';
        if (base) name = base.replace(/\.[^.]+$/, '');
      }
    }
  }

  const usesHostPort = $derived(descriptorFor(driver)?.usesHostPort ?? false);
  // D1: HTTPS-only to api.cloudflare.com, identified by account id +
  // database id + API token. We reuse `host` (= account id), `database`
  // (= database id), `password` (= api token) — matches the Rust client.
  const isD1 = $derived(driver === 'd1');
  const isFileDriver = $derived(!usesHostPort && !isD1);
  const supportsSslSsh = $derived(usesHostPort);

  const selectedProfile = $derived(
    selectedSshProfileId ? $sshProfiles.find((p) => p.id === selectedSshProfileId) ?? null : null
  );

  // Per-driver brand color for the icon grid — only the glyph picks this
  // up, the active border still uses `--acc` so theming stays consistent.
  const DRIVER_COLORS: Record<SqlDriver, string> = {
    postgresql: '#4F9DD6',
    mysql:      '#E0A04C',
    sqlite:     '#5FB4D6',
    clickhouse: '#E8C44A',
    d1:         '#F18A2B',
  };

  function handleNewSshCreated(profile: SshProfile) {
    selectedSshProfileId = profile.id;
    useSshTunnel = true;
  }

  function buildConfig(): SqlConnectionConfig {
    return {
      name: name.trim(),
      driver,
      host,
      port,
      database,
      username,
      password,
      ssl,
      sshProfileId: useSshTunnel && selectedSshProfileId ? selectedSshProfileId : null,
    };
  }

  // Per-driver field validation. Used by both Test and Save so neither
  // path falls through to the backend with an empty config — sqlx
  // happily opens `sqlite:?mode=rwc` (empty path → private temp db) and
  // reports success, which is why a blank SQLite test was returning
  // "Connected" without the user typing anything. Returns the first
  // missing-field message or null when the config is shaped well enough
  // to send to the backend.
  function validateInputs(forSave: boolean): string | null {
    if (forSave && !name.trim()) return 'Connection name is required';
    if (isD1) {
      if (!host.trim()) return 'Account ID is required';
      if (!database.trim()) return 'Database ID is required';
      if (!password.trim()) return 'API token is required';
    } else if (!usesHostPort) {
      // SQLite (or any future file-backed driver) — the file path lives
      // in `database`. Without it, sqlx opens an unnamed temp database
      // that always "connects" — misleading and useless.
      if (!database.trim()) return 'Database file path is required';
    } else {
      if (!host.trim()) return 'Host is required';
      if (!port) return 'Port is required';
    }
    if (useSshTunnel && !selectedSshProfileId) return 'Pick an SSH profile or turn off the tunnel';
    return null;
  }

  async function handleTest() {
    const invalid = validateInputs(false);
    if (invalid) {
      showToast(invalid, 'error');
      return;
    }
    testing = true;
    testStatus = '';
    testOk = false;
    try {
      // Two-step when tunneling: prove the bastion works first so the
      // user sees a clear "tunnel failed" vs "DB failed" error.
      if (useSshTunnel && selectedSshProfileId && usesHostPort) {
        testStatus = 'Testing tunnel…';
        try {
          await invoke('ssh_tunnel_test', {
            profileId: selectedSshProfileId,
            targetHost: host,
            targetPort: port,
          });
        } catch (e: any) {
          if (!show) return;
          showToast(`Tunnel test failed: ${friendlyError(e)}`, 'error');
          return;
        }
        if (!show) return;
        testStatus = 'Testing database…';
      }
      const result = await sqlTestConnection(buildConfig());
      if (!show) return;
      showToast(result || 'Connection successful', 'success');
      testOk = true;
      setTimeout(() => { testOk = false; }, 2200);
    } catch (err: any) {
      if (!show) return;
      showToast(friendlyError(err), 'error');
    } finally {
      testing = false;
      testStatus = '';
    }
  }

  function handleSave() {
    const invalid = validateInputs(true);
    if (invalid) {
      showToast(invalid, 'error');
      return;
    }
    onsave?.(buildConfig());
    show = false;
  }

  const advancedHasState = $derived(supportsSslSsh && (ssl || useSshTunnel));
  const driverLabel = $derived(descriptorFor(driver)?.displayName ?? driver);
</script>

<Modal bind:show title={editConnection ? 'Edit connection' : 'New connection'} width="560px" {onclose}>
  <div class="cd-root">
    <!-- Tabs -->
    <div class="cd-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="cd-tab"
        class:active={tab === 'general'}
        aria-selected={tab === 'general'}
        onclick={() => (tab = 'general')}
      >
        General
      </button>
      <button
        type="button"
        role="tab"
        class="cd-tab"
        class:active={tab === 'advanced'}
        aria-selected={tab === 'advanced'}
        onclick={() => (tab = 'advanced')}
      >
        Advanced
        {#if advancedHasState}<span class="cd-tab-dot" aria-hidden="true"></span>{/if}
      </button>
    </div>

    {#if tab === 'general'}
      <!-- Connection name -->
      <div class="cd-block">
        <span class="cd-label">Connection name</span>
        <input class="cd-input" type="text" bind:value={name} placeholder="My database" />
      </div>

      <!-- Driver grid -->
      <div class="cd-block">
        <span class="cd-label">Driver</span>
        <div class="cd-driver-grid">
          {#each SQL_DIALECTS as d (d.key)}
            {@const active = driver === d.key}
            {@const color = DRIVER_COLORS[d.key] ?? 'var(--t2)'}
            <button
              type="button"
              class="cd-driver"
              class:active
              onclick={() => pickDriver(d.key)}
              title={d.displayName}
            >
              <span class="cd-driver-glyph" style:color={active ? color : 'var(--t2)'}>
                {#if d.key === 'postgresql'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M12 2.5c-3.9 0-7 2.3-7 6 0 2.6.7 5.8 1.7 8.4.7 1.8 1.6 3.1 2.6 3.1.7 0 1-.6 1-1.6 0-.7-.2-1.6-.2-2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <path d="M12 2.5c3.9 0 7 2.3 7 6 0 2.6-.7 5.8-1.7 8.4-.5 1.3-1.1 2.2-1.8 2.2-.9 0-1.2-1.1-1-2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <circle cx="9.6" cy="9" r="1" fill="currentColor" />
                    <circle cx="14.4" cy="9" r="1" fill="currentColor" />
                  </svg>
                {:else if d.key === 'mysql'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M3 16c2.5 0 4-1.3 5.5-3.3C10 10.4 11 8 13.5 8c2 0 2.5 1.4 2.5 3v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    <circle cx="18.5" cy="6.5" r="2.5" stroke="currentColor" stroke-width="1.5" />
                    <path d="M20 8.5l1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                {:else if d.key === 'sqlite'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M5 4h9l5 5v11a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                    <path d="M14 4v5h5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                    <path d="M8 14h8M8 17h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                {:else if d.key === 'clickhouse'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <rect x="4" y="5" width="2.5" height="14" rx="0.5" fill="currentColor" />
                    <rect x="8.5" y="5" width="2.5" height="14" rx="0.5" fill="currentColor" />
                    <rect x="13" y="5" width="2.5" height="14" rx="0.5" fill="currentColor" />
                    <rect x="17.5" y="10" width="2.5" height="3" rx="0.5" fill="currentColor" />
                  </svg>
                {:else if d.key === 'd1'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M16.5 18H7a4 4 0 01-.5-7.97A5 5 0 0116 9.2a3.5 3.5 0 01.5 8.8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                  </svg>
                {:else}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                {/if}
              </span>
              <span class="cd-driver-name">{d.displayName}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Dynamic fields -->
      {#if isD1}
        <div class="cd-block">
          <span class="cd-label">Account ID</span>
          <input class="cd-input mono" type="text" bind:value={host} placeholder="33-char Cloudflare account ID" />
        </div>
        <div class="cd-block">
          <span class="cd-label">Database ID</span>
          <input class="cd-input mono" type="text" bind:value={database} placeholder="UUID from your D1 dashboard" />
        </div>
        <div class="cd-block">
          <span class="cd-label">API token</span>
          <input class="cd-input" type="password" bind:value={password} placeholder="Token with D1:Edit permission" />
          <span class="cd-caption">
            Create one at dash.cloudflare.com/profile/api-tokens — needs the <code>D1:Edit</code> permission scoped to your account.
          </span>
        </div>
      {:else if isFileDriver}
        <div class="cd-block">
          <span class="cd-label">Database file</span>
          <div class="cd-file-row">
            <input class="cd-input mono" type="text" bind:value={database} placeholder="/path/to/db.sqlite" />
            <button type="button" class="cd-file-btn" onclick={browseForSqliteFile} title="Browse for a SQLite file" aria-label="Browse">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                <path d="M4 7a2 2 0 012-2h3l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="1.6" />
              </svg>
            </button>
          </div>
        </div>
      {:else}
        <div class="cd-row">
          <div class="cd-block grow">
            <span class="cd-label">Host</span>
            <input class="cd-input mono" type="text" bind:value={host} placeholder="localhost" />
          </div>
          <div class="cd-block narrow">
            <span class="cd-label">Port</span>
            <input class="cd-input mono" type="number" bind:value={port} />
          </div>
        </div>
        <div class="cd-block">
          <span class="cd-label">Database</span>
          <input class="cd-input mono" type="text" bind:value={database} placeholder="mydb" />
        </div>
        <div class="cd-row">
          <div class="cd-block grow">
            <span class="cd-label">Username</span>
            <input class="cd-input mono" type="text" bind:value={username} placeholder="user" />
          </div>
          <div class="cd-block grow">
            <span class="cd-label">Password</span>
            <input class="cd-input" type="password" bind:value={password} placeholder="••••••••" />
          </div>
        </div>
      {/if}

      {#if advancedHasState}
        <div class="cd-pill-row">
          {#if ssl}
            <span class="cd-pill">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6" />
                <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" />
              </svg>
              SSL enabled
            </span>
          {/if}
          {#if useSshTunnel}
            <span class="cd-pill">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
                <path d="M7 10l3 2-3 2M12 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              SSH · {selectedProfile?.name ?? '—'}
            </span>
          {/if}
        </div>
      {/if}
    {:else}
      <!-- Advanced tab -->
      <div class="cd-cards">
        <!-- SSL card -->
        <div class="cd-card">
          <div class="cd-card-row">
            <div class="cd-card-meta" class:disabled={!supportsSslSsh}>
              <div class="cd-card-icon">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </div>
              <div class="cd-card-text">
                <div class="cd-card-title">Use SSL / TLS</div>
                <div class="cd-card-sub">
                  {supportsSslSsh ? 'Encrypt traffic between client and server' : 'Not applicable for this driver'}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Use SSL"
              aria-checked={ssl && supportsSslSsh}
              class="cd-toggle"
              class:on={ssl && supportsSslSsh}
              disabled={!supportsSslSsh}
              onclick={() => { if (supportsSslSsh) ssl = !ssl; }}
            >
              <span class="cd-toggle-thumb"></span>
            </button>
          </div>
        </div>

        <!-- SSH card -->
        <div class="cd-card" class:accent={useSshTunnel && supportsSslSsh}>
          <div class="cd-card-row">
            <div class="cd-card-meta" class:disabled={!supportsSslSsh}>
              <div class="cd-card-icon">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <path d="M7 10l3 2-3 2M12 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="cd-card-text">
                <div class="cd-card-title">Connect via SSH tunnel</div>
                <div class="cd-card-sub">
                  {supportsSslSsh ? 'Route the connection through a bastion host' : 'Not applicable for this driver'}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Use SSH tunnel"
              aria-checked={useSshTunnel && supportsSslSsh}
              class="cd-toggle"
              class:on={useSshTunnel && supportsSslSsh}
              disabled={!supportsSslSsh}
              onclick={() => { if (supportsSslSsh) useSshTunnel = !useSshTunnel; }}
            >
              <span class="cd-toggle-thumb"></span>
            </button>
          </div>

          {#if useSshTunnel && supportsSslSsh}
            <div class="cd-card-expand">
              {#if $sshProfiles.length === 0}
                <p class="cd-empty">No SSH profiles yet.</p>
                <button class="cd-new-ssh" type="button" onclick={() => (showNewSshModal = true)}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  </svg>
                  Create new SSH profile
                </button>
              {:else}
                <div class="cd-block">
                  <span class="cd-label">SSH profile</span>
                  <div class="cd-select-wrap">
                    <select class="cd-input mono cd-select" bind:value={selectedSshProfileId}>
                      {#each $sshProfiles as p (p.id)}
                        <option value={p.id}>{p.name}</option>
                      {/each}
                    </select>
                    <svg class="cd-select-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </div>
                  {#if selectedProfile}
                    <span class="cd-caption">{selectedProfile.username}@{selectedProfile.host}:{selectedProfile.port}</span>
                  {/if}
                </div>
                <button class="cd-new-ssh" type="button" onclick={() => (showNewSshModal = true)}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                  </svg>
                  Create new SSH profile
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Footer -->
    <div class="cd-footer">
      <button
        type="button"
        class="cd-btn cd-test"
        class:ok={testOk}
        onclick={handleTest}
        disabled={testing}
      >
        <span class="cd-test-icon" aria-hidden="true">
          {#if testing}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" class="cd-spin">
              <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-opacity="0.25" />
              <path d="M12 4a8 8 0 018 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          {:else if testOk}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
              <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            </svg>
          {/if}
        </span>
        <span class="cd-test-label">
          {testing ? (testStatus || 'Testing…') : (testOk ? 'Connected' : 'Test connection')}
        </span>
      </button>
      <div class="cd-spacer"></div>
      <button type="button" class="cd-btn outline" onclick={() => show = false}>Cancel</button>
      <button type="button" class="cd-btn primary" onclick={handleSave}>Save connection</button>
    </div>
  </div>
</Modal>

<NewSshProfileModal bind:show={showNewSshModal} onCreated={handleNewSshCreated} />

<style>
  .cd-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
    /* Body padding lives on the Modal primitive (20px 24px). Pull bottom
       in so the footer's own padding doesn't double up. */
    margin: -4px 0 -4px;
  }

  /* Tabs ------------------------------------------------------------- */
  .cd-tabs {
    display: flex;
    gap: 4px;
    margin: -4px -4px 4px;
    border-bottom: 1px solid var(--b1);
  }
  .cd-tab {
    position: relative;
    background: transparent;
    border: none;
    padding: 10px 16px;
    font-family: var(--ui);
    font-size: 13px;
    color: var(--t3);
    cursor: default;
    transition: color 0.12s;
    border-radius: 0;
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .cd-tab:hover { color: var(--t1); }
  .cd-tab.active {
    color: var(--t1);
    font-weight: 600;
  }
  .cd-tab.active::after {
    content: '';
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: -1px;
    height: 2px;
    background: var(--acc);
    border-radius: 2px 2px 0 0;
  }
  .cd-tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 99px;
    background: var(--acc);
  }

  /* Labels + inputs -------------------------------------------------- */
  .cd-block {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .cd-block.grow { flex: 1 1 0; }
  .cd-block.narrow { flex: 0 0 120px; }
  .cd-row {
    display: flex;
    gap: 12px;
  }
  .cd-label {
    font-family: var(--mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--t3);
  }
  .cd-input {
    width: 100%;
    box-sizing: border-box;
    background: var(--e);
    border: 1px solid var(--b1);
    border-radius: 9px;
    padding: 10px 13px;
    color: var(--t1);
    font-size: 13.5px;
    font-family: var(--ui);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .cd-input.mono { font-family: var(--mono); }
  .cd-input::placeholder { color: var(--t3); }
  .cd-input:focus {
    border-color: var(--acc);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--acc) 18%, transparent);
  }
  .cd-caption {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--t3);
    line-height: 1.5;
  }
  .cd-caption code {
    font-family: var(--mono);
    color: var(--t2);
    padding: 0 4px;
    border-radius: 4px;
    background: var(--e);
  }

  /* Driver grid ------------------------------------------------------ */
  .cd-driver-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .cd-driver {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    padding: 13px 4px 10px;
    background: var(--e);
    border: 1px solid var(--b1);
    border-radius: 11px;
    cursor: default;
    transition: border-color 0.15s, background 0.15s, transform 0.15s;
  }
  .cd-driver:hover {
    border-color: var(--b2);
    transform: translateY(-1px);
  }
  .cd-driver.active {
    background: color-mix(in srgb, var(--acc) 12%, transparent);
    border-color: var(--acc);
  }
  .cd-driver-glyph {
    line-height: 0;
    opacity: 0.85;
    transition: opacity 0.15s;
  }
  .cd-driver:hover .cd-driver-glyph,
  .cd-driver.active .cd-driver-glyph { opacity: 1; }
  .cd-driver-name {
    font-family: var(--ui);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--t2);
    text-align: center;
    line-height: 1.2;
  }
  .cd-driver.active .cd-driver-name { color: var(--t1); }

  /* File row --------------------------------------------------------- */
  .cd-file-row {
    display: flex;
    gap: 8px;
  }
  .cd-file-row .cd-input { flex: 1; min-width: 0; }
  .cd-file-btn {
    width: 36px;
    height: auto;
    background: var(--c);
    border: 1px solid var(--b1);
    border-radius: 9px;
    color: var(--t2);
    display: grid;
    place-items: center;
    cursor: default;
    transition: color 0.15s, border-color 0.15s;
  }
  .cd-file-btn:hover {
    color: var(--t1);
    border-color: var(--b2);
  }

  /* Active-state pills ---------------------------------------------- */
  .cd-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cd-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: color-mix(in srgb, var(--acc) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--acc) 28%, transparent);
    border-radius: 99px;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 500;
    color: var(--acc);
  }

  /* Advanced cards --------------------------------------------------- */
  .cd-cards {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .cd-card {
    background: var(--e);
    border: 1px solid var(--b1);
    border-radius: 13px;
    padding: 14px 16px;
    transition: border-color 0.2s;
  }
  .cd-card.accent {
    border-color: color-mix(in srgb, var(--acc) 35%, transparent);
  }
  .cd-card-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .cd-card-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .cd-card-meta.disabled { opacity: 0.45; }
  .cd-card-icon {
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: 9px;
    background: var(--c);
    border: 1px solid var(--b1);
    display: grid;
    place-items: center;
    color: var(--t2);
  }
  .cd-card-text { min-width: 0; }
  .cd-card-title {
    font-family: var(--ui);
    font-size: 13.5px;
    font-weight: 500;
    color: var(--t1);
  }
  .cd-card-sub {
    font-family: var(--ui);
    font-size: 12px;
    color: var(--t3);
    margin-top: 2px;
  }
  .cd-card-expand {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--b1);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cd-select-wrap { position: relative; }
  .cd-select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    padding-right: 36px;
    cursor: default;
  }
  .cd-select-chev {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--t3);
  }
  .cd-empty {
    margin: 0;
    font-family: var(--ui);
    font-size: 12px;
    color: var(--t3);
  }
  .cd-new-ssh {
    align-self: stretch;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 10px;
    background: transparent;
    border: 1px dashed var(--b2);
    border-radius: 9px;
    color: var(--t2);
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 500;
    cursor: default;
    transition: color 0.15s, border-color 0.15s;
  }
  .cd-new-ssh:hover {
    color: var(--t1);
    border-color: var(--acc);
  }

  /* Toggle ----------------------------------------------------------- */
  .cd-toggle {
    width: 40px;
    height: 23px;
    border-radius: 99px;
    border: none;
    cursor: default;
    padding: 2px;
    background: color-mix(in srgb, var(--t1) 18%, transparent);
    transition: background 0.18s;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .cd-toggle.on { background: var(--acc); }
  .cd-toggle:disabled { opacity: 0.45; }
  .cd-toggle-thumb {
    display: block;
    width: 19px;
    height: 19px;
    border-radius: 99px;
    background: #fff;
    transform: translateX(0);
    transition: transform 0.18s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .cd-toggle.on .cd-toggle-thumb { transform: translateX(17px); }

  /* Footer ----------------------------------------------------------- */
  .cd-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 14px;
    margin-top: 4px;
    border-top: 1px solid var(--b1);
  }
  .cd-spacer { flex: 1; }
  .cd-btn {
    height: 36px;
    padding: 0 18px;
    border-radius: 10px;
    font-family: var(--ui);
    font-size: 12.5px;
    font-weight: 500;
    cursor: default;
    transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .cd-test {
    background: transparent;
    border: 1px solid var(--b2);
    color: var(--t1);
    min-width: 168px;
    justify-content: center;
  }
  .cd-test:hover:not(:disabled) { border-color: var(--acc); }
  .cd-test:disabled { opacity: 0.7; }
  .cd-test.ok { color: #5FD08C; border-color: color-mix(in srgb, #5FD08C 60%, transparent); }
  .cd-test-icon { display: grid; place-items: center; }
  .cd-spin { animation: cd-spin 0.7s linear infinite; }
  @keyframes cd-spin { to { transform: rotate(360deg); } }
  .cd-btn.outline {
    background: transparent;
    border: 1px solid var(--b1);
    color: var(--t2);
  }
  .cd-btn.outline:hover { border-color: var(--b2); color: var(--t1); }
  .cd-btn.primary {
    background: var(--acc);
    border: 1px solid var(--acc);
    color: #fff;
    font-weight: 600;
    padding: 0 22px;
    box-shadow: 0 6px 18px -8px color-mix(in srgb, var(--acc) 80%, transparent);
  }
  .cd-btn.primary:hover { opacity: 0.92; }

  /* Tighter packing for the 5-tile driver grid on narrow viewports. */
  @media (max-width: 520px) {
    .cd-driver-grid { grid-template-columns: repeat(3, 1fr); }
    .cd-row { flex-direction: column; }
    .cd-block.narrow { flex: 1 1 auto; }
  }
</style>
