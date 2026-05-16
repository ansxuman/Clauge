<script lang="ts">
  /**
   * Auth-prompts modal for keyboard-interactive (PAM) SSH auth.
   *
   * Listens globally for the `ssh:auth-prompts` Tauri event emitted by the
   * connect path in `ssh_session.rs`. Each event carries one round of PAM
   * prompts (name, instructions, list of `{prompt, echo}` items) plus a
   * `requestId` the user-submitted answers must reference.
   *
   * Multiple connects can be in flight simultaneously (in theory). The
   * modal queues incoming events and shows them one at a time so the user
   * always sees a single coherent prompt set.
   *
   * Cancel = closing the modal without submitting. The Rust side's
   * 2-minute oneshot will time out and surface a clear "auth cancelled"
   * error to the SSH session that requested the prompts.
   */
  import Modal from '$lib/shared/primitives/Modal.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { sshSubmitAuthPrompts } from '../commands';
  import type { SshAuthPromptsPayload } from '../types';

  let queue = $state<SshAuthPromptsPayload[]>([]);
  let active = $derived<SshAuthPromptsPayload | null>(queue.length > 0 ? queue[0] : null);
  let answers = $state<string[]>([]);
  let submitting = $state(false);

  // Reset answer buffer whenever a new prompt round arrives.
  $effect(() => {
    if (active) {
      answers = active.prompts.map(() => '');
    }
  });

  let unlisten: UnlistenFn | null = null;

  onMount(async () => {
    unlisten = await listen<SshAuthPromptsPayload>('ssh:auth-prompts', (e) => {
      queue = [...queue, e.payload];
    });
  });

  onDestroy(() => {
    if (unlisten) unlisten();
  });

  async function submit() {
    if (!active || submitting) return;
    submitting = true;
    try {
      await sshSubmitAuthPrompts(active.requestId, answers);
    } catch (e) {
      console.error('ssh auth prompts submit failed:', e);
    } finally {
      submitting = false;
      // Pop the active payload — next round (if any) will replace it via
      // the queue. If user cancelled, queue still gets shifted; the Rust
      // side's timeout handles the missed response.
      queue = queue.slice(1);
    }
  }

  function cancel() {
    // Drop the head of the queue. The parked Rust auth flow will time out
    // (2-minute oneshot) and surface a cancelled-auth error to the user's
    // connect attempt — same outcome as if they had clicked away from a
    // password prompt in any other SSH client.
    queue = queue.slice(1);
    submitting = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === 'Enter' && !submitting) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      cancel();
    }
  }
</script>

{#if active}
  <Modal show={true} title={active.name || 'SSH Authentication Required'} width="420px">
    <div class="ap-form" onkeydown={handleKey} role="dialog" aria-label="SSH authentication prompts">
      {#if active.instructions}
        <p class="ap-instructions">{active.instructions}</p>
      {/if}

      {#each active.prompts as p, i (i)}
        <label class="ap-field">
          <span class="ap-label">{p.prompt.trim()}</span>
          <input
            class="ap-input"
            type={p.echo ? 'text' : 'password'}
            bind:value={answers[i]}
            autocomplete="off"
            spellcheck="false"
          />
        </label>
      {/each}

      <div class="ap-actions">
        <button class="ap-btn-cancel" onclick={cancel} type="button">Cancel</button>
        <button class="ap-btn-submit" onclick={submit} disabled={submitting} type="button">
          {submitting ? 'Authenticating…' : 'Submit'}
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .ap-form { display: flex; flex-direction: column; gap: 12px; }
  .ap-instructions {
    font-size: 12px;
    color: var(--t3);
    font-family: var(--ui);
    margin: 0;
    padding: 8px 10px;
    background: var(--surface-hover);
    border-radius: 6px;
    border-left: 2px solid var(--ssh, var(--acc));
  }
  .ap-field { display: flex; flex-direction: column; gap: 4px; }
  .ap-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--t2);
    font-family: var(--ui);
  }
  .ap-input {
    width: 100%;
    background: var(--e);
    border: 1px solid var(--b1);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--t1);
    outline: none;
    box-sizing: border-box;
    font-family: var(--mono);
    transition: border-color 0.15s;
  }
  .ap-input:focus { border-color: var(--ssh, var(--acc)); }
  .ap-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--b1);
  }
  .ap-btn-cancel {
    padding: 7px 16px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    border: 1px solid var(--b1);
    background: transparent;
    color: var(--t2);
    font-family: var(--ui);
  }
  .ap-btn-cancel:hover { background: var(--surface-hover); }
  .ap-btn-submit {
    padding: 7px 16px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    border: none;
    background: var(--ssh, var(--acc));
    color: #fff;
    font-weight: 600;
    font-family: var(--ui);
  }
  .ap-btn-submit:hover:not(:disabled) { filter: brightness(1.1); }
  .ap-btn-submit:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
