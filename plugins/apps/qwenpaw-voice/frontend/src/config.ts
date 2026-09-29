/**
 * config.ts — plugin-local configuration keys + connection state.
 *
 * Consolidates the helpers that used to live scattered across
 * VolcengineConfigCard / ShortcutSettings so the plugin
 * has a single source of truth.
 */
import { apiFetch } from "./host";
import {
  getClientConfig,
  removeClientConfig,
  saveClientConfig,
} from "./clientConfig";

// ── localStorage / client-config keys ────────────────────────────────────
export const KEY_CONNECTION_FLAG = "voice_connected";
export const KEY_SHORTCUT = "qwenpaw_voice_shortcut";
export const KEY_SHORTCUT_MODE = "qwenpaw_voice_shortcut_mode";
/** 实时语音总开关（"0" = 关闭，缺省 = 开启）。宿主 Chat 页也直接读此键。 */
export const KEY_VOICE_ENABLED = "qwenpaw_voice_enabled";

/** 切换开关后同 tab 通知宿主 Chat 页的自定义事件（storage 只跨 tab）。 */
export const VOICE_ENABLED_CHANGE_EVENT = "qwenpaw-voice-change";

// ── env-store keys for Volcengine credentials ────────────────────────────
export const ENV_API_KEY = "volcengine_asr_api_key";
export const ENV_RESOURCE_ID = "volcengine_asr_resource_id";

export const DEFAULT_RESOURCE_ID = "volc.bigasr.sauc.duration";

// ── Connection flag ──────────────────────────────────────────────────────
export function clearVoiceConnectionFlag(): void {
  removeClientConfig(KEY_CONNECTION_FLAG);
}

export function isVoiceConnected(): boolean {
  return getClientConfig(KEY_CONNECTION_FLAG) === "1";
}

export async function setVoiceConnected(): Promise<void> {
  await saveClientConfig(KEY_CONNECTION_FLAG, "1");
}

// ── 实时语音总开关 ───────────────────────────────────────────────────────
// 开启（默认）：本插件实时流式语音输入（火山引擎 ASR）。
// 关闭：回退官方内置语音（WhisperSpeechButton / SDK allowSpeech）。
// 宿主 Chat 页通过 KEY_VOICE_ENABLED + VOICE_ENABLED_CHANGE_EVENT 同步。

/** 插件实时语音是否开启（默认开启）。 */
export function loadVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY_VOICE_ENABLED) !== "0";
  } catch {
    return true;
  }
}

