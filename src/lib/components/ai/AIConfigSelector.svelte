<script lang="ts">
  import { cloudPlan, upgradeModalOpen, cloudCredits } from '$lib/stores/cloud';
  import { settings, setSetting } from '$lib/stores/settings';
  import { PROVIDERS } from '$lib/shared/ai/providers';

  // The active provider lives in the existing flat-settings store under
  // `ai_provider`. We add one virtual entry: "clauge" → routes the chat
  // through the worker (gated by Pro).
  const CLAUGE = 'clauge';

  const isPro = $derived($cloudPlan === 'pro');
  const current = $derived<string>($settings['ai_provider'] || 'claude');

  // Only show providers the user has actually configured (key present in
  // settings). Keeps the dropdown tight and free of unconfigured noise.
  // Clauge AI is always shown — it's the upsell entry for free users.
  const configured = $derived(
    PROVIDERS.filter((p) => !!$settings[p.keySettingName]?.trim()),
  );

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const next = target.value;

    if (next === CLAUGE && !isPro) {
      // Don't persist the change — open upgrade modal, snap dropdown back.
      target.value = current;
      upgradeModalOpen.set(true);
      return;
    }
    setSetting('ai_provider', next);
  }
</script>

<select
  class="ai-selector"
  value={current}
  onchange={handleChange}
  title="Choose AI provider"
>
  <option value={CLAUGE}>
    Clauge AI{!isPro ? ' · PRO' : ''}{isPro && $cloudCredits
      ? ` · ${$cloudCredits.remaining.toLocaleString()}/${$cloudCredits.allowance.toLocaleString()}`
      : ''}
  </option>
  {#each configured as p (p.providerId)}
    <option value={p.providerId}>{p.providerLabel}</option>
  {/each}
</select>

<style>
  .ai-selector {
    background: var(--n2, #0e0e0e);
    color: var(--t1, #ddd);
    border: 1px solid var(--b1, #2a2a2a);
    border-radius: var(--radius-md, 6px);
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
    font-family: var(--ui);
    cursor: pointer;
    max-width: 220px;
  }
  .ai-selector:hover {
    border-color: var(--b2, #3a3a3a);
  }
  .ai-selector:focus {
    outline: 2px solid var(--acc, #4a90e2);
    outline-offset: -1px;
  }
</style>
