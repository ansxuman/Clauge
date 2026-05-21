<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { showToast } from '$lib/shared/primitives/toast';
  import { friendlyError } from '$lib/utils/errors';
  import { nosqlTestConnection } from '../commands';
  import type { NoSqlConnection, NoSqlConnectionConfig } from '../types';
  import { sshProfiles, loadSshProfiles } from '$lib/modes/ssh/stores';
  import type { SshProfile } from '$lib/modes/ssh/types';
  import NewSshProfileModal from '$lib/modes/ssh/components/NewSshProfileModal.svelte';

  interface Props {
    show: boolean;
    connection?: NoSqlConnection | null;
    onsave?: (config: NoSqlConnectionConfig) => void | Promise<void>;
    onclose?: () => void;
  }

  let { show = $bindable(false), connection = null, onsave, onclose }: Props = $props();

  type NoSqlDriver = 'mongodb' | 'redis';
  type InputMode = 'string' | 'fields';
  type Tab = 'general' | 'advanced';

  let name = $state('');
  let driver = $state<NoSqlDriver>('mongodb');
  let connectionString = $state('');
  let host = $state('');
  let port = $state(27017);
  let database = $state('');
  let username = $state('');
  let password = $state('');
  let ssl = $state(false);
  let directConnection = $state(false);
  let useConnectionString = $state(true);
  let testing = $state(false);
  let saving = $state(false);
  let testStatus = $state('');
  let testOk = $state(false);
  let tab = $state<Tab>('general');

  // SSH tunnel section state ─────────────────────────────────────────────
  let useSshTunnel = $state(false);
  let selectedSshProfileId = $state<string | null>(null);
  let showNewSshModal = $state(false);

  $effect(() => {
    if (show && connection) {
      name = connection.name;
      driver = connection.driver;
      connectionString = connection.connectionString;
      host = connection.host;
      port = connection.port;
      database = connection.databaseName ?? '';
      username = connection.username ?? '';
      password = connection.password ?? '';
      ssl = !!connection.ssl;
      directConnection = !!connection.directConnection;
      useConnectionString = !!connection.connectionString;
      const sid = connection.sshProfileId ?? null;
      useSshTunnel = !!sid;
      selectedSshProfileId = sid;
      tab = 'general';
      testOk = false;
    } else if (show && !connection) {
      name = '';
      driver = 'mongodb';
      connectionString = '';
      host = '';
      port = 27017;
      database = '';
      username = '';
      password = '';
      ssl = false;
      directConnection = false;
      useConnectionString = true;
      useSshTunnel = false;
      selectedSshProfileId = null;
      tab = 'general';
      testOk = false;
    }
  });

  // Auto-swap port to the new driver's default when the user flips
  // drivers — but ONLY if the current port matches the OTHER driver's
  // default (otherwise the user typed a custom port and we'd clobber it).
  $effect(() => {
    if (driver === 'redis' && port === 27017) {
      port = 6379;
    } else if (driver === 'mongodb' && port === 6379) {
      port = 27017;
    }
  });

  // Populate SSH profiles store on first dialog open.
  $effect(() => {
    if (show && $sshProfiles.length === 0) {
      loadSshProfiles();
    }
  });

  // Default-select first profile when toggle flips on without a prior choice.
  $effect(() => {
    if (useSshTunnel && !selectedSshProfileId && $sshProfiles.length > 0) {
      selectedSshProfileId = $sshProfiles[0].id;
    }
  });

  const selectedProfile = $derived(
    selectedSshProfileId ? $sshProfiles.find((p) => p.id === selectedSshProfileId) ?? null : null
  );

  function handleNewSshCreated(profile: SshProfile) {
    selectedSshProfileId = profile.id;
    useSshTunnel = true;
  }

  function buildConfig(): NoSqlConnectionConfig {
    return {
      name: name.trim() || `${driver} connection`,
      driver,
      connectionString: useConnectionString ? connectionString.trim() : '',
      host: useConnectionString ? '' : host.trim(),
      port: useConnectionString ? 0 : port,
      database: database.trim() || undefined,
      username: username.trim() || undefined,
      password: password.trim() || undefined,
      ssl,
      directConnection: driver === 'mongodb' ? directConnection : undefined,
      sshProfileId: useSshTunnel && selectedSshProfileId ? selectedSshProfileId : null,
    };
  }

  /** Best-effort host:port extraction from a `mongodb://` or `redis://` URL.
   *  Returns `null` if the URL has no usable authority (e.g. mongodb+srv,
   *  malformed strings) — caller should skip the pre-flight in that case. */
  function targetFromUri(uri: string): { host: string; port: number } | null {
    try {
      // mongodb+srv resolves via DNS — no single host/port to tunnel to.
      if (uri.startsWith('mongodb+srv://')) return null;
      const u = new URL(uri);
      if (!u.hostname) return null;
      const defaultPort = driver === 'redis' ? 6379 : 27017;
      const p = u.port ? Number(u.port) : defaultPort;
      return { host: u.hostname, port: p };
    } catch {
      return null;
    }
  }

  async function handleTest() {
    testing = true;
    testStatus = '';
    testOk = false;
    try {
      if (useSshTunnel && selectedSshProfileId) {
        const target = useConnectionString
          ? targetFromUri(connectionString.trim())
          : { host: host.trim(), port };
        if (target) {
          testStatus = 'Testing tunnel…';
          try {
            await invoke('ssh_tunnel_test', {
              profileId: selectedSshProfileId,
              targetHost: target.host,
              targetPort: target.port,
            });
          } catch (e: any) {
            if (!show) return;
            showToast(`Tunnel test failed: ${friendlyError(e)}`, 'error');
            return;
          }
          if (!show) return;
          testStatus = 'Testing database…';
        }
      }
      const msg = await nosqlTestConnection(buildConfig());
      if (!show) return;
      showToast(msg || 'Connection successful', 'success');
      testOk = true;
      setTimeout(() => { testOk = false; }, 2200);
    } catch (e: any) {
      if (!show) return;
      showToast(friendlyError(e), 'error');
    } finally {
      testing = false;
      testStatus = '';
    }
  }

  async function handleSave() {
    const config = buildConfig();
    if (!config.name) {
      showToast('Name is required', 'error');
      return;
    }
    if (useConnectionString && !config.connectionString) {
      showToast('Connection string is required', 'error');
      return;
    }
    if (!useConnectionString && !config.host) {
      showToast('Host is required', 'error');
      return;
    }
    if (useSshTunnel && !selectedSshProfileId) {
      showToast('Pick an SSH profile or turn off the tunnel', 'error');
      return;
    }
    saving = true;
    try {
      await onsave?.(config);
    } catch (e: any) {
      showToast(friendlyError(e), 'error');
    } finally {
      saving = false;
    }
  }

  // Per-driver brand color for the icon grid; active border still uses
  // var(--acc) so the chrome stays theme-consistent.
  const DRIVER_COLORS: Record<NoSqlDriver, string> = {
    mongodb: '#5BB04A',
    redis:   '#D82C20',
  };

  const driverLabel = $derived(driver === 'mongodb' ? 'MongoDB' : 'Redis');
  const advancedHasState = $derived(
    ssl || (driver === 'mongodb' && directConnection) || useSshTunnel
  );