/** 切换插件实时语音；持久化并同 tab / 跨 tab 通知宿主。 */
export async function saveVoiceEnabled(enabled: boolean): Promise<void> {
  const val = enabled ? "1" : "0";
  try {
    localStorage.setItem(KEY_VOICE_ENABLED, val);
  } catch {
    /* ignore */
  }
  try {
    await saveClientConfig(KEY_VOICE_ENABLED, val);
  } catch {
    /* backend not available */
  }
  // storage 事件只跨 tab 触发；同 tab 的 Chat 页依赖该自定义事件刷新。
  try {
    window.dispatchEvent(new CustomEvent(VOICE_ENABLED_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
}

// ── Shortcut types + persistence ─────────────────────────────────────────
export interface ShortcutDef {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  code: string; // event.code e.g. "KeyM"
}

export type ShortcutMode = "toggle" | "hold";

function isMac(): boolean {
  return /Mac|iP(hone|[ao]d)/.test(navigator.platform || navigator.userAgent);
}

export function defaultShortcut(): ShortcutDef {
  const mac = isMac();
  return { ctrl: !mac, shift: true, alt: false, meta: mac, code: "KeyM" };
}

export function loadShortcut(): ShortcutDef {
  try {
    const raw = localStorage.getItem(KEY_SHORTCUT);
    if (raw) return JSON.parse(raw) as ShortcutDef;
  } catch {
    /* ignore */
  }
  return defaultShortcut();
}

export function loadShortcutMode(): ShortcutMode {
  return localStorage.getItem(KEY_SHORTCUT_MODE) === "hold" ? "hold" : "toggle";
}

export async function saveShortcutConfig(
  def: ShortcutDef,
  mode: ShortcutMode,
): Promise<void> {
  localStorage.setItem(KEY_SHORTCUT, JSON.stringify(def));
  localStorage.setItem(KEY_SHORTCUT_MODE, mode);
  try {
    await saveClientConfig(KEY_SHORTCUT, JSON.stringify(def));
    await saveClientConfig(KEY_SHORTCUT_MODE, mode);
  } catch {
    /* backend not available */
  }
}

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

export function matchShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  if (MODIFIER_CODES.has(def.code)) return e.code === def.code;
  return (
    e.ctrlKey === def.ctrl &&
    e.shiftKey === def.shift &&
    e.altKey === def.alt &&
    e.metaKey === def.meta &&
    e.code === def.code
  );
}

export function formatShortcut(def: ShortcutDef): string {
  const mac = isMac();
  const modifierCodes: Record<string, string> = {
    AltLeft: mac ? "⌥" : "Alt",
    AltRight: mac ? "⌥" : "Alt",
    ControlLeft: mac ? "⌃" : "Ctrl",
    ControlRight: mac ? "⌃" : "Ctrl",
    ShiftLeft: mac ? "⇧" : "Shift",
    ShiftRight: mac ? "⇧" : "Shift",
    MetaLeft: mac ? "⌘" : "Win",
    MetaRight: mac ? "⌘" : "Win",
  };
  if (modifierCodes[def.code]) return modifierCodes[def.code];
  const parts: string[] = [];
  if (def.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (def.alt) parts.push(mac ? "⌥" : "Alt");
  if (def.shift) parts.push(mac ? "⇧" : "Shift");
  if (def.meta) parts.push(mac ? "⌘" : "Win");
  const keyName = def.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("Comma", ",")
    .replace("Period", ".")
    .replace("Slash", "/")
    .replace("Backslash", "\\")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Minus", "-")
    .replace("Equal", "=")
    .replace("Semicolon", ";")
    .replace("Quote", "'")
    .replace("Backquote", "`")
    .replace("Space", "Space");
  parts.push(keyName);
  return parts.join(mac ? "" : "+");
}

// ── Volcengine credentials (env store) + plugin backend ─────────────────

/** Read the saved Volcengine credentials from the envs store. */
export async function loadVolcCredentials(): Promise<{
  apiKey: string;
  resourceId: string;
}> {
  try {
    const res = await apiFetch("/envs");
    if (!res.ok) throw new Error("envs fetch failed");
    const envs = (await res.json()) as Array<{ key: string; value: string }>;
    const vars: Record<string, string> = {};
    for (const v of envs) vars[v.key] = v.value;
    return {
      apiKey: vars[ENV_API_KEY] ?? "",
      resourceId: vars[ENV_RESOURCE_ID] ?? DEFAULT_RESOURCE_ID,
    };
  } catch {
    return { apiKey: "", resourceId: DEFAULT_RESOURCE_ID };
  }
}

/** Persist Volcengine credentials into the envs store. */
export async function saveVolcCredentials(
  apiKey: string,
  resourceId: string,
): Promise<void> {
  const res = await apiFetch("/envs");
  const newEnvs: Record<string, string> = {};
  if (res.ok) {
    const current = (await res.json()) as Array<{ key: string; value: string }>;
    for (const v of current) newEnvs[v.key] = v.value;
  }
  // Old-console creds are mutually exclusive with the new API key flow.
  delete newEnvs["volcengine_asr_app_id"];
  delete newEnvs["volcengine_asr_access_token"];
  if (apiKey) newEnvs[ENV_API_KEY] = apiKey;
  else delete newEnvs[ENV_API_KEY];
  newEnvs[ENV_RESOURCE_ID] = resourceId || DEFAULT_RESOURCE_ID;
  // envApi.saveEnvs sends a flat record (full replacement), not {envs: ...}.
  await apiFetch("/envs", {
    method: "PUT",
    body: JSON.stringify(newEnvs),
  });
}

/** Test connectivity through the plugin backend. */
export async function testVoiceConnection(credentials?: {
  api_key: string;
  resource_id: string;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch("/qwenpaw-voice/voice-test-connection", {
    method: "POST",
    body: JSON.stringify(credentials ?? {}),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}
