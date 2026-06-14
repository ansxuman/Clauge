import { invoke } from '@tauri-apps/api/core';
import type { AppearanceConfig } from '$lib/types';

export async function getSetting(key: string): Promise<string | null> {
  return invoke('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke('set_setting', { key, value });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  return invoke('get_all_settings');
}

// Whether a diagnostic `area` is enabled in settings.json (`"diagnostics": [..]`).
// Used to reveal debug-only UI in release builds — see app_config.rs.
export async function appDiagnosticsEnabled(area: string): Promise<boolean> {
  return invoke('app_diagnostics_enabled', { area });
}

export async function setVibrancy(material: string): Promise<void> {
  return invoke('set_vibrancy', { material });
}

export async function getAppearance(): Promise<AppearanceConfig> {
  return invoke('get_appearance');
}

export async function setAppearance(config: AppearanceConfig): Promise<void> {
  return invoke('set_appearance', { config });
}
