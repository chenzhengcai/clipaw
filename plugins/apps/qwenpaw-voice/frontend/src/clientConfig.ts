/**
 * clientConfig.ts — client configuration persistence (plugin-local copy).
 *
 * Tauri desktop may bind a different port each launch; `localStorage` is
 * origin-scoped and is wiped by the port change.  This mirrors values to the
 * plugin's backend file store (`/api/qwenpaw-voice/client-config`) so they
 * survive restarts.  Ported from `console/src/api/clientConfig.ts`.
 */
import { apiFetch } from "./host";

const SYNC_KEYS = new Set([
  "voice_connected",
  "qwenpaw_voice_shortcut",
  "qwenpaw_voice_shortcut_mode",
  "qwenpaw_voice_enabled",
]);

let _synced = false;

/**
 * Load all client config from the backend and restore to localStorage.
 * Called once on plugin load.  Backend values overwrite localStorage so
 * config survives Tauri port changes.
 */
export async function loadClientConfig(): Promise<void> {
  if (_synced) return;
  try {
    const res = await apiFetch("/qwenpaw-voice/client-config");
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, unknown>;
    if (data && typeof data === "object") {
      for (const [key, value] of Object.entries(data)) {
        if (SYNC_KEYS.has(key) && value !== undefined && value !== null) {
          localStorage.setItem(key, String(value));
        }
      }
    }
  } catch {
    /* Backend not ready yet — use localStorage defaults */
  }
  _synced = true;
}

/** Save a single key to the backend client-config file + localStorage. */
export async function saveClientConfig(
  key: string,
  value: string,
): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  try {
    await apiFetch("/qwenpaw-voice/client-config", {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
  } catch {
    /* non-fatal */
  }
}

/** Load a key from localStorage (sync, for component use). */
export function getClientConfig(key: string): string | null {
  return localStorage.getItem(key);
}

/** Remove a key from both localStorage and backend. */
export function removeClientConfig(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  void apiFetch("/qwenpaw-voice/client-config", {
    method: "PUT",
    body: JSON.stringify({ [key]: "" }),
  }).catch(() => {});
}
