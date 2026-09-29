/**
 * index.tsx — voice plugin entry point.
 *
 * Registers the voice feature with the console host WITHOUT touching any
 * upstream file:
 *  - `menu.add` + `route.add`  → the settings page (`/qwenpaw-voice`)
 *  - `chat.sender.addPrefix`   → the streaming microphone button
 *  - a global shortcut listener (toggle / hold)
 *  - a submit interceptor (stop recording + reset ASR session on send)
 *
 * Master switch (`qwenpaw_voice_enabled`, default on):
 *  - ON  → this plugin's streaming voice input (mic via senderPrefix).
 *  - OFF → the plugin mounts nothing; the host Chat page falls back to the
 *    built-in official voice input (WhisperSpeechButton / SDK allowSpeech).
 *
 * All chat integration is DOM-driven so the host Chat page stays stock.
 */
import { getHost, getQwenPaw } from "./host";
import { installPluginI18n, readLocale, translate } from "./i18n";
import { loadClientConfig } from "./clientConfig";
import {
  KEY_VOICE_ENABLED,
  VOICE_ENABLED_CHANGE_EVENT,
  isVoiceConnected,
  loadShortcut,
  loadVoiceEnabled,
  loadShortcutMode,
  matchShortcut,
} from "./config";
import SpeechButton, { type SpeechButtonRef } from "./SpeechButton";
import { useVoiceInput } from "./useVoiceInput";
import VoiceSettingsPage from "./SettingsPage";

const PLUGIN_ID = "qwenpaw-voice";
const { React, antdIcons } = getHost();
const { useEffect, useRef, useState } = React;

// Mic glyph for the sidebar menu entry. antd's AudioOutlined is the mic icon;
// fall back to an emoji when the host does not expose antd icons.
const MicMenuIcon = antdIcons?.AudioOutlined ? (
  React.createElement(antdIcons.AudioOutlined)
) : (
  "🎤"
);

// ── Sender prefix: mic button (only while the master switch is on) ──────

