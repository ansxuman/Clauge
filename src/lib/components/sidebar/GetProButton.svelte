<script lang="ts">
  import { cloudConnected, cloudPlan, upgradeModalOpen } from '$lib/stores/cloud';

  const isPro = $derived($cloudPlan === 'pro');
  const visible = $derived($cloudConnected);
</script>

{#if visible}
  <button
    class="get-pro-badge"
    class:pro={isPro}
    onclick={(e) => {
      e.stopPropagation();
      if (!isPro) upgradeModalOpen.set(true);
    }}
    title={isPro ? 'Clauge Pro active' : 'Upgrade to Clauge Pro'}
    aria-label={isPro ? 'Clauge Pro active' : 'Upgrade to Clauge Pro'}
    disabled={isPro}
  >
    {isPro ? 'Pro' : 'Get Pro'}
  </button>
{/if}

<style>
  .get-pro-badge {
    /* Sits above the avatar, anchored to its right side with a tiny outward
       overhang so the lower-right corner of the badge clips just past the
       avatar's right edge while staying within the 72px sidebar. */
    position: absolute;
    bottom: 100%;
    right: -6px;
    margin-bottom: -4px;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid var(--n2, #0e0e0e);
    background: linear-gradient(135deg, var(--acc, #c2185b), color-mix(in srgb, var(--acc, #c2185b) 65%, transparent));
    color: white;
    cursor: pointer;
    font-size: 9px;
    font-weight: 700;
    font-family: var(--ui);
    letter-spacing: 0.04em;
    line-height: 1.2;
    white-space: nowrap;
    z-index: 2;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .get-pro-badge:not(.pro):hover {
    transform: scale(1.08);
    box-shadow: 0 2px 5px color-mix(in srgb, var(--acc, #c2185b) 55%, transparent);
  }
  .get-pro-badge.pro {
    cursor: default;
    background: color-mix(in srgb, var(--acc, #c2185b) 80%, transparent);
  }
</style>
