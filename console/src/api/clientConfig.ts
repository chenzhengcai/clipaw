/**
 * Client-side config persistence that survives Tauri port changes.
 *
 * localStorage is origin-scoped — when the backend port changes on
 * restart, all data is lost.  This module syncs critical config to
 * the backend's `client-config.json` so it survives restarts.
 */
import { request } from "./request";

const SYNC_KEYS = new Set([
  "voice_connected",
  "qwenpaw_voice_shortcut",
  "qwenpaw_voice_shortcut_mode",
  "qwenpaw-last-used-agent",
]);

let _synced = false;

/** Pull backend config → localStorage (call once on app init). */
export async function loadClientConfig(): Promise<void> {
  if (_synced) return;
  try {
    const data = await request<Record<string, unknown>>("/workspace/client-config");
    if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        if (SYNC_KEYS.has(key) && value !== undefined && value !== null) {
          localStorage.setItem(key, String(value));
        }
      }
    }
  } catch {
    // Backend not ready yet — fine, will use localStorage defaults
  }
  _synced = true;
}

/** Save a single key to both localStorage and backend. */
export async function saveClientConfig(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
  try {
    await request("/workspace/client-config", {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
  } catch {
    // Backend not available — localStorage is enough for this session
  }
}

/** Load a key from localStorage (sync, for component use). */
export function getClientConfig(key: string): string | null {
  return localStorage.getItem(key);
}

/** Remove a key. */
export function removeClientConfig(key: string): void {
  localStorage.removeItem(key);
}
