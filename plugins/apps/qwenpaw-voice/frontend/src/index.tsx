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
const MicMenuIcon = antdIcons?.AudioOutlined
  ? React.createElement(antdIcons.AudioOutlined)
  : "🎤";

// ── Host microphone discovery (DOM-driven) ──────────────────────────────
//
// The visible microphone belongs to the host, and *which* button it is
// depends on the host build:
//
//   * SDK `allowSpeech` mic   → `span.spark-icon-spark-mic-line`
//   * official Whisper button → lucide `mic` (idle) / `loader-circle` (busy)
//                               / `<title>Speech Recording</title>`
//
// The fork's Chat page used to force the SDK mic on while this plugin was
// enabled, so hijacking that single button was enough.  When that host-side
// gate is missing (upstream sync, or `allowSpeech` off because a Whisper
// provider is configured) the SDK mic is not rendered at all: only the
// official Whisper button is left, the hijack finds nothing, and the click
// runs the host's own (often unconfigured) transcription instead — the
// "clicking the mic inputs nothing" regression.
//
// So the plugin now hijacks *any* host mic it can find, and only when the
// host renders none at all does it fall back to its own button in the sender
// prefix slot.
const PLUGIN_MIC_ATTR = "data-qwenpaw-voice-mic";

/** True for DOM owned by this plugin (never hijacked). */
function isPluginMic(node: Element | null): boolean {
  return Boolean(node?.closest(`[${PLUGIN_MIC_ATTR}]`));
}

/** True when `btn` is one of the host's microphone buttons. */
function isHostMicButton(btn: Element | null): boolean {
  if (!btn || isPluginMic(btn)) return false;
  // SDK `allowSpeech` mic.
  if (btn.querySelector(".spark-icon-spark-mic-line")) return true;
  // Official Whisper button: lucide `mic` while idle.  Its busy state uses a
  // generic spinner, which is deliberately NOT matched — other prefix buttons
  // (model selectors etc.) show the same spinner while loading.
  if (btn.querySelector("svg.lucide-mic")) return true;
  // Official Whisper button while it is recording.
  for (const title of Array.from(btn.querySelectorAll("svg > title"))) {
    if ((title.textContent || "").trim() === "Speech Recording") return true;
  }
  return false;
}

/** Scope that holds the sender microphones (prefix row of the SDK sender). */
function senderMicScope(): Element | null {
  return (
    document.querySelector('[class$="-sender-prefix"]') ||
    document.querySelector('[class*="sender"]')
  );
}

/** All host microphone buttons currently rendered in the sender. */
function hostMicButtons(): HTMLButtonElement[] {
  const scope = senderMicScope();
  if (!scope) return [];
  const found: HTMLButtonElement[] = [];
  for (const btn of Array.from(scope.querySelectorAll("button"))) {
    if (isHostMicButton(btn)) found.push(btn as HTMLButtonElement);
  }
  return found;
}

// ── Sender prefix: mic button (only while the master switch is on) ──────

