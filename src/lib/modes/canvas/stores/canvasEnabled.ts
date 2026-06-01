import { writable } from 'svelte/store';
import { setSetting as persistSetting } from '$lib/stores/settings';
import { settings } from '$lib/stores/settings';

const KEY = 'canvas.enabled';

export const canvasEnabled = writable<boolean>(false);

// Hydrate from the global settings store (populated on app boot).
settings.subscribe((s) => {
  const v = (s as Record<string, unknown> | undefined)?.[KEY];
  canvasEnabled.set(v === true || v === 'true');
});

export async function setCanvasEnabled(enabled: boolean): Promise<void> {
  canvasEnabled.set(enabled);
  await persistSetting(KEY, enabled ? 'true' : 'false');
}