</script>

<Modal bind:show title={connection ? 'Edit connection' : 'New connection'} width="560px" {onclose}>
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
        <input
          class="cd-input"
          type="text"
          bind:value={name}
          placeholder="My connection"
          autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
        />
      </div>

      <!-- Driver grid -->
      <div class="cd-block">
        <span class="cd-label">Driver</span>
        <div class="cd-driver-grid">
          {#each [{ key: 'mongodb', label: 'MongoDB' }, { key: 'redis', label: 'Redis' }] as d (d.key)}
            {@const active = driver === d.key}
            {@const color = DRIVER_COLORS[d.key as NoSqlDriver]}
            <button
              type="button"
              class="cd-driver"
              class:active
              onclick={() => (driver = d.key as NoSqlDriver)}
              title={d.label}
            >
              <span class="cd-driver-glyph" style:color={active ? color : 'var(--t2)'}>
                {#if d.key === 'mongodb'}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M12 2c0 2-3 4-3 8s3 6 3 10c0-4 3-6 3-10s-3-6-3-8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M12 4v18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                {:else}
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                    <path d="M3 7l9-4 9 4-9 4-9-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                    <path d="M3 12l9 4 9-4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                    <path d="M3 17l9 4 9-4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                  </svg>
                {/if}
              </span>
              <span class="cd-driver-name">{d.label}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Input mode segmented toggle -->
      <div class="cd-block">
        <span class="cd-label">Input mode</span>
        <div class="cd-segment">
          <button
            type="button"
            class="cd-seg-btn"
            class:active={useConnectionString}
            onclick={() => (useConnectionString = true)}
          >Connection string</button>
          <button
            type="button"
            class="cd-seg-btn"
            class:active={!useConnectionString}
            onclick={() => (useConnectionString = false)}
          >Host / port</button>
        </div>
      </div>

      {#if useConnectionString}
        <div class="cd-block">
          <span class="cd-label">Connection string</span>
          <input
            class="cd-input mono"
            type="text"
            bind:value={connectionString}
            placeholder={driver === 'mongodb' ? 'mongodb://localhost:27017' : 'redis://localhost:6379'}
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
          />
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

        {#if driver === 'mongodb'}
          <div class="cd-block">
            <span class="cd-label">Database <span class="cd-optional">(optional)</span></span>
            <input class="cd-input mono" type="text" bind:value={database} placeholder="mydb" />
          </div>
          <div class="cd-row">
            <div class="cd-block grow">
              <span class="cd-label">Username <span class="cd-optional">(optional)</span></span>
              <input class="cd-input mono" type="text" bind:value={username} placeholder="user" />
            </div>
            <div class="cd-block grow">
              <span class="cd-label">Password <span class="cd-optional">(optional)</span></span>
              <input class="cd-input" type="password" bind:value={password} placeholder="••••••••" />
            </div>
          </div>
        {:else}
          <div class="cd-block">
            <span class="cd-label">Password <span class="cd-optional">(optional)</span></span>
            <input class="cd-input" type="password" bind:value={password} placeholder="••••••••" />
          </div>
        {/if}
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
          {#if driver === 'mongodb' && directConnection}
            <span class="cd-pill">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
                <path d="M4 12h14M14 7l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              Direct connection
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
            <div class="cd-card-meta">
              <div class="cd-card-icon">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </div>
              <div class="cd-card-text">
                <div class="cd-card-title">Use SSL / TLS</div>
                <div class="cd-card-sub">Encrypt traffic between client and database</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Use SSL"
              aria-checked={ssl}
              class="cd-toggle"
              class:on={ssl}
              onclick={() => (ssl = !ssl)}
            >
              <span class="cd-toggle-thumb"></span>
            </button>
          </div>
        </div>

        <!-- Direct connection card (MongoDB only) -->
        <div class="cd-card">
          <div class="cd-card-row">
            <div class="cd-card-meta" class:disabled={driver !== 'mongodb'}>
              <div class="cd-card-icon">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <path d="M4 12h14M14 7l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="cd-card-text">
                <div class="cd-card-title">Direct connection</div>
                <div class="cd-card-sub">
                  {driver === 'mongodb'
                    ? 'Skip topology discovery; connect straight to this node'
                    : 'MongoDB only'}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Direct connection"
              aria-checked={directConnection && driver === 'mongodb'}
              class="cd-toggle"
              class:on={directConnection && driver === 'mongodb'}
              disabled={driver !== 'mongodb'}
              onclick={() => { if (driver === 'mongodb') directConnection = !directConnection; }}
            >
              <span class="cd-toggle-thumb"></span>
            </button>
          </div>
        </div>

        <!-- SSH tunnel card -->
        <div class="cd-card" class:accent={useSshTunnel}>
          <div class="cd-card-row">
            <div class="cd-card-meta">
              <div class="cd-card-icon">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <path d="M7 10l3 2-3 2M12 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </div>
              <div class="cd-card-text">
                <div class="cd-card-title">Connect via SSH tunnel</div>
                <div class="cd-card-sub">Route the connection through a bastion host</div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Use SSH tunnel"
              aria-checked={useSshTunnel}
              class="cd-toggle"
              class:on={useSshTunnel}
              onclick={() => (useSshTunnel = !useSshTunnel)}
            >
              <span class="cd-toggle-thumb"></span>
            </button>
          </div>

          {#if useSshTunnel}
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
        disabled={testing || saving}
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
      <button type="button" class="cd-btn outline" onclick={() => (show = false)} disabled={saving}>Cancel</button>
      <button type="button" class="cd-btn primary" onclick={handleSave} disabled={saving || testing}>
        {#if saving}
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" class="cd-spin" aria-hidden="true">
            <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-opacity="0.3" />
            <path d="M12 4a8 8 0 018 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          Saving…
        {:else}
          Save connection
        {/if}
      </button>
    </div>
  </div>
</Modal>

<NewSshProfileModal bind:show={showNewSshModal} onCreated={handleNewSshCreated} />

<style>
  .cd-root {
    display: flex;
    flex-direction: column;
    gap: 18px;
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
  .cd-optional {
    text-transform: none;
    letter-spacing: 0;
    font-weight: normal;
    color: var(--t3);
    font-size: 10.5px;
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

  /* Driver grid ------------------------------------------------------ */
  .cd-driver-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .cd-driver {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 14px;
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
    font-size: 13px;
    font-weight: 500;
    color: var(--t2);
  }
  .cd-driver.active .cd-driver-name { color: var(--t1); }

  /* Segmented input-mode toggle ------------------------------------- */
  .cd-segment {
    display: inline-flex;
    background: var(--e);
    border: 1px solid var(--b1);
    border-radius: 9px;
    padding: 3px;
    gap: 2px;
    align-self: flex-start;
  }
  .cd-seg-btn {
    border: none;
    background: transparent;
    color: var(--t2);
    font-family: var(--ui);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 16px;
    border-radius: 7px;
    cursor: default;
    transition: color 0.15s, background 0.15s;
  }
  .cd-seg-btn:hover { color: var(--t1); }
  .cd-seg-btn.active {
    background: var(--c);
    color: var(--t1);
    box-shadow: 0 1px 0 var(--b2);
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
  .cd-btn.primary:hover:not(:disabled) { opacity: 0.92; }
  .cd-btn.primary:disabled { opacity: 0.45; }

  @media (max-width: 520px) {
    .cd-driver-grid { grid-template-columns: 1fr; }
    .cd-row { flex-direction: column; }
    .cd-block.narrow { flex: 1 1 auto; }
  }
</style>
