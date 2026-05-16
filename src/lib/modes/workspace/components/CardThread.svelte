<script lang="ts">
  // Renders a card's comment thread as left/right chat bubbles. The
  // card's plain markdown body (now back to being just a body, not a
  // mixed thread) sits above the bubbles as a description block.
  //
  // Comments come from `workspace_card_comments` (migration 13). Each
  // row carries actor + body + createdAt; we derive bubble side, label,
  // avatar and agent icon at render time via describeActor().

  import { marked } from 'marked';
  import { onMount, onDestroy } from 'svelte';
  import { describeActor } from '../attribution';
  import { agentIcon } from '../agentIcon';
  import { coworkers } from '../stores';
  import type { WorkspaceCardComment, WorkspaceCoworker } from '../types';
  import CoworkerAvatar from './CoworkerAvatar.svelte';

  interface Props {
    body: string;
    comments: WorkspaceCardComment[];
  }

  let { body, comments }: Props = $props();

  /** Long threads collapse the older portion behind a "Show N
   *  earlier comments" chip. When a card has dozens of bubbles the
   *  user almost always cares about the most recent few — and the
   *  body block + collapse keeps the scroll surface compact.
   *  Default render = last 20; click to expand. */
  const RECENT_WINDOW = 20;
  let showAllComments = $state(false);
  const visibleComments = $derived.by(() => {
    if (showAllComments || comments.length <= RECENT_WINDOW) return comments;
    return comments.slice(comments.length - RECENT_WINDOW);
  });
  const hiddenCount = $derived(comments.length - visibleComments.length);

  /** Index coworkers by id for O(1) lookup per bubble. */
  const coworkerById = $derived.by<Record<string, WorkspaceCoworker>>(() => {
    const map: Record<string, WorkspaceCoworker> = {};
    for (const c of $coworkers) map[c.id] = c;
    return map;
  });

  /** Tick once per second so thinking-bubble copy can escalate from
   *  "thinking" → "still working" without a forced refresh. Cleaned
   *  up on destroy so we don't leak. */
  let nowTick = $state(Date.now());
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  onMount(() => { tickHandle = setInterval(() => (nowTick = Date.now()), 1000); });
  onDestroy(() => { if (tickHandle) clearInterval(tickHandle); });

  /** Copy for the thinking bubble — escalates over time so the user
   *  knows the agent is genuinely working, not silently stuck. */
  function thinkingCopy(c: WorkspaceCardComment, name: string): string {
    const started = Date.parse(c.createdAt);
    const ageSec = Number.isFinite(started) ? (nowTick - started) / 1000 : 0;
    if (ageSec < 25) return 'is thinking…';
    if (ageSec < 90) return 'is composing a reply…';
    return 'is still working — Claude can take a moment for complex requests';
  }

  /** Body markdown — same image-collapse treatment as comment bodies
   *  so description images don't slam into view at full size. */
  const renderedBody = $derived(body ? renderBody(body) : '');

  function bubbleSide(actor: string): 'user' | 'agent' {
    // Coworkers are personas backed by an agent CLI — their messages
    // belong on the agent side of the thread, same as bare CLI actors.
    const k = describeActor(actor).kind;
    return k === 'agent' || k === 'coworker' ? 'agent' : 'user';
  }

  /** HH:MM extracted from createdAt, falling back to the raw string
   *  for any unexpected shape. The full ISO is available in the title
   *  attribute for fuller context on hover. */
  function shortStamp(iso: string): string {
    if (iso.length >= 16 && iso[10] === 'T') return iso.slice(11, 16);
    return iso;
  }

  function renderBody(text: string): string {
    if (!text.trim()) return '';
    let html = marked.parse(text, { async: false }) as string;
    // Replace every <img> with a click-to-reveal placeholder. The
    // alt text doubles as the user-facing label so screenreaders +
    // sighted users see the same hint. Click handler is delegated
    // from the bubble container — the img source lives in data-src.
    html = html.replace(
      /<img\s+([^>]*?)\/?>/gi,
      (_match, attrs: string) => {
        const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
        const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
        const src = srcMatch ? srcMatch[1] : '';
        const alt = (altMatch ? altMatch[1] : '').trim() || 'image';
        if (!src) return '';
        // Encode quotes in attributes to prevent breaking out.
        const safeSrc = src.replace(/"/g, '&quot;');
        const safeAlt = alt.replace(/</g, '&lt;');
        return `<button type="button" class="th-img-toggle" data-src="${safeSrc}" data-alt="${safeAlt}">📎 ${safeAlt} <span class="th-img-hint">· click to view</span></button>`;
      },
    );
    return html;
  }

  /** Threshold past which we collapse a comment body in the bubble.
   *  Picked to fit ~10 lines of typical chat at 12px ui font. */
  const LONG_COMMENT_CHARS = 600;
  /** Truncated preview length when collapsed. */
  const COLLAPSED_PREVIEW = 360;
  /** Per-bubble expanded state. Keyed by comment id; default false. */
  let expanded = $state<Record<string, boolean>>({});

  function isLong(c: WorkspaceCardComment): boolean {
    return (c.body?.length ?? 0) > LONG_COMMENT_CHARS;
  }

  function previewOf(body: string): string {
    if (body.length <= COLLAPSED_PREVIEW) return body;
    // Cut at the last whitespace before the limit so we don't slice
    // a word in half. Append an ellipsis only if we actually trimmed.
    const slice = body.slice(0, COLLAPSED_PREVIEW);
    const lastSpace = slice.lastIndexOf(' ');
    return (lastSpace > COLLAPSED_PREVIEW - 80 ? slice.slice(0, lastSpace) : slice) + '…';
  }

  function toggleExpand(id: string) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }

  /** Click delegate on the bubble — reveals images on click and
   *  toggles them back to placeholders on second click. */
  function onBubbleClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest('.th-img-toggle, .th-img-revealed') as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.classList.contains('th-img-toggle')) {
      const src = btn.dataset.src ?? '';
      const alt = btn.dataset.alt ?? '';
      const img = document.createElement('span');
      img.className = 'th-img-revealed';
      img.dataset.src = src;
      img.dataset.alt = alt;
      img.innerHTML = `<img src="${src}" alt="${alt}"><span class="th-img-collapse">collapse</span>`;
      btn.replaceWith(img);
    } else {
      const src = btn.dataset.src ?? '';
      const alt = btn.dataset.alt ?? '';
      const ph = document.createElement('button');
      ph.type = 'button';
      ph.className = 'th-img-toggle';
      ph.dataset.src = src;
      ph.dataset.alt = alt;
      ph.innerHTML = `📎 ${alt} <span class="th-img-hint">· click to view</span>`;
      btn.replaceWith(ph);
    }
  }
