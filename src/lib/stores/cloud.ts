import { writable, derived } from 'svelte/store';
import { STORAGE_KEYS } from '$lib/shared/constants/storage';

export type Provider = 'github' | 'google';

export interface CloudUser {
  userId: number;
  email: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  slug: string;
  /** ISO timestamp when the user row was created — drives "Member since". */
  createdAt: string | null;
}

export type CloudSubscriptionSnapshot = {
  status: string;
  cancelAtPeriodEnd: boolean;
  isLifetime: boolean;
  currentPeriodEnd: string | null;
  currentPeriodStart: string | null;
  interval: 'monthly' | 'yearly' | 'lifetime' | null;
  priceUsd: number | null;
} | null;

export interface CloudProviderLink {
  provider: Provider;
  providerUserId: string;
  providerLogin: string | null;
  email: string | null;
  linkedAt: string;
  lastSeenAt: string;
}

export const cloudConnected = writable<boolean>(false);
export const cloudUser = writable<CloudUser | null>(null);
export const cloudProviders = writable<CloudProviderLink[]>([]);
export const cloudPlan = writable<string>('free');
export const activeProvider = writable<Provider | null>(null);
export const welcomeProModalOpen = writable<boolean>(false);

/** Convenience: the GitHub-or-Google display handle shown in UI. */
export const cloudDisplayHandle = derived(
  [cloudUser, cloudProviders, activeProvider],
  ([$u, $p, $active]) => {
    if (!$u) return null;
    const linked = $active ? $p.find((p) => p.provider === $active) : $p[0];
    return {
      handle:
        linked?.providerLogin ||
        $u.displayName ||
        $u.email ||
        $u.slug,
      avatarUrl: $u.avatarUrl,
      provider: linked?.provider || $active || null,
    };
  },
);

/** Per-domain "last synced" timestamps, keyed by kind. */
export const lastSyncedByKind = writable<Record<string, string>>({});

/** Generic "any push or pull in flight" flag for spinner states. */
export const syncing = writable<boolean>(false);

/** Kinds currently in conflict-locked state — populated by listening to
 *  the `cloud:conflicts-changed` Tauri event. Drives the avatar amber
 *  dot, the "Action Required (N)" profile-menu row, and the resolver. */
export const cloudConflicts = writable<string[]>([]);

/** Show the "Cloud data found — restore?" modal on first sign-in when local has rows. */
export const showSyncRestorePrompt = writable<boolean>(false);

/** Persisted: did the user complete the first-sign-in restore decision? */
export const hasSyncedOnce = writable<boolean>(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.HAS_SYNCED) === 'true'
    : false,
);

export function markSynced() {
  hasSyncedOnce.set(true);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.HAS_SYNCED, 'true');
  }
}

export function setConnected(
  user: CloudUser,
  providers: CloudProviderLink[],
  active: Provider | null,
  plan: string,
) {
  cloudConnected.set(true);
  cloudUser.set(user);
  cloudProviders.set(providers);
  activeProvider.set(active);
  cloudPlan.set(plan);

  if (user.avatarUrl && typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.GITHUB_AVATAR, user.avatarUrl);
  }
}

export function setDisconnected() {
  cloudConnected.set(false);
  cloudUser.set(null);
  cloudProviders.set([]);
  activeProvider.set(null);
  cloudPlan.set('free');
  lastSyncedByKind.set({});
  hasSyncedOnce.set(false);
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.GITHUB_AVATAR);
    localStorage.removeItem(STORAGE_KEYS.HAS_SYNCED);
    localStorage.removeItem(STORAGE_KEYS.LAST_SYNCED_AT);
  }
}

export function setSyncing(value: boolean) {
  syncing.set(value);
}

export function setLastSyncedForKinds(map: Record<string, string>) {
  lastSyncedByKind.set(map);
}

export type CloudCreditsSnapshot = {
  remaining: number;
  allowance: number;
  resetsAt: string | null;
} | null;

export const cloudCredits = writable<CloudCreditsSnapshot>(null);

/** Active subscription details — populated from /api/auth/me entitlements
 *  and refreshed alongside cloudCredits. Null when not signed in or on
 *  the free plan. */
export const cloudSub = writable<CloudSubscriptionSnapshot>(null);

export const upgradeModalOpen = writable<boolean>(false);

// Restore the cached avatar on first import so the UI doesn't flash.
if (typeof localStorage !== 'undefined') {
  const cachedAvatar = localStorage.getItem(STORAGE_KEYS.GITHUB_AVATAR);
  if (cachedAvatar) {
    cloudUser.update((u) =>
      u ? { ...u, avatarUrl: cachedAvatar } : u,
    );
  }
}
