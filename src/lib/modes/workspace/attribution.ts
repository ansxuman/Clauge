// Attribution helpers — produce the actor string passed to every
// workspace mutation, and render that string back to a human-friendly
// label + avatar source in the UI.
//
// Format on the wire (matches Rust side):
//   'user'                 — anonymous (no GitHub sync)
//   'user:<github-login>'  — GitHub-synced human user
//   'claude' | 'codex' | …  — agent CLI id (matches CliRunner.id())

import { get } from 'svelte/store';
import { cloudConnected, cloudUser, cloudDisplayHandle } from '$lib/stores/cloud';
import { coworkers } from './stores';

/** Strip an email domain to keep a clean display slug
 *  (`alex@example.com` → `alex`). Used both when picking what to write
 *  into new attribution strings AND when rendering legacy rows that
 *  may have stored a raw email as the login. */
function sluggify(s: string): string {
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

/** The actor string for the currently signed-in human user. Read at
 *  the call site so a mid-session cloud login flips attribution from
 *  'user' to 'user:<login>' immediately.
 *
 *  Preference: `cloudUser.slug` (always clean) → display handle stripped
 *  to its local part. We never write a raw email into the actor; legacy
 *  rows that did are normalized at render time via `sluggify()`. */
export function currentUserActor(): string {
  if (get(cloudConnected)) {
    const u = get(cloudUser);
    if (u?.slug && u.slug.trim()) return `user:${u.slug.trim()}`;
    const dh = get(cloudDisplayHandle);
    if (dh?.handle && dh.handle.trim()) return `user:${sluggify(dh.handle.trim())}`;
  }
  return 'user';
}

/** Parse a stored actor string into render data for the UI. */
export function describeActor(actor: string): {
  kind: 'user' | 'user-anon' | 'agent' | 'coworker';
  label: string;
  agentId: string | null;
  avatarUrl: string | null;
  coworkerSeed?: string;
  coworkerStyle?: string;
} {
  if (actor === 'user' || !actor) {
    return { kind: 'user-anon', label: 'You', agentId: null, avatarUrl: null };
  }
  if (actor.startsWith('user:')) {
    const login = actor.slice(5).trim();
    const label = sluggify(login) || 'You';
    // "Is this the currently signed-in user?" — match against the slug,
    // the displayHandle, OR the sluggified displayHandle (handles
    // legacy rows that stored an email). If yes, surface their real
    // avatar URL so the chip shows their GitHub/Google picture.
    const u = get(cloudUser);
    const dh = get(cloudDisplayHandle)?.handle?.trim() ?? '';
    const isMe =
      (u?.slug && u.slug === login) ||
      dh === login ||
      sluggify(dh) === label;
    const avatar = isMe ? (u?.avatarUrl ?? null) : null;
    return { kind: 'user', label, agentId: null, avatarUrl: avatar };
  }
  // Could be a coworker (persona) — name is the slug stored as the
  // actor whenever a card mutation runs in that persona's context.
  // Match case-insensitively against the coworker registry; if we hit,
  // render with avatar + @name instead of the generic agent star.
  const cw = get(coworkers).find(
    (c) => c.name.toLowerCase() === actor.toLowerCase(),
  );
  if (cw) {
    return {
      kind: 'coworker',
      label: cw.name,
      agentId: null,
      avatarUrl: null,
      coworkerSeed: cw.avatarSeed,
      coworkerStyle: cw.avatarStyle,
    };
  }
  // Anything else is a real agent CLI id (claude / codex / gemini / …).
  return {
    kind: 'agent',
    label: actor.charAt(0).toUpperCase() + actor.slice(1),
    agentId: actor,
    avatarUrl: null,
  };
}

/** Format an attribution line as a single short string, e.g.
 *  "ansxuman · 2m ago" or "Claude · just now". */
export function formatAttribution(actor: string, isoTimestamp: string): string {
  const { label } = describeActor(actor);
  const when = relativeTime(isoTimestamp);
  return when ? `${label} · ${when}` : label;
}

export function relativeTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'just now';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
