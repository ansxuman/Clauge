<script lang="ts">
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { sshUpdateProfile } from '../commands';
  import { loadSshProfiles, sshProfiles } from '../stores';
  import { showToast } from '$lib/shared/primitives/toast';
  import type { SshAuthType, SshProfile } from '../types';
  import { SSH_EVENT } from '$lib/shared/constants/events';

  let { show = $bindable(false), profile = $bindable<SshProfile | null>(null) } = $props();

  let name = $state('');
  let host = $state('');
  let port = $state(22);
  let username = $state('');
  let authType = $state<SshAuthType>('key');
  let keyPath = $state('');
  let passphrase = $state('');
  let password = $state('');
  let revealSecret = $state(false);
  let loading = $state(false);

  type ConnectionMode = 'direct' | 'jump' | 'command';
  let connectionMode = $state<ConnectionMode>('direct');
  let jumpProfileId = $state<string>('');
  let proxyCommand = $state('');

  $effect(() => {
    if (profile && show) {
      name = profile.name;
      host = profile.host;
      port = profile.port;
      username = profile.username;
      // Migrate legacy 'interactive' auth_type → 'password' on display.
      // Backend treats them equivalently now (password auto-falls-back to
      // interactive prompts on rejection); the explicit 'interactive' chip
      // was removed from the UI. Saving will persist the new value.
      authType = profile.authType === 'interactive' ? 'password' : profile.authType;
      keyPath = profile.keyPath ?? '';
      passphrase = '';
      password = '';
      revealSecret = false;
      // Initialize connection mode from existing profile fields. ProxyCommand
      // wins over jumpProfileId if both are populated, matching the connect
      // path's precedence so the user sees what's actually being used.
      if (profile.proxyCommand) {
        connectionMode = 'command';
        proxyCommand = profile.proxyCommand;
        jumpProfileId = profile.jumpProfileId ?? '';
      } else if (profile.jumpProfileId) {
        connectionMode = 'jump';
        jumpProfileId = profile.jumpProfileId;
        proxyCommand = '';
      } else {
        connectionMode = 'direct';
        jumpProfileId = '';
        proxyCommand = '';
      }
    }
  });

  async function pickKeyFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        title: 'Select SSH Private Key',
        filters: [
          { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (typeof selected === 'string') {
        keyPath = selected;
      }
    } catch {
      /* ignore */
    }
  }

  async function handleSave() {
    if (!profile) return;
    if (!name.trim() || !host.trim() || !username.trim()) return;
    if (authType === 'key' && !keyPath.trim()) return;

    loading = true;
    try {
      const updated = await sshUpdateProfile({
        id: profile.id,
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        keyPath: authType === 'key' ? keyPath.trim() : null,
        accentColor: profile.accentColor,
        // Only send `secret` if the user typed something — empty strings keep existing.
        secret: authType === 'password' && password ? password : undefined,
        passphrase: authType === 'key' && passphrase ? passphrase : undefined,
        // Connection routing — empty string clears the column, present value sets it.
        // The Rust update path treats "" as a clear sentinel for both fields.
        jumpProfileId:
          connectionMode === 'jump' && jumpProfileId ? jumpProfileId : '',
        proxyCommand:
          connectionMode === 'command' && proxyCommand.trim() ? proxyCommand.trim() : '',
      });
      await loadSshProfiles();
      window.dispatchEvent(new CustomEvent(SSH_EVENT.PROFILE_UPDATED, { detail: updated }));
      show = false;
      showToast('SSH profile updated', 'success');
    } catch (e: any) {
      showToast(String(e), 'error');
    } finally {
      loading = false;
    }
  }

  let canSave = $derived(
    name.trim() !== '' &&
      host.trim() !== '' &&
      username.trim() !== '' &&
      (authType !== 'key' || keyPath.trim() !== '')
  );
</script>

