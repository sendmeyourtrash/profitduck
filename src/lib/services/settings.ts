/**
 * Settings service — CRUD for the key-value settings table.
 * Stores API keys, preferences, and sync configuration persistently.
 */

import { prisma } from "../db/prisma";

export const SETTING_KEYS = {
  SQUARE_API_TOKEN: "square_api_token",
  AUTO_SYNC_ENABLED: "auto_sync_enabled",
  LAST_SYNC_AT: "last_sync_at",
} as const;

// Sensitive keys whose values should be masked when returned to the client
const SENSITIVE_KEYS: Set<string> = new Set([SETTING_KEYS.SQUARE_API_TOKEN]);

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { key } });
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Return all settings with sensitive values masked for client display.
 */
export async function getAllSettingsMasked(): Promise<Record<string, string>> {
  const all = await getAllSettings();
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    masked[key] = SENSITIVE_KEYS.has(key) ? maskToken(value) : value;
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Convenience — Square token
// ---------------------------------------------------------------------------

export async function getSquareToken(): Promise<string | null> {
  return getSetting(SETTING_KEYS.SQUARE_API_TOKEN);
}

export async function setSquareTokenDb(token: string): Promise<void> {
  return setSetting(SETTING_KEYS.SQUARE_API_TOKEN, token);
}

export async function deleteSquareTokenDb(): Promise<void> {
  return deleteSetting(SETTING_KEYS.SQUARE_API_TOKEN);
}

// ---------------------------------------------------------------------------
// Convenience — Auto-sync
// ---------------------------------------------------------------------------

export async function isAutoSyncEnabled(): Promise<boolean> {
  const val = await getSetting(SETTING_KEYS.AUTO_SYNC_ENABLED);
  return val === "true";
}

export async function setAutoSyncEnabled(enabled: boolean): Promise<void> {
  return setSetting(SETTING_KEYS.AUTO_SYNC_ENABLED, String(enabled));
}

export async function getLastSyncAt(): Promise<string | null> {
  return getSetting(SETTING_KEYS.LAST_SYNC_AT);
}

export async function setLastSyncAt(iso: string): Promise<void> {
  return setSetting(SETTING_KEYS.LAST_SYNC_AT, iso);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return token.slice(0, 4) + "••••••••" + token.slice(-4);
}
