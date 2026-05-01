// SSH tab keys are unique-per-spawn so a profile can have multiple
// independent tabs ("Duplicate Session"). Format: `<profileId>#<timestamp>-<counter>`.
//
// The prefix-extraction helper lets call sites that only have a tabKey
// (e.g. Topbar tab close logic) recover the underlying profile id.

let counter = 0;

/** Generate a fresh tab key for the given profile. */
export function newSshTabKey(profileId: string): string {
  counter += 1;
  return `${profileId}#${Date.now()}-${counter}`;
}

/** Extract the profile id from a tabKey. Returns the input unchanged if
 * the key has no `#` separator (legacy/profile-id-only keys). */
export function profileIdFromTabKey(tabKey: string): string {
  const idx = tabKey.indexOf('#');
  return idx === -1 ? tabKey : tabKey.slice(0, idx);
}

/** True if the given tab key represents a session for this profile. */
export function tabKeyMatchesProfile(tabKey: string, profileId: string): boolean {
  return profileIdFromTabKey(tabKey) === profileId;
}
