<script lang="ts">
  import { cloudPlan, upgradeModalOpen } from '$lib/stores/cloud';
  import { settings, setSetting } from '$lib/stores/settings';
  import { PROVIDERS, type ProviderId } from '$lib/shared/ai/providers';

  const CLAUGE = 'clauge';

  const isPro = $derived($cloudPlan === 'pro');
  // Pro users default to Clauge AI (the thing they paid for) when they
  // haven't explicitly chosen a provider. Free users default to 'claude'.
  const current = $derived<string>(
    $settings['ai_provider'] || (isPro ? CLAUGE : 'claude'),
  );
  const isCurrentClauge = $derived(current === CLAUGE);

  // Only show BYOK providers the user has actually configured. Keeps the
  // popover tight; unconfigured noise belongs in Settings, not here.
  const configured = $derived(
    PROVIDERS.filter((p) =>
      p.providerId === 'local'
        ? !!$settings['ai_local_base_url']?.trim()
        : !!$settings[p.keySettingName]?.trim(),
    ),
  );

  // Resolve metadata for the currently-selected provider (for the pill label).
  const currentLabel = $derived(
    current === CLAUGE
      ? 'Clauge AI'
      : (PROVIDERS.find((p) => p.providerId === current)?.providerLabel ?? 'Claude'),
  );

  let open = $state(false);
  let anchorEl: HTMLButtonElement | undefined = $state();
  let popoverEl: HTMLDivElement | undefined = $state();

  function toggle() {
    open = !open;
  }

  function selectProvider(id: string) {
    if (id === CLAUGE && !isPro) {
      open = false;
      upgradeModalOpen.set(true);
      return;
    }
    setSetting('ai_provider', id);
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (popoverEl?.contains(t) || anchorEl?.contains(t)) return;
    open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      anchorEl?.focus();
    }
  }

  $effect(() => {
    if (!open) return;
    // Defer one frame so the click that opened us doesn't immediately close
    // via outside-click handler.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('keydown', handleKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  });
</script>

<button
  bind:this={anchorEl}
  type="button"
  class="acs-pill"
  class:is-clauge={current === CLAUGE}
  class:is-open={open}
  onclick={toggle}
  aria-haspopup="listbox"
  aria-expanded={open}
  title="Switch AI provider"
>
  <span class="acs-dot" aria-hidden="true"></span>
  <span class="acs-label">{currentLabel}</span>
  <svg
    class="acs-chev"
    class:flipped={open}
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
</button>

{#if open}
  <div
    bind:this={popoverEl}
    class="acs-popover"
    role="listbox"
    aria-label="Choose AI provider"
  >
    <!-- Clauge AI — pinned at top. Always shown; gated by Pro. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="acs-row is-clauge"
      class:is-selected={isCurrentClauge}
      role="option"
      tabindex="0"
      aria-selected={isCurrentClauge}
      onclick={() => selectProvider(CLAUGE)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProvider(CLAUGE); } }}
    >
      <span class="acs-row-dot acs-row-dot-clauge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor">
          <path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z" />
        </svg>
      </span>
      <span class="acs-row-text">
        <span class="acs-row-name">Clauge AI</span>
        <span class="acs-row-sub">
          {#if isPro}Managed · no API key needed{:else}Requires Pro{/if}
        </span>
      </span>
      {#if !isPro}
        <span class="acs-pro-badge">PRO</span>
      {:else if isCurrentClauge}
        <span class="acs-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      {/if}
    </div>

    {#if configured.length > 0}
      <div class="acs-sep" aria-hidden="true">
        <span>Your providers</span>
      </div>

      {#each configured as p (p.providerId)}
        {@const isSel = current === p.providerId}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="acs-row"
          class:is-selected={isSel}
          role="option"
          tabindex="0"
          aria-selected={isSel}
          onclick={() => selectProvider(p.providerId)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectProvider(p.providerId); } }}
        >
          <span class="acs-row-dot" aria-hidden="true"></span>
          <span class="acs-row-text">
            <span class="acs-row-name">{p.providerLabel}</span>
            <span class="acs-row-sub"
              >{p.providerId === 'local'
                ? $settings['ai_local_model'] || 'Local'
                : p.modelLabel}</span
            >
          </span>
          {#if isSel}
            <span class="acs-check" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* Pill — sits in the prompt-footer row. Compact, matches mode badges. */
  .acs-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px 4px 8px;
    height: 26px;
    background: var(--n2, #0e0e0e);
    border: 1px solid var(--b1, #2a2a2a);
    border-radius: 999px;
    color: var(--t2, #aaa);
    font-family: var(--ui);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
    user-select: none;
    max-width: 220px;
  }
  .acs-pill:hover {
    border-color: var(--b2, #3a3a3a);
    color: var(--t1, #ddd);
  }
  .acs-pill.is-open {
    border-color: color-mix(in srgb, var(--acc, #c2185b) 50%, var(--b2));
    color: var(--t1, #ddd);
  }
  .acs-pill.is-clauge {
    color: var(--t1, #ddd);
  }
  .acs-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--t3, #888);
    flex-shrink: 0;
  }
  .acs-pill.is-clauge .acs-dot {
    background: var(--acc, #c2185b);
    box-shadow: 0 0 6px color-mix(in srgb, var(--acc, #c2185b) 60%, transparent);
  }
  .acs-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .acs-chev {
    color: var(--t3, #888);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .acs-chev.flipped {
    transform: rotate(180deg);
  }

  /* Popover — opens upward (above the pill) since the selector lives at
     the bottom of the panel. Positioned via absolute parent in AIPanel. */
  .acs-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 240px;
    max-width: 320px;
    background: var(--modal-bg, #101016);
    border: 1px solid var(--b1, #2a2a2a);
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5),
                0 0 0 1px color-mix(in srgb, #ffffff 4%, transparent) inset;
    padding: 4px;
    z-index: 50;
    animation: acs-pop-in 0.12s ease-out;
  }
  @keyframes acs-pop-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .acs-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .acs-row:hover {
    background: color-mix(in srgb, var(--t2, #aaa) 10%, transparent);
  }
  .acs-row.is-selected {
    background: color-mix(in srgb, var(--acc, #c2185b) 12%, transparent);
  }
  .acs-row.is-clauge.is-selected {
    background: color-mix(in srgb, var(--acc, #c2185b) 14%, transparent);
  }

  .acs-row-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--t3, #888);
    flex-shrink: 0;
  }
  .acs-row-dot-clauge {
    width: 18px;
    height: 18px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--acc, #c2185b) 22%, transparent);
    color: var(--acc, #c2185b);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .acs-row-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .acs-row-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--t1, #ddd);
    line-height: 1.2;
  }
  .acs-row-sub {
    font-size: 10.5px;
    color: var(--t3, #888);
    line-height: 1.2;
  }

  .acs-pro-badge {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 4px;
    color: var(--acc, #c2185b);
    background: color-mix(in srgb, var(--acc, #c2185b) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--acc, #c2185b) 30%, transparent);
    flex-shrink: 0;
  }
  .acs-check {
    color: var(--acc, #c2185b);
    flex-shrink: 0;
  }

  .acs-sep {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 4px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--t3, #888);
    text-transform: uppercase;
  }
  .acs-sep::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--b1, #2a2a2a);
  }
</style>
