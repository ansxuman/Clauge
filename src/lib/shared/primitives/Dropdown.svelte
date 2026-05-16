<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { CLICK_OUTSIDE_GUARD_MS } from '$lib/shared/constants/timings';

  interface DropdownItem {
    label: string;
    icon?: string;
    action: () => void;
    danger?: boolean;
    separator?: boolean;
  }

  interface Props {
    items: DropdownItem[];
    show: boolean;
    anchor?: HTMLElement | null;
    onclose?: () => void;
  }

  let { items, show = $bindable(), anchor = null, onclose }: Props = $props();

  let dropdownEl: HTMLDivElement | undefined = $state();
  let posX = $state(0);
  let posY = $state(0);

  $effect(() => {
    if (show && anchor) {
      const rect = anchor.getBoundingClientRect();
      // Align dropdown right edge with anchor right edge
      posX = rect.right;
      posY = rect.bottom + 4;
      alignRight = true;
    }
  });

  let alignRight = $state(true);

  $effect(() => {
    if (show && dropdownEl) {
      // Wait one frame so the dropdown has its final rendered width
      requestAnimationFrame(() => {
        if (!dropdownEl) return;
        const rect = dropdownEl.getBoundingClientRect();
        // If it goes off left, switch to left-align
        if (rect.left < 8) {
          const anchorRect = anchor?.getBoundingClientRect();
          posX = anchorRect?.left ?? 8;
          alignRight = false;
        }
        // If it goes off right, constrain
        if (rect.right > window.innerWidth - 8) {
          posX = window.innerWidth - 8;
          alignRight = true;
        }
        // If it goes off bottom, shift up
        if (rect.bottom > window.innerHeight) {
          posY = window.innerHeight - rect.height - 8;
        }
      });
    }
  });

  function close() {
    show = false;
    onclose?.();
  }

  function handleClickOutside(e: MouseEvent) {
    if (
      dropdownEl &&
      !dropdownEl.contains(e.target as Node) &&
      (!anchor || !anchor.contains(e.target as Node))
    ) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && show) {
      e.preventDefault();
      close();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    setTimeout(() => {
      window.addEventListener('click', handleClickOutside);
    }, CLICK_OUTSIDE_GUARD_MS);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('click', handleClickOutside);
  });
</script>

{#if show}
  <div
    class="dropdown-menu"
    bind:this={dropdownEl}
    style="{alignRight ? `right: ${window.innerWidth - posX}px` : `left: ${posX}px`}; top: {posY}px"
  >
    {#each items as item}
      {#if item.separator}
        <div class="dd-sep"></div>
      {:else}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="dd-item"
          class:danger={item.danger}
          onclick={() => { close(); item.action(); }}
        >
          {#if item.icon}
            <span class="dd-icon">{item.icon}</span>
          {/if}
          {item.label}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .dropdown-menu {
    position: fixed;
    background: var(--modal-bg, #101016);
    border: 1px solid var(--b1);
    border-radius: 7px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: var(--z-drawer);
    min-width: 200px;
    padding: 4px 0;
    white-space: nowrap;
    animation: fadeIn 0.1s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .dd-item {
    padding: 7px 14px;
    font-size: 12px;
    color: var(--t2);
    font-family: var(--ui);
    cursor: pointer;
    transition: background 0.08s;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dd-item:hover {
    background: var(--c);
    color: var(--t1);
  }

  .dd-item.danger {
    color: var(--err);
  }

  .dd-item.danger:hover {
    background: rgba(240,68,68,0.1);
  }

  .dd-sep {
    height: 1px;
    background: var(--b1);
    margin: 4px 0;
  }

  .dd-icon {
    font-size: 14px;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
</style>
