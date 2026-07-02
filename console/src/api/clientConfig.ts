/**
 * clientConfig.ts — 客户端配置持久化
 *
 * Tauri 桌面端每次启动可能使用不同端口，localStorage 基于 origin，
 * 端口变化后数据丢失。通过后端文件存储解决此问题。
 */
import { request } from "./request";

const SYNC_KEYS = new Set([
  "voice_connected",
  "qwenpaw_voice_shortcut",
  "qwenpaw_voice_shortcut_mode",
  "qwenpaw-last-used-agent",
]);

let _synced = false;

/**
 * Load all client config from the backend and restore to localStorage.
 * Called once on App startup.  Backend values always overwrite localStorage
 * so config survives Tauri port changes.
 */
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
      const agentId = data["qwenpaw-last-used-agent"];
      if (typeof agentId === "string" && agentId) {
        try {
          const { useAgentStore } = await import("../stores/agentStore");
          useAgentStore.getState().setSelectedAgent(agentId);
        } catch { /* agent store not ready */ }
      }
    }
  } catch {
    /* Backend not ready yet — fine, will use localStorage defaults */
  }
  _synced = true;
}

/**
 * Save a single key-value pair to the backend client-config file.
 * Also mirrors to localStorage for fast frontend access.
 */
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
    await request<Record<string, unknown>>("/workspace/client-config", {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
  } catch {
    /* non-fatal: backend may be temporarily unavailable */
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
  // Best-effort backend removal via PUT with empty value
  void request<Record<string, unknown>>("/workspace/client-config", {
    method: "PUT",
    body: JSON.stringify({ [key]: "" }),
  }).catch(() => {});
}
