/**
 * i18n.ts — plugin-local translations WITHOUT react-i18next.
 *
 * react-i18next bundles its own `import "react"`, which fails when the plugin
 * is loaded as an ES-module blob URL (no module resolution).  Following the
 * proven qwenpaw-pet pattern, we keep a local message table and a tiny
 * host-React-based `useTranslation` that tracks the console language.
 *
 * The console persists the active language in `localStorage.language` and
 * reloads on change, so reading it (plus a storage listener) is enough.
 */
import { getHost } from "./host";

const React = getHost().React;

export type VoiceLocale = "zh" | "en";

const messages = {
  en: {
    title: "Voice Input",
    description:
      "Volcengine BigModel streaming ASR: real-time voice-to-text with configurable shortcuts, plus a master switch that falls back to the built-in voice input.",
    toggleTitle: "Real-time Voice Input",
    toggleDesc:
      "When on, use this plugin's streaming voice input (Volcengine ASR) in chat. When off, the plugin mic and shortcuts go offline and the built-in official voice input is used instead.",
    toggleOn: "On · Streaming voice input",
    toggleOff: "Off · Built-in voice input",
    volcengineConfigTitle: "Volcengine ASR Configuration",
    volcengineConfigDesc:
      "Enter the API Key and Resource ID for the Volcengine speech service. Find them in the Volcengine console under Doubao Speech → Streaming ASR.",
    volcengineApiKeyLabel: "API Key",
    volcengineApiKeyPlaceholder: "Enter the Volcengine ASR API Key",
    volcengineResourceIdLabel: "Resource ID",
    volcengineResourceIdPlaceholder: "volc.bigasr.sauc.duration",
    volcengineNotConfigured: "Not configured yet — click Edit to add credentials",
    testConnection: "Test Connection",
    testing: "Testing...",
    testConnected: "Connected",
    testSuccess: "Connection succeeded! Voice input is ready.",
    testFailed: "Connection failed. Check your credentials.",
    shortcutTitle: "Shortcut Settings",
    shortcutDesc:
      "Set the global shortcut for voice input. Supports toggle (press to start/stop) and hold (press and hold to talk).",
    shortcutKey: "Shortcut",
    shortcutCapturing: "Press a key combination...",
    shortcutMode: "Trigger Mode",
    shortcutModeToggle: "Toggle",
    shortcutModeToggleDesc: "Press to start recording, press again to stop.",
    shortcutModeHold: "Hold",
    shortcutModeHoldDesc: "Hold to record, release to stop.",
    // chat.speech.*
    startRecording: "Start Recording",
    stopRecording: "Stop Recording",
    transcribing: "Transcribing...",
    transcriptionFailed: "Voice transcription failed",
    microphoneError: "Could not access microphone",
    recordingTooLong: "Recording exceeds duration limit ({{limit}}s)",
    notConnected: "Voice service not connected. Test the connection in Settings.",
    cancel: "Cancel",
    save: "Save",
    edit: "Edit",
  },
  zh: {
    title: "语音输入",
    description:
      "火山引擎大模型流式语音识别：聊天内实时语音转文字、可配置快捷键，并支持一键回退官方内置语音输入。",
    toggleTitle: "实时语音输入",
    toggleDesc:
      "开启后使用本插件的流式实时语音输入（火山引擎 ASR）；关闭后插件麦克风与快捷键下线，回退官方内置语音输入功能。",
    toggleOn: "已开启 · 实时语音输入",
    toggleOff: "已关闭 · 官方内置语音",
    volcengineConfigTitle: "火山引擎 ASR 配置",
    volcengineConfigDesc:
      "填写火山引擎语音识别服务的 API Key 和 Resource ID。可在火山引擎控制台「豆包语音 → 语音识别大模型」中获取。",
    volcengineApiKeyLabel: "API Key",
    volcengineApiKeyPlaceholder: "请输入火山引擎语音识别 API Key",
    volcengineResourceIdLabel: "Resource ID",
    volcengineResourceIdPlaceholder: "volc.bigasr.sauc.duration",
    volcengineNotConfigured: "尚未配置，请点击编辑按钮添加凭据",
    testConnection: "测试连通性",
    testing: "测试中...",
    testConnected: "已连接",
    testSuccess: "连接成功！语音输入已就绪。",
    testFailed: "连接失败，请检查凭据配置。",
    shortcutTitle: "快捷键设置",
    shortcutDesc:
      "设置语音输入的全局快捷键。支持单机模式（按一下开/关）和长按模式（按住说话，松开结束）。",
    shortcutKey: "快捷键",
    shortcutCapturing: "请按下组合键...",
    shortcutMode: "触发模式",
    shortcutModeToggle: "单机模式",
    shortcutModeToggleDesc: "按下快捷键开始录音，再次按下结束录音。",
    shortcutModeHold: "长按模式",
    shortcutModeHoldDesc: "按住快捷键开始录音，松开即结束。",
    // chat.speech.*
    startRecording: "开始语音录制",
    stopRecording: "停止录制",
    transcribing: "正在转录...",
    transcriptionFailed: "语音转录失败",
    microphoneError: "无法访问麦克风",
    recordingTooLong: "录音时长超过限制（{{limit}}秒）",
    notConnected: "语音服务未连接，请先在设置中测试连通性",
    cancel: "取消",
    save: "保存",
    edit: "编辑",
  },
} as const;

export type MessageKey = keyof typeof messages.en;

/** Read the console's active language (defaults to English). */
export function readLocale(): VoiceLocale {
  try {
    const lang =
      localStorage.getItem("language") ||
      localStorage.getItem("i18nextLng") ||
      "";
    return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** Translate a key with `{{var}}` interpolation. */
export function translate(
  locale: VoiceLocale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let s: string = messages[locale][key] ?? messages.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
    }
  }
  return s;
}

/**
 * React hook compatible with the subset of react-i18next's `t()` the plugin
 * uses.  Re-renders when the console language changes (storage event).
 */
export function useTranslation() {
  const [locale, setLocale] = React.useState<VoiceLocale>(readLocale);

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "language" || e.key === "i18nextLng") {
        setLocale(readLocale());
      }
    };
    window.addEventListener("storage", onStorage);
    // Also poll once on mount in case the same-tab language switch already
    // happened (storage events only fire across tabs).
    setLocale(readLocale());
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const t = React.useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(locale, key as MessageKey, params),
    [locale],
  );

  return { t, locale };
}

/** Kept for API compatibility with index.tsx; messages are local now. */
export function installPluginI18n(): void {
  /* no-op */
}
