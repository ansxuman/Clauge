<script lang="ts">
  // Inline @-mention popover. Listens for `@` keystrokes inside a
  // host textarea, opens a filterable list of coworkers, and on
  // selection rewrites `@<query>` → `@<coworker.name>` in the
  // textarea. Caller controls the textarea via bind:value + textareaEl.
  //
  // Why this lives outside the textarea: positioning a popover at the
  // exact caret offset is hairy (caret rect needs a hidden mirror div
  // measurement). For v1 we anchor the popover ABOVE the textarea,
  // full input width — close enough that scanning is fast, no caret
  // math required.

  import { coworkers } from '../stores';
  import CoworkerAvatar from './CoworkerAvatar.svelte';
  import type { WorkspaceCoworker } from '../types';

  interface Props {
    /** Bound to the host textarea's value — we both read and rewrite it. */
    text: string;
    /** Reference to the textarea so we can read selection + refocus. */
    textareaEl: HTMLTextAreaElement | null;
    /** Fired when the user picks a coworker — host can persist
     *  "tagged coworker" for later send routing if it wants. */
    onpick?: (cw: WorkspaceCoworker) => void;
  }

  let { text = $bindable(), textareaEl, onpick }: Props = $props();

  let open = $state(false);
  /** The text BETWEEN the `@` and the caret — drives the filter. */
  let query = $state('');
  /** Caret position when the picker opened — needed to rewrite the
   *  exact `@<query>` slice on selection. */
  let queryStart = $state(0);
  let queryEnd = $state(0);
  let activeIndex = $state(0);

  /** Filter coworkers by case-insensitive prefix match on name OR role. */
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return $coworkers;
    return $coworkers.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.role ?? '').toLowerCase().includes(q),
    );
  });

  // ── Public surface — host calls these ─────────────────────────────

  /** Handle a key event on the textarea. Returns `true` if we
   *  consumed it (caller should preventDefault) — used for
   *  Up/Down/Enter/Escape inside the popover. */
  export function handleKey(e: KeyboardEvent): boolean {
    if (!open) return false;
    if (e.key === 'Escape')      { open = false;        return true; }
    if (e.key === 'ArrowDown')   { activeIndex = Math.min(matches.length - 1, activeIndex + 1); return true; }
    if (e.key === 'ArrowUp')     { activeIndex = Math.max(0, activeIndex - 1);                  return true; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const cw = matches[activeIndex];
      if (cw) { commit(cw); return true; }
    }
    return false;
  }

  /** Re-evaluate state on every input event in the textarea.
   *  Look at the substring ending at the caret — if it contains an
   *  `@<word>` with no whitespace after the `@`, we're in mention mode. */
  export function refresh() {
    if (!textareaEl) return;
    const caret = textareaEl.selectionStart ?? 0;
    const before = text.slice(0, caret);
    // Match `@<chars>` where <chars> is the partial query the user is
    // typing. Allows letters, digits, dashes, underscores. Anchored
    // to either start-of-string or a non-word char before the @ so
    // we don't trigger inside `email@host.com`.
    const m = before.match(/(^|\s)@([\w-]*)$/);
    if (!m) { open = false; return; }
    queryStart = caret - (m[2].length + 1); // position of the `@`
    queryEnd   = caret;
    query      = m[2];
    activeIndex = 0;
    open = true;
  }

  function commit(cw: WorkspaceCoworker) {
    if (!textareaEl) return;
    const before = text.slice(0, queryStart);
    const after  = text.slice(queryEnd);
    // Insert `@<name> ` (trailing space so the next keystroke is fresh)
    const inserted = `@${cw.name} `;
    text = before + inserted + after;
    open = false;
    onpick?.(cw);
    // Restore caret right after the inserted mention.
    const newCaret = (before + inserted).length;
    queueMicrotask(() => {
      if (!textareaEl) return;
      textareaEl.focus();
      textareaEl.setSelectionRange(newCaret, newCaret);
    });
  }
</script>

{#if open && matches.length > 0}
  <div class="cmp" role="listbox">
    <div class="cmp-head">
      Tag a coworker
      {#if query}<span class="cmp-q">· @{query}</span>{/if}
    </div>
    <div class="cmp-list">
      {#each matches as cw, i (cw.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <button
          class="cmp-item"
          class:cmp-item-active={i === activeIndex}
          onmouseenter={() => (activeIndex = i)}
          onclick={() => commit(cw)}
          type="button"
        >
          <CoworkerAvatar seed={cw.avatarSeed} style={cw.avatarStyle} size={24} />
          <div class="cmp-item-text">
            <div class="cmp-item-name">@{cw.name}</div>
            {#if cw.role}<div class="cmp-item-role">{cw.role}</div>{/if}
          </div>
        </button>
      {/each}
    </div>
    <div class="cmp-foot">
      <kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> dismiss
    </div>
  </div>
{:else if open && matches.length === 0}
  <div class="cmp cmp-empty">
    <div class="cmp-empty-text">
      No coworker matches <strong>@{query}</strong>
    </div>
    <div class="cmp-foot">Press <kbd>esc</kbd> to dismiss</div>
  </div>
{/if}

<style>
  .cmp {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    /* Compact picker — typical mention-popover width, not the full
       textarea. 280px fits the longest "@<name> · <role>" without
       overflowing on small drawers. max-width caps it on a really
       narrow drawer (the resize-handle minimum is 480px). */
    width: 280px;
    max-width: calc(100% - 16px);
    background: var(--n, #0d1117);
    border: 1px solid var(--b1);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    z-index: 220;
    overflow: hidden;
    animation: pop 0.12s ease;
  }
  @keyframes pop { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  .cmp-head {
    padding: 6px 10px;
    font-family: var(--ui);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--t4);
    border-bottom: 1px solid var(--b1);
  }
  .cmp-q {
    color: var(--acc);
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 4px;
  }

  .cmp-list { max-height: 240px; overflow-y: auto; padding: 3px; }
  .cmp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 5px;
    text-align: left;
    cursor: default;
    color: var(--t1);
    width: 100%;
    transition: background 0.08s;
  }
  .cmp-item-active { background: color-mix(in srgb, var(--acc) 14%, transparent); }
  .cmp-item-text { flex: 1; min-width: 0; }
  .cmp-item-name { font-family: var(--ui); font-size: 12px; font-weight: 600; }
  .cmp-item-role { font-family: var(--ui); font-size: 10.5px; color: var(--t3); }

  .cmp-foot {
    padding: 5px 10px;
    border-top: 1px solid var(--b1);
    font-family: var(--ui);
    font-size: 10px;
    color: var(--t4);
  }
  kbd {
    font-family: var(--mono);
    background: var(--surface-hover);
    padding: 0 4px;
    border-radius: 3px;
    font-size: 9.5px;
    margin: 0 1px;
  }

  .cmp-empty { padding: 0; }
  .cmp-empty-text {
    padding: 12px;
    font-family: var(--ui);
    font-size: 11.5px;
    color: var(--t3);
    text-align: center;
  }
  .cmp-empty-text strong { color: var(--t1); }
</style>
