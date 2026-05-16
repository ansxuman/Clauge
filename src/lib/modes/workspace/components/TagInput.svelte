<script lang="ts">
  // Pill-style tag editor. Type → Enter (or comma) commits the tag;
  // backspace on empty input deletes the last chip; click × removes.
  // Each chip uses tagColor() so the same tag is the same colour
  // wherever it shows up (board cards, note properties, etc).

  import { tagColor } from '../tagColor';

  interface Props {
    value: string[];
    placeholder?: string;
    onchange?: (tags: string[]) => void;
  }

  let { value = $bindable([]), placeholder = 'Add tag…', onchange }: Props = $props();

  let draft = $state('');

  function commit() {
    const t = draft.trim().replace(/^#/, '');
    if (!t) return;
    if (value.includes(t)) { draft = ''; return; }
    value = [...value, t];
    draft = '';
    onchange?.(value);
  }

  function remove(i: number) {
    value = value.filter((_, idx) => idx !== i);
    onchange?.(value);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      remove(value.length - 1);
    }
  }
</script>

<div class="ti-wrap">
  {#each value as tag, i (tag)}
    {@const c = tagColor(tag)}
    <span class="ti-chip" style="color:{c.fg};background:{c.bg};border-color:{c.border};">
      {tag}
      <button class="ti-chip-x" onclick={() => remove(i)} aria-label="Remove tag">×</button>
    </span>
  {/each}
  <input
    class="ti-input"
    bind:value={draft}
    onkeydown={onKey}
    onblur={commit}
    {placeholder}
    spellcheck="false"
  />
</div>

<style>
  /* Borderless container — chips and the tiny add field flow inline
     with surrounding text. No oversized box. The inline input only
     gets visual weight on focus. */
  .ti-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    padding: 0;
    border: none;
    background: transparent;
  }
  .ti-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 2px 2px 9px;
    border-radius: 11px;
    background: color-mix(in srgb, var(--acc) 14%, transparent);
    color: var(--t1);
    font-family: var(--ui);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1;
  }
  .ti-chip-x {
    width: 14px;
    height: 14px;
    border: none;
    background: transparent;
    color: color-mix(in srgb, var(--t2) 70%, transparent);
    border-radius: 50%;
    font-size: 13px;
    line-height: 1;
    cursor: default;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .ti-chip-x:hover {
    background: color-mix(in srgb, var(--acc) 30%, transparent);
    color: var(--t1);
  }
  .ti-input {
    min-width: 70px;
    border: none;
    background: transparent;
    color: var(--t1);
    font-family: var(--ui);
    font-size: 11.5px;
    outline: none;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background 0.12s;
  }
  .ti-input:focus { background: var(--surface-hover); }
  .ti-input::placeholder { color: var(--t4); }
</style>
