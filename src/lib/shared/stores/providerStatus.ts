import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { AGENT_PROVIDERS, type AgentProvider } from '$lib/shared/agent/providers';

export type ProviderInstallMap = Record<AgentProvider, boolean>;

const EMPTY: ProviderInstallMap = { claude: false, codex: false, gemini: false, opencode: false };

/**
 * Live map of which agent CLIs are installed. Populated once at app boot
 * via `loadProviderStatus()`; both the Agent provider picker and the
 * Workspace coworker picker read from here instead of probing per modal.
 */
export const providerStatus = writable<ProviderInstallMap>({ ...EMPTY });

/** Set once `loadProviderStatus()` has succeeded at least once. */
export const providerStatusReady = writable<boolean>(false);

let loadInflight: Promise<void> | null = null;

/**
 * Fire the batch probe. Called from +layout.svelte on app boot (fire-and-
 * forget — the UI doesn't block on it). Multiple concurrent calls share
 * the same Tauri round-trip via `loadInflight`.
 */
export async function loadProviderStatus(): Promise<void> {
  if (loadInflight) return loadInflight;
  loadInflight = (async () => {
    try {
      const raw = await invoke<Record<string, boolean>>('agent_check_clis_installed');
      const next: ProviderInstallMap = { ...EMPTY };
      for (const p of AGENT_PROVIDERS) {
        next[p] = !!raw[p];
      }
      providerStatus.set(next);
      providerStatusReady.set(true);
    } catch (err) {
      console.error('[provider-status] probe failed', err);
    } finally {
      loadInflight = null;
    }
  })();
  return loadInflight;
}

/** User-triggered re-probe (e.g. from a "refresh" icon next to the picker). */
export async function refreshProviderStatus(): Promise<void> {
  loadInflight = null;
  return loadProviderStatus();
}

/** Synchronous read for non-reactive code paths (e.g. before opening a modal). */
export function isProviderInstalled(p: AgentProvider): boolean {
  return get(providerStatus)[p];
}