</script>

<div class="th">
  {#if renderedBody}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="th-body" onclick={onBubbleClick}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html renderedBody}
    </div>
  {/if}

  {#if comments.length === 0 && !renderedBody}
    <div class="th-empty">
      No description or comments yet — the thread will start here once
      you add a comment or trigger an agent.
    </div>
  {/if}

  {#if hiddenCount > 0}
    <button class="th-show-earlier" onclick={() => (showAllComments = true)}>
      ▴ Show {hiddenCount} earlier comment{hiddenCount === 1 ? '' : 's'}
    </button>
  {/if}

  {#each visibleComments as c (c.id)}
    {@const desc = describeActor(c.actor)}
    {@const side = bubbleSide(c.actor)}
    <!-- coworkerId on a USER comment means "this message was DIRECTED
         to that coworker" — the bubble must still show YOU as the
         author, not the coworker. Only AGENT comments resolve their
         identity through the coworker FK. -->
    {@const cw = side === 'agent' && c.coworkerId ? coworkerById[c.coworkerId] : null}
    {@const ico = side === 'agent' && !cw ? agentIcon(desc.agentId) : null}
    {@const displayName = cw ? `@${cw.name}` : desc.label}
    {@const subtitle = cw?.role ?? null}
    <div class="th-row" class:th-row-agent={side === 'agent'} class:th-row-user={side === 'user'}>
      <div class="th-avatar-wrap" title={displayName}>
        {#if cw}
          <!-- Persona-driven bubble: dicebear avatar in a circle. -->
          <CoworkerAvatar seed={cw.avatarSeed} style={cw.avatarStyle} size={28} ring />
        {:else if side === 'agent' && ico}
          <span
            class="th-avatar th-avatar-agent"
            style={`color: ${ico.color}; background: color-mix(in srgb, ${ico.color} 14%, transparent); border-color: color-mix(in srgb, ${ico.color} 40%, transparent);`}
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html ico.svg}
          </span>
        {:else if desc.avatarUrl}
          <span class="th-avatar"><img src={desc.avatarUrl} alt="" /></span>
        {:else}
          <span class="th-avatar"><span class="th-avatar-init">{desc.label.charAt(0).toUpperCase()}</span></span>
        {/if}
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div
        class="th-bubble"
        class:th-bubble-agent={side === 'agent'}
        class:th-bubble-thinking={c.pending === 'thinking'}
        class:th-bubble-error={c.pending === 'error'}
        onclick={onBubbleClick}
      >
        <div class="th-meta">
          <span class="th-author">{displayName}</span>
          {#if subtitle}<span class="th-role">· {subtitle}</span>{/if}
          {#if c.pending === 'thinking'}
            <span class="th-pending-label">{thinkingCopy(c, displayName)}</span>
          {:else if c.pending === 'error'}
            <span class="th-pending-error-label">hit an issue</span>
          {/if}
          {#if c.pending !== 'thinking'}
            <span class="th-stamp" title={c.createdAt}>{shortStamp(c.createdAt)}</span>
          {/if}
        </div>
        <div class="th-content">
          {#if c.pending === 'thinking'}
            <!-- Animated three-dot indicator. The bubble has the same
                 shape as a real reply so the swap is seamless when
                 the agent's response lands. -->
            <span class="th-dots" aria-label="thinking">
              <span></span><span></span><span></span>
            </span>
          {:else if isLong(c) && !expanded[c.id]}
            <!-- Long comments collapse by default. Show preview +
                 a clear "expand" affordance. -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderBody(previewOf(c.body))}
            <button
              type="button"
              class="th-expand"
              onclick={(e) => { e.stopPropagation(); toggleExpand(c.id); }}
            >
              ▾ Show full message ({c.body.length} chars)
            </button>
          {:else}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderBody(c.body)}
            {#if isLong(c)}
              <button
                type="button"
                class="th-expand th-collapse"
                onclick={(e) => { e.stopPropagation(); toggleExpand(c.id); }}
              >
                ▴ Collapse
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/each}
</div>

<style>
  .th {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 0 12px;
  }
  .th-empty {
    color: var(--t4);
    font-family: var(--ui);
    font-size: 12px;
    padding: 18px 6px;
    text-align: center;
    line-height: 1.6;
    border: 1px dashed var(--b1);
    border-radius: 6px;
  }
  .th { min-width: 0; }
  .th-body {
    font-family: var(--ui);
    font-size: 12.5px;
    color: var(--t1);
    line-height: 1.65;
    padding: 10px 12px;
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    border-radius: 6px;
    /* Long URLs / inline code in body markdown were spilling outside
     * the outline before — wrap aggressively and keep the box itself
     * within its column. */
    overflow-wrap: anywhere;
    word-break: break-word;
    box-sizing: border-box;
    max-width: 100%;
  }
  .th-body :global(pre),
  .th-body :global(img) { max-width: 100%; }
  .th-body :global(p) { margin: 0 0 8px; }
  .th-body :global(p:last-child) { margin-bottom: 0; }
  .th-body :global(code) {
    font-family: var(--mono);
    font-size: 11.5px;
    background: var(--surface-hover);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .th-body :global(pre) {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--b1);
    border-radius: 5px;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 11px;
  }
  .th-body :global(a) { color: var(--acc); text-decoration: none; }
  .th-body :global(a:hover) { text-decoration: underline; }
  /* Lists — default browser styling renders bullets in the negative
     padding margin (outside the outline). Indent the lists so bullets
     stay inside the box. Nested lists carry the same logic. */
  .th-body :global(ul),
  .th-body :global(ol) {
    margin: 6px 0;
    padding-left: 22px;
    list-style-position: outside;
  }
  .th-body :global(li) { margin: 2px 0; }
  .th-body :global(li > ul),
  .th-body :global(li > ol) { margin: 2px 0; }
  .th-body :global(blockquote) {
    border-left: 2px solid var(--b2);
    padding-left: 10px;
    margin: 6px 0;
    color: var(--t3);
  }
  .th-body :global(h1),
  .th-body :global(h2),
  .th-body :global(h3) {
    margin: 8px 0 4px;
    font-weight: 600;
    color: var(--t1);
  }
  .th-body :global(h1) { font-size: 14px; }
  .th-body :global(h2) { font-size: 13px; }
  .th-body :global(h3) { font-size: 12.5px; }
  /* Image placeholder + revealed states — body markdown reuses the
     same collapse pattern as comment bubbles so a description with
     screenshots doesn't blow up the drawer on first paint. */
  .th-body :global(.th-img-toggle) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    margin: 4px 0;
    border: 1px dashed var(--b2);
    border-radius: 5px;
    background: var(--surface-hover);
    color: var(--t2);
    font-family: var(--ui);
    font-size: 11px;
    cursor: pointer;
  }
  .th-body :global(.th-img-toggle:hover) {
    border-color: var(--acc);
    color: var(--t1);
    background: color-mix(in srgb, var(--acc) 6%, transparent);
  }
  .th-body :global(.th-img-hint) { color: var(--t4); font-size: 10px; }
  .th-body :global(.th-img-revealed) { display: block; position: relative; margin: 6px 0; }
  .th-body :global(.th-img-revealed img) { max-width: 100%; border-radius: 6px; cursor: pointer; display: block; }
  .th-body :global(.th-img-collapse) {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-family: var(--ui); font-size: 10px;
    padding: 2px 6px; border-radius: 3px;
    pointer-events: none;
    opacity: 0; transition: opacity 0.15s;
  }
  .th-body :global(.th-img-revealed:hover .th-img-collapse) { opacity: 1; }

  .th-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .th-row-user { flex-direction: row-reverse; }

  .th-avatar {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--t3);
    font-family: var(--ui);
    overflow: hidden;
    margin-top: 2px;
  }
  .th-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .th-avatar-init {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--t2);
  }

  .th-bubble {
    max-width: 78%;
    background: var(--surface-hover);
    border: 1px solid var(--b1);
    border-radius: 8px;
    padding: 7px 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    box-sizing: border-box;
  }
  .th-bubble-agent {
    background: color-mix(in srgb, var(--acc) 7%, transparent);
    border-color: color-mix(in srgb, var(--acc) 28%, transparent);
  }
  .th-row-user .th-bubble {
    background: var(--surface-hover);
  }
  .th-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--ui);
    font-size: 10px;
  }
  .th-author { color: var(--t2); font-weight: 600; }
  .th-bubble-agent .th-author { color: var(--acc); }
  .th-role { color: var(--t4); font-size: 9.5px; }
  .th-stamp { color: var(--t4); font-family: var(--mono); font-size: 9.5px; margin-left: auto; }
  .th-avatar-wrap {
    flex-shrink: 0;
    display: inline-flex;
    align-items: flex-start;
    margin-top: 2px;
  }
  .th-content {
    color: var(--t1);
    font-family: var(--ui);
    font-size: 12px;
    line-height: 1.55;
    word-wrap: break-word;
  }
  .th-content :global(p) { margin: 0 0 6px; }
  .th-content :global(p:last-child) { margin-bottom: 0; }
  .th-content :global(code) {
    font-family: var(--mono);
    font-size: 11px;
    background: rgba(0, 0, 0, 0.25);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .th-content :global(pre) {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--b1);
    border-radius: 4px;
    padding: 7px 9px;
    overflow-x: auto;
    margin: 4px 0;
    font-size: 10.5px;
  }
  .th-content :global(a) { color: var(--acc); text-decoration: none; }
  .th-content :global(a:hover) { text-decoration: underline; }
  .th-content :global(blockquote) {
    border-left: 2px solid var(--b2);
    padding-left: 8px;
    margin: 4px 0;
    color: var(--t3);
  }
  .th-content :global(ul),
  .th-content :global(ol) { padding-left: 18px; margin: 4px 0; }

  /* Pending states — thinking bubble + error bubble. Same shape as a
     real reply so the swap is seamless when content lands. */
  .th-bubble-thinking {
    background: color-mix(in srgb, var(--acc) 10%, transparent);
    border-color: color-mix(in srgb, var(--acc) 38%, transparent);
  }
  .th-bubble-error {
    background: color-mix(in srgb, var(--err, #f87171) 10%, transparent);
    border-color: color-mix(in srgb, var(--err, #f87171) 40%, transparent);
    color: var(--t1);
  }
  .th-pending-label {
    font-family: var(--ui);
    font-size: 9.5px;
    color: var(--acc);
    font-style: italic;
    margin-left: 2px;
  }
  .th-pending-error-label {
    font-family: var(--ui);
    font-size: 9.5px;
    color: var(--err, #f87171);
    font-weight: 600;
    margin-left: 2px;
  }

  /* Image placeholder — never auto-load images; show a clickable
     chip with the alt text. Click reveals the actual image; another
     click collapses back to the chip. Saves drawer real-estate +
     bandwidth on threads with many screenshots. */
  .th-content :global(.th-img-toggle) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    margin: 4px 0;
    border: 1px dashed var(--b2);
    border-radius: 5px;
    background: var(--surface-hover);
    color: var(--t2);
    font-family: var(--ui);
    font-size: 11px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }
  .th-content :global(.th-img-toggle:hover) {
    border-color: var(--acc);
    color: var(--t1);
    background: color-mix(in srgb, var(--acc) 6%, transparent);
  }
  .th-content :global(.th-img-hint) {
    color: var(--t4);
    font-size: 10px;
    margin-left: 2px;
  }
  .th-content :global(.th-img-revealed) {
    display: block;
    position: relative;
    margin: 6px 0;
  }
  .th-content :global(.th-img-revealed img) {
    max-width: 100%;
    border-radius: 6px;
    cursor: pointer;
    display: block;
  }
  .th-content :global(.th-img-collapse) {
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-family: var(--ui);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .th-content :global(.th-img-revealed:hover .th-img-collapse) {
    opacity: 1;
  }

  /* Long-comment expand toggle. Clear typography so users can scan
     and decide. Default is COLLAPSED (only first ~360 chars shown);
     click expands. Same control re-renders as a Collapse hint at the
     bottom of an expanded bubble. */
  .th-expand {
    display: inline-block;
    margin-top: 6px;
    padding: 2px 6px;
    border: none;
    background: transparent;
    color: var(--acc);
    font-family: var(--ui);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    border-radius: 3px;
    transition: background 0.1s;
  }
  .th-expand:hover { background: color-mix(in srgb, var(--acc) 10%, transparent); }
  .th-collapse { color: var(--t3); }
  .th-collapse:hover { color: var(--t1); }

  /* "Show N earlier comments" chip — sits at the top of the bubble
     stream. Quiet by default so it doesn't distract from the
     conversation; accent on hover. */
  .th-show-earlier {
    align-self: center;
    padding: 5px 12px;
    border: 1px dashed var(--b1);
    border-radius: 14px;
    background: transparent;
    color: var(--t3);
    font-family: var(--ui);
    font-size: 11px;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .th-show-earlier:hover {
    border-color: var(--acc);
    color: var(--t1);
    background: color-mix(in srgb, var(--acc) 6%, transparent);
  }

  /* Three-dot pulse — Slack/Messenger-style typing indicator. */
  .th-dots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0 2px;
  }
  .th-dots span {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--acc);
    opacity: 0.4;
    animation: th-dot 1.2s ease-in-out infinite;
  }
  .th-dots span:nth-child(2) { animation-delay: 0.18s; }
  .th-dots span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes th-dot {
    0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
    30%           { opacity: 1;   transform: scale(1.05); }
  }
</style>