function VoiceSenderPrefix() {
  const speechRef = useRef<SpeechButtonRef>(null);
  const voice = useVoiceInput();
  const [voiceEnabled, setVoiceEnabled] = useState(loadVoiceEnabled);

  // Master-switch sync: custom event for same-tab toggles (the settings page
  // is in the same SPA), storage event for cross-tab changes.
  useEffect(() => {
    const readFlag = () => setVoiceEnabled(loadVoiceEnabled());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_VOICE_ENABLED) readFlag();
    };
    window.addEventListener(VOICE_ENABLED_CHANGE_EVENT, readFlag);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VOICE_ENABLED_CHANGE_EVENT, readFlag);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Submit interception: stop recording + reset the ASR session when the
  // user sends a message.  We listen for Enter on the sender textarea and
  // for clicks on any send button, in capture phase so we run before the
  // host's own submit handler.
  useEffect(() => {
    const stopVoice = () => {
      if (speechRef.current?.isRecording()) {
        speechRef.current.toggleRecording();
      }
      speechRef.current?.resetSession();
      voice.stopOnSubmit();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== "TEXTAREA") return;
      // Plain Enter (no Shift) submits in the chat sender.
      if (e.key === "Enter" && !e.shiftKey) {
        stopVoice();
      }
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest(
        'button, [role="button"]',
      ) as HTMLElement | null;
      if (!el) return;
      const label = (
        el.getAttribute("aria-label") ||
        el.className ||
        ""
      ).toLowerCase();
      if (label.includes("send")) stopVoice();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("click", onClick, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global shortcut (toggle / hold), active on chat + coding pages.
  // Only while the master switch is on — the host Chat page registers its
  // own built-in Ctrl/Cmd+Shift+M handler for the fallback path.
  useEffect(() => {
    if (!voiceEnabled) return;
    let shortcut = loadShortcut();
    let mode = loadShortcutMode();
    let holdActive = false;

    const isChatScope = () => {
      const p = window.location.pathname;
      return p.startsWith("/chat") || p.startsWith("/coding");
    };

    const onStorage = () => {
      shortcut = loadShortcut();
      mode = loadShortcutMode();
    };
    window.addEventListener("storage", onStorage);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isChatScope()) return;
      if (!isVoiceConnected()) return;
      if (!matchShortcut(e, shortcut)) return;
      e.preventDefault();
      if (mode === "hold") {
        if (speechRef.current && !speechRef.current.isRecording()) {
          speechRef.current.toggleRecording();
          holdActive = true;
        }
      } else {
        speechRef.current?.toggleRecording();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (mode !== "hold" || !holdActive) return;
      if (!matchShortcut(e, shortcut)) return;
      e.preventDefault();
      if (speechRef.current?.isRecording()) {
        speechRef.current.toggleRecording();
      }
      holdActive = false;
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("storage", onStorage);
    };
  }, [voiceEnabled]);

  // Plugin ON: hijack the SDK speech button's click (capture phase) to
  // trigger the plugin's streaming recording instead of the SDK's built-in
  // speech recognition.  The SDK button stays in its original position
  // (before the attachment button) with its native look — open/close is
  // completely transparent to the input bar.
  useEffect(() => {
    if (!voiceEnabled) return;
    const onMicClick = (e: MouseEvent) => {
      const icon = (e.target as HTMLElement | null)?.closest(
        ".spark-icon-spark-mic-line",
      );
      if (!icon) return;
      const btn = icon.closest("button");
      if (!btn) return;
      // Our hidden SpeechButton wrapper has pointerEvents:none, so this
      // click is from the visible SDK speech button.
      e.stopPropagation();
      e.preventDefault();
      speechRef.current?.toggleRecording();
    };
    document.addEventListener("click", onMicClick, true);
    return () => document.removeEventListener("click", onMicClick, true);
  }, [voiceEnabled]);

  // Recording state feedback: style the SDK speech button (color) so the
  // user sees when the plugin is recording / transcribing.
  useEffect(() => {
    if (!voiceEnabled) return;
    const tick = () => {
      const rec = speechRef.current?.isRecording();
      const loading = speechRef.current?.isLoading();
      const icons = document.querySelectorAll(".spark-icon-spark-mic-line");
      for (const icon of Array.from(icons)) {
        const btn = icon.closest("button") as HTMLButtonElement | null;
        if (btn && btn.offsetParent !== null) {
          btn.style.color = rec || loading ? "#1890ff" : "";
          break;
        }
      }
    };
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [voiceEnabled]);

  // Master switch off → render nothing; the host falls back to the
  // built-in official voice input.
  if (!voiceEnabled) return null;

  // Render a visually-hidden SpeechButton that provides the actual
  // recording logic (WebSocket, PCM, transcription callbacks).  It is
  // never seen or clicked directly — the visible SDK speech button serves
  // as the UI, and its clicks are hijacked above to drive this instance.
  return (
    <div
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      <SpeechButton
        ref={speechRef}
        onTranscription={voice.handleTranscription}
        onStart={voice.onStart}
      />
    </div>
  );
}

// ── Registration ────────────────────────────────────────────────────────

function register() {
  const ns = getQwenPaw();
  if (!ns) {
    console.warn("[qwenpaw-voice] window.QwenPaw not ready");
    return;
  }

  installPluginI18n();
  // Restore persisted client config (incl. the master switch), then
  // broadcast once so already-mounted consumers (Chat page's pluginVoiceOn,
  // VoiceSenderPrefix) re-read the restored localStorage value — this is
  // what makes the switch survive restarts even when localStorage was
  // wiped by a Tauri port change.
  void loadClientConfig().then(() => {
    try {
      window.dispatchEvent(new CustomEvent(VOICE_ENABLED_CHANGE_EVENT));
    } catch {
      /* ignore */
    }
  });

  // Settings route + menu entry ("语音输入" with a mic icon).
  if (ns.route?.add) {
    ns.route.add(PLUGIN_ID, {
      id: "qwenpaw-voice.settings",
      path: "/qwenpaw-voice",
      component: VoiceSettingsPage,
    });
  }
  if (ns.menu?.add) {
    ns.menu.add(PLUGIN_ID, {
      id: "qwenpaw-voice.settings",
      location: "primary.settings",
      parentId: "core.settings-group",
      label: () => translate(readLocale(), "title"),
      icon: MicMenuIcon,
      route: "qwenpaw-voice.settings",
      order: 50,
    });
  } else if (ns.registerRoutes) {
    // Legacy fallback: route + menu under plugins-group.
    ns.registerRoutes(PLUGIN_ID, [
      {
        path: "/qwenpaw-voice",
        component: VoiceSettingsPage,
        label: "语音输入",
        icon: "🎤",
        priority: 50,
      },
    ]);
  }

  // Chat sender prefix (mic button; renders nothing while switched off).
  if (ns.chat?.sender?.addPrefix) {
    ns.chat.sender.addPrefix(PLUGIN_ID, <VoiceSenderPrefix />, {
      id: "qwenpaw-voice.mic",
      order: 0,
    });
  } else {
    console.warn(
      "[qwenpaw-voice] chat.sender.addPrefix unavailable; mic not mounted",
    );
  }

  console.info("[qwenpaw-voice] registered");
}

// The host installs window.QwenPaw before loading plugin bundles, but guard
// against ordering differences with a short retry.
if (getQwenPaw()) {
  register();
} else {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (getQwenPaw()) {
      clearInterval(timer);
      register();
    } else if (attempts > 50) {
      clearInterval(timer);
      console.error("[qwenpaw-voice] host never became available");
    }
  }, 100);
}