function VoiceSenderPrefix() {
  const speechRef = useRef<SpeechButtonRef>(null);
  const voice = useVoiceInput();
  const [voiceEnabled, setVoiceEnabled] = useState(loadVoiceEnabled);
  // False while a host mic button exists (it is hijacked and serves as the
  // UI); true when the host renders none, so we show our own button.
  const [ownMicVisible, setOwnMicVisible] = useState(false);

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
      // Strip the "/console" router basename first: in the packaged Tauri
      // desktop app the webview navigates to the backend-hosted console
      // (http://127.0.0.1:<port>/console/chat/...), so the raw pathname
      // starts with "/console" — without stripping, this check (and the
      // shortcut with it) silently dies in the desktop build while working
      // in the browser (root-served SPA, pathname "/chat/..."). The host
      // ChatPage uses react-router's location, which already strips the
      // basename — that's why the built-in shortcut keeps working.
      const p = window.location.pathname.replace(/^\/console(?=\/|$)/, "");
      return p.startsWith("/chat") || p.startsWith("/coding");
    };

    const onStorage = () => {
      shortcut = loadShortcut();
      mode = loadShortcutMode();
    };
    window.addEventListener("storage", onStorage);

    // Shared press/release semantics so both the plugin's own shortcut and the
    // intercepted built-in one behave the same in "toggle" and "hold" modes.
    const press = () => {
      if (mode === "hold") {
        if (speechRef.current && !speechRef.current.isRecording()) {
          speechRef.current.toggleRecording();
          holdActive = true;
        }
      } else {
        speechRef.current?.toggleRecording();
      }
    };

    const release = () => {
      if (mode !== "hold" || !holdActive) return;
      if (speechRef.current?.isRecording()) {
        speechRef.current.toggleRecording();
      }
      holdActive = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isChatScope()) return;
      if (!isVoiceConnected()) return;
      if (!matchShortcut(e, shortcut)) return;
      e.preventDefault();
      press();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!matchShortcut(e, shortcut)) return;
      e.preventDefault();
      release();
    };

    // The host's built-in Ctrl/Cmd+Shift+M stays active whenever a Whisper
    // provider is configured, and it runs the host's own one-shot
    // transcription (unavailable unless that provider is set up).  While this
    // plugin is on, that shortcut belongs to the plugin: intercept it in the
    // capture phase so the host handler never fires.
    const isBuiltinShortcut = (e: KeyboardEvent) =>
      (e.ctrlKey || e.metaKey) &&
      e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === "m";

    const onBuiltinKeyDown = (e: KeyboardEvent) => {
      if (!isBuiltinShortcut(e)) return;
      if (!isChatScope() || !isVoiceConnected()) return;
      e.preventDefault();
      e.stopPropagation();
      press();
    };

    const onBuiltinKeyUp = (e: KeyboardEvent) => {
      if (!isBuiltinShortcut(e)) return;
      if (!holdActive) return;
      e.stopPropagation();
      release();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onBuiltinKeyDown, true);
    document.addEventListener("keyup", onBuiltinKeyUp, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onBuiltinKeyDown, true);
      document.removeEventListener("keyup", onBuiltinKeyUp, true);
      window.removeEventListener("storage", onStorage);
    };
  }, [voiceEnabled]);

  // Plugin ON: hijack the host microphone's click (capture phase) so it runs
  // this plugin's streaming recording instead of the host's own handler.
  // Works for both host variants: the SDK `allowSpeech` mic and the official
  // Whisper button.  The button keeps its native look and position.
  useEffect(() => {
    if (!voiceEnabled) return;
    const onMicClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || isPluginMic(target)) return;
      const btn = target.closest("button");
      if (!isHostMicButton(btn)) return;
      e.stopPropagation();
      e.preventDefault();
      speechRef.current?.toggleRecording();
    };
    document.addEventListener("click", onMicClick, true);
    return () => document.removeEventListener("click", onMicClick, true);
  }, [voiceEnabled]);

  // Host mic presence + recording state feedback.
  //
  //  - A host mic exists  → keep our own button hidden and hijacked (the host
  //    button is the UI, as before).
  //  - No host mic at all → render our own button in the sender prefix slot,
  //    so voice input never silently disappears.
  //
  // The 200 ms tick also recolours the active host mic while recording or
  // transcribing, because the host button never enters that state itself.
  useEffect(() => {
    if (!voiceEnabled) return;

    const sync = () => {
      const hostMics = hostMicButtons();
      const ownMicNeeded = hostMics.length === 0;
      setOwnMicVisible((prev) => (prev === ownMicNeeded ? prev : ownMicNeeded));

      const recording = speechRef.current?.isRecording();
      const loading = speechRef.current?.isLoading();
      for (const btn of hostMics) {
        if (btn.offsetParent !== null) {
          btn.style.color = recording || loading ? "#1890ff" : "";
          break;
        }
      }
    };

    sync();
    const id = setInterval(sync, 200);
    return () => clearInterval(id);
  }, [voiceEnabled]);

  // Master switch off → render nothing; the host falls back to the
  // built-in official voice input.
  if (!voiceEnabled) return null;

  // The SpeechButton provides the recording logic (WebSocket, PCM,
  // transcription callbacks).
  //
  //  - ownMicVisible = false → visually hidden: the hijacked host mic button
  //    is the UI (identical look and position, no duplicate mic).
  //  - ownMicVisible = true  → rendered inline in the sender prefix row, so
  //    the plugin still works when the host renders no mic at all.
  const wrapperStyle: React.CSSProperties = ownMicVisible
    ? { display: "inline-flex", alignItems: "center" }
    : {
        position: "absolute",
        width: 0,
        height: 0,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      };

  return (
    <span
      {...{ [PLUGIN_MIC_ATTR]: "1" }}
      style={wrapperStyle}
      aria-hidden={ownMicVisible ? undefined : true}
    >
      <SpeechButton
        ref={speechRef}
        onTranscription={voice.handleTranscription}
        onStart={voice.onStart}
      />
    </span>
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
