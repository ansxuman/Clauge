<script lang="ts">
  let {
    plan,
    credits,
    subscription,
    onUpgradeClick,
    onManageClick,
  }: {
    plan: string;
    credits: { remaining: number; allowance: number; resets_at: string | null } | null;
    subscription: { status: string; cancel_at_period_end: boolean } | null;
    onUpgradeClick: () => void;
    onManageClick: () => void;
  } = $props();

  const isPro = $derived(plan === 'pro');

  function formatResetCountdown(resetsAt: string | null): string {
    if (!resetsAt) return '';
    const reset = new Date(resetsAt);
    const now = new Date();
    const days = Math.max(0, Math.ceil((reset.getTime() - now.getTime()) / 86400000));
    if (days === 0) return 'Resets today';
    if (days === 1) return 'Resets tomorrow';
    return `Resets in ${days} days`;
  }
</script>

{#if !isPro}
  <div class="cai-card upsell">
    <div class="cai-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    </div>
    <div class="cai-body">
      <h3 class="cai-title">Clauge AI</h3>
      <p class="cai-desc">Managed AI assistance, included with Pro. Skip the API key setup.</p>
    </div>
    <button class="cai-btn cai-btn-primary" onclick={onUpgradeClick}>Upgrade to Pro</button>
  </div>
{:else if credits}
  <div class="cai-card balance">
    <div class="cai-row">
      <h3 class="cai-title">Clauge AI</h3>
      <span class="cai-badge {subscription?.cancel_at_period_end ? 'cai-badge-warn' : 'cai-badge-ok'}">
        {subscription?.cancel_at_period_end ? 'Cancelling' : 'Active'}
      </span>
    </div>
    <div class="cai-credit-row">
      <span class="cai-credit-val">{credits.remaining}</span>
      <span class="cai-credit-sep">/</span>
      <span class="cai-credit-total">{credits.allowance} credits</span>
    </div>
    <div class="cai-progress-wrap">
      <div
        class="cai-progress-bar"
        style="width: {Math.min(100, Math.round((credits.remaining / credits.allowance) * 100))}%"
      ></div>
    </div>
    {#if credits.resets_at}
      <p class="cai-reset">{formatResetCountdown(credits.resets_at)}</p>
    {/if}
    <button class="cai-btn cai-btn-ghost" onclick={onManageClick}>Manage subscription</button>
  </div>
{/if}

<style>
  .cai-card {
    padding: 14px 16px;
    border: 1px solid var(--b1);
    border-radius: 10px;
    background: var(--surface-hover);
    margin-bottom: 12px;
    font-family: var(--ui);
  }

  .cai-card.upsell {
    display: flex;
    align-items: center;
    gap: 12px;
    border-color: color-mix(in srgb, var(--acc) 30%, var(--b1));
    background: color-mix(in srgb, var(--acc) 4%, var(--surface-hover));
  }

  .cai-icon {
    flex-shrink: 0;
    color: var(--acc);
    display: flex;
    align-items: center;
  }

  .cai-body {
    flex: 1;
    min-width: 0;
  }

  .cai-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--t1);
    margin: 0 0 2px;
    letter-spacing: -0.01em;
  }

  .cai-desc {
    font-size: 12px;
    color: var(--t3);
    margin: 0;
    line-height: 1.5;
  }

  .cai-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .cai-badge {
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 8px;
    border-radius: 100px;
    font-family: var(--ui);
  }

  .cai-badge-ok {
    background: color-mix(in srgb, var(--acc) 12%, transparent);
    color: var(--acc);
  }

  .cai-badge-warn {
    background: color-mix(in srgb, var(--err) 12%, transparent);
    color: var(--err);
  }

  .cai-credit-row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 8px;
  }

  .cai-credit-val {
    font-size: 22px;
    font-weight: 700;
    color: var(--t1);
    font-family: var(--mono);
    letter-spacing: -0.02em;
  }

  .cai-credit-sep {
    font-size: 14px;
    color: var(--t4, var(--t3));
  }

  .cai-credit-total {
    font-size: 13px;
    color: var(--t3);
    font-family: var(--mono);
  }

  .cai-progress-wrap {
    height: 4px;
    background: var(--b1);
    border-radius: 100px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .cai-progress-bar {
    height: 100%;
    background: var(--acc);
    border-radius: 100px;
    transition: width 0.3s ease;
  }

  .cai-reset {
    font-size: 11.5px;
    color: var(--t3);
    margin: 0 0 12px;
  }

  .cai-btn {
    padding: 7px 14px;
    border-radius: var(--radius-md, 7px);
    border: 1px solid var(--b1);
    font-size: 12px;
    font-weight: 500;
    font-family: var(--ui);
    cursor: default;
    transition: background 0.12s, border-color 0.12s, opacity 0.12s;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .cai-btn-primary {
    background: var(--acc);
    border-color: transparent;
    color: #fff;
    flex-shrink: 0;
  }

  .cai-btn-primary:hover {
    opacity: 0.88;
  }

  .cai-btn-ghost {
    background: transparent;
    color: var(--t2);
  }

  .cai-btn-ghost:hover {
    background: var(--surface-hover);
    border-color: var(--b2);
    color: var(--t1);
  }
</style>