<Modal bind:show title="Edit SSH Connection" width="460px">
  {#if profile}
    <div class="ns-form">
      <label class="ns-field">
        <span class="ns-label">Name</span>
        <input class="ns-input" type="text" bind:value={name} />
      </label>

      <div class="ns-row">
        <label class="ns-field" style="flex:3">
          <span class="ns-label">Host</span>
          <input class="ns-input" type="text" bind:value={host} />
        </label>
        <label class="ns-field" style="flex:1">
          <span class="ns-label">Port</span>
          <input class="ns-input" type="number" min="1" max="65535" bind:value={port} />
        </label>
      </div>

      <label class="ns-field">
        <span class="ns-label">Username</span>
        <input class="ns-input" type="text" bind:value={username} />
      </label>

      <div class="ns-field">
        <span class="ns-label">Authentication</span>
        <div class="ns-radio-row">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={authType === 'key'} onclick={() => (authType = 'key')}>SSH Key</span>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={authType === 'password'} onclick={() => (authType = 'password')}>Password</span>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={authType === 'agent'} onclick={() => (authType = 'agent')}>SSH Agent</span>
        </div>
      </div>

      {#if authType === 'agent'}
        <div class="ns-field">
          <span class="ns-optional">
            Uses keys loaded into the running ssh-agent. Required for hardware tokens (YubiKey, smartcard).
            Run <code>ssh-add</code> to load keys first.
          </span>
        </div>
      {:else if authType === 'key'}
        <label class="ns-field">
          <span class="ns-label">Private Key File</span>
          <div class="ns-path-row">
            <input class="ns-input ns-path-input" type="text" bind:value={keyPath} />
            <button class="ns-btn-browse" type="button" onclick={pickKeyFile}>Choose…</button>
          </div>
        </label>
        <label class="ns-field">
          <span class="ns-label">Passphrase</span>
          <div class="ns-path-row">
            <input
              class="ns-input ns-path-input"
              type={revealSecret ? 'text' : 'password'}
              bind:value={passphrase}
              placeholder="Leave blank to keep existing"
              autocomplete="off"
            />
            <button class="ns-btn-browse" type="button" onclick={() => (revealSecret = !revealSecret)}>
              {revealSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
      {:else}
        <label class="ns-field">
          <span class="ns-label">Password <span class="ns-optional">(optional)</span></span>
          <div class="ns-path-row">
            <input
              class="ns-input ns-path-input"
              type={revealSecret ? 'text' : 'password'}
              bind:value={password}
              placeholder="Leave blank to keep existing or enter at connect time"
              autocomplete="off"
            />
            <button class="ns-btn-browse" type="button" onclick={() => (revealSecret = !revealSecret)}>
              {revealSecret ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <span class="ns-optional">
          If your server uses multi-step auth (password + OTP), you'll be prompted for the additional
          steps each time you connect.
        </span>
      {/if}

      <div class="ns-field">
        <span class="ns-label">Connection</span>
        <div class="ns-radio-row">
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={connectionMode === 'direct'} onclick={() => (connectionMode = 'direct')}>Direct</span>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={connectionMode === 'jump'} onclick={() => (connectionMode = 'jump')}>Through SSH jump host</span>
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <span class="ns-chip" class:selected={connectionMode === 'command'} onclick={() => (connectionMode = 'command')}>Through proxy command</span>
        </div>
      </div>

      {#if connectionMode === 'jump'}
        <label class="ns-field">
          <span class="ns-label">Jump Host</span>
          <select class="ns-input" bind:value={jumpProfileId}>
            <option value="">— Select a profile —</option>
            {#each $sshProfiles.filter((p) => p.id !== profile.id) as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
          <span class="ns-optional">
            The SSH session connects to this profile first, then opens a tunneled channel to the destination.
            For multi-hop chains, set the jump profile's own jump host.
          </span>
        </label>
      {:else if connectionMode === 'command'}
        <label class="ns-field">
          <span class="ns-label">Proxy Command</span>
          <input
            class="ns-input"
            type="text"
            bind:value={proxyCommand}
            placeholder="cloudflared access ssh --hostname %h"
            autocomplete="off"
            spellcheck="false"
          />
          <span class="ns-optional">
            Spawned as a subprocess that proxies SSH bytes via stdin/stdout. Supports <code>%h</code> (host),
            <code>%p</code> (port), <code>%r</code> (username) placeholders. Tokenized as argv — does NOT
            run through a shell.
          </span>
        </label>
      {/if}

      <div class="ns-actions">
        <button class="ns-btn-cancel" onclick={() => (show = false)}>Cancel</button>
        <button class="ns-btn-create" onclick={handleSave} disabled={!canSave || loading}>
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .ns-form { display: flex; flex-direction: column; gap: 12px; }
  .ns-field { display: flex; flex-direction: column; gap: 4px; }
  .ns-label { font-size: 12px; font-weight: 600; color: var(--t2); text-transform: uppercase; font-family: var(--ui); }
  .ns-input {
    width: 100%; background: var(--e); border: 1px solid var(--b1); border-radius: 6px;
    padding: 8px 10px; font-size: 13px; color: var(--t1); outline: none; box-sizing: border-box;
    font-family: var(--mono); transition: border-color 0.15s;
  }
  .ns-input:focus { border-color: var(--ssh, var(--acc)); }
  .ns-input::placeholder { color: var(--t3); }
  select.ns-input {
    padding-right: 28px;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23b0b0c8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 5 6 8 9 5'/></svg>");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 10px 10px;
  }
  .ns-row { display: flex; gap: 8px; }
  .ns-path-row { display: flex; gap: 8px; }
  .ns-path-input { flex: 1; }
  .ns-btn-browse {
    background: var(--n); border: 1px solid var(--b1); border-radius: 6px;
    padding: 8px 12px; color: var(--t1); font-size: 12px; cursor: pointer;
    white-space: nowrap; font-family: var(--ui); transition: border-color 0.15s;
  }
  .ns-btn-browse:hover { border-color: var(--b2); }
  .ns-radio-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .ns-chip {
    padding: 5px 12px; border-radius: 14px; border: 1px solid var(--b1);
    background: transparent; color: var(--t2); font-size: 12px; cursor: pointer;
    font-family: var(--ui); transition: background 0.15s, color 0.15s; user-select: none;
  }
  .ns-chip:hover:not(.selected) { background: var(--surface-hover); }
  .ns-chip.selected {
    font-weight: 600;
    color: var(--ssh, var(--acc));
    border-color: var(--ssh, var(--acc));
    background: color-mix(in srgb, var(--ssh, var(--acc)) 15%, transparent);
  }
  .ns-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--b1); }
  .ns-btn-cancel {
    padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: 1px solid var(--b1); background: transparent; color: var(--t2); font-family: var(--ui);
  }
  .ns-btn-cancel:hover { background: var(--surface-hover); }
  .ns-btn-create {
    padding: 7px 16px; border-radius: 6px; font-size: 13px; cursor: pointer;
    border: none; background: var(--ssh, var(--acc)); color: #fff; font-weight: 600; font-family: var(--ui);
  }
  .ns-btn-create:hover:not(:disabled) { filter: brightness(1.1); }
  .ns-btn-create:disabled { opacity: 0.4; cursor: not-allowed; }
  .ns-optional {
    font-size: 11px; color: var(--t3); font-family: var(--ui); margin-top: 2px;
  }
  .ns-optional code {
    font-family: var(--mono); font-size: 11px; padding: 1px 4px;
    background: var(--surface-hover); border-radius: 3px;
  }
</style>
