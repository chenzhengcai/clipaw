/**
 * clientConfig.ts — 客户端配置持久化（fork 专属文件，非上游文件）
 *
 * Tauri 桌面端每次启动可能使用不同端口，localStorage 基于 origin，
 * 端口变化后数据丢失。通过后端文件存储解决此问题。
 *
 * 说明：语音相关的同步键（voice_connected / qwenpaw_voice_shortcut /
 * qwenpaw_voice_shortcut_mode）已随语音功能迁移到
 * plugins/apps/qwenpaw-voice 插件（插件自带 clientConfig 实现，走
 * /api/qwenpaw-voice/client-config）。此处仅保留与语音无关的
 * Agent 选择持久化，供 App 启动时恢复上次使用的 Agent。
 *
 * 详见 docs/customs/agent-persistence.md
 */
import { request } from "./request";

// 客户端配置持久化端点：原先在 /workspace/client-config（已随语音功能迁出），
// 现由 qwenpaw-voice 插件以同一文件（~/.clipaw/client-config.json）提供服务。
const CLIENT_CONFIG_URL = "/qwenpaw-voice/client-config";

const SYNC_KEYS = new Set(["qwenpaw-last-used-agent"]);

let _synced = false;

/**
 * Load all client config from the backend and restore to localStorage.
 * Called once on App startup.  Backend values always overwrite localStorage
 * so config survives Tauri port changes.
 */
export async function loadClientConfig(): Promise<void> {
  if (_synced) return;
  try {
    const data = await request<Record<string, unknown>>(CLIENT_CONFIG_URL);
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
        } catch {
          /* agent store not ready */
        }
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
    await request<Record<string, unknown>>(CLIENT_CONFIG_URL, {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
  } catch {
    /* non-fatal: backend may be temporarily unavailable */
  }
}
