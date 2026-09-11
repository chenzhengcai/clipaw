import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { WhisperSpeechButtonRef } from "../components/WhisperSpeechButton";
import { setTextareaValue } from "../utils";
import { agentApi } from "@/api/modules/agent";

/**
 * useVoiceChatInput — fork 专属语音输入集成（Chat 页）
 * ─────────────────────────────────────────────────────────────────────────────
 * 设计文档：docs/customs/voice-transcription.md（功能）
 *           docs/customs/voice-streaming-replace-regression.md（回归修复）
 *
 * 从 Chat/index.tsx 抽出，最小化与上游的冲突面：上游文件只保留
 * hook 调用 + WhisperSpeechButton 挂载 + 提交路径的一行停止调用。
 *
 * 职责：
 *  1. whisperEnabled/whisperChecked — 探测 ASR provider 是否启用
 *  2. handleWhisperTranscription — 流式替换式转写（火山 partial 为累积
 *     全文，必须替换语音段而非追加；voiceBaseRef/voiceLenRef 记录边界；
 *     voiceSessionActiveRef 丢弃发送后迟到的 partial/final 帧）
 *  3. voiceOnStart — 录音开始时捕获输入框基线文本
 *  4. stopVoiceOnSubmit — 发送时停止录音 + 重置 ASR 会话 + 清边界
 *  5. 快捷键 — 读 clientConfig 的 qwenpaw_voice_shortcut(_mode)，
 *     支持 toggle/hold 双模式，作用域 chat + /coding，storage 事件热更新
 */
export function useVoiceChatInput({
  isChatActive,
}: {
  isChatActive: () => boolean;
}) {
  const location = useLocation();
  const whisperSpeechRef = useRef<WhisperSpeechButtonRef>(null);
  const voiceBaseRef = useRef(""); // text before voice started
  const voiceLenRef = useRef(0); // length of voice text in textarea
  // True between onStart and the submit-time stop. Late partial/final frames
  // that arrive after sending are ignored so the cleared input stays clean.
  const voiceSessionActiveRef = useRef(false);
  const [whisperEnabled, setWhisperEnabled] = useState(false);
  const [whisperChecked, setWhisperChecked] = useState(false);

  // Check if Whisper transcription is configured
  useEffect(() => {
    agentApi
      .getTranscriptionProviderType()
      .then((res) => {
        setWhisperEnabled(res.transcription_provider_type !== "disabled");
      })
      .catch(() => setWhisperEnabled(false))
      .finally(() => setWhisperChecked(true));
  }, []);

  // Track voice-inserted text to replace (not append) cumulative ASR results.
  // Volcengine partial frames carry the full recognized-so-far text, so the
  // voice portion of the input must be replaced, never appended.
  const handleWhisperTranscription = useCallback(
    (text: string, isPartial = false) => {
      if (!voiceSessionActiveRef.current) return;
      const senderContainer = document.querySelector('[class*="sender"]');
      const textarea = senderContainer?.querySelector(
        "textarea",
      ) as HTMLTextAreaElement | null;
      if (!textarea) return;

      const current = textarea.value || "";

      if (isPartial) {
        // Replace the voice portion: keep prefix, append new voice text
        const prefixLen = current.length - voiceLenRef.current;
        const prefix = prefixLen > 0 ? current.slice(0, prefixLen) : "";
        voiceLenRef.current = text.length;
        const newValue = prefix ? `${prefix}${text}` : text;
        setTextareaValue(textarea, newValue);
      } else {
        // Final: keep what was there before voice started, append final text
        voiceLenRef.current = 0;
        const newValue = voiceBaseRef.current
          ? `${voiceBaseRef.current}${text}`
          : text;
        setTextareaValue(textarea, newValue);
      }
      textarea.focus();
    },
    [],
  );

  // Capture the pre-voice textarea content as the replace base.
  const voiceOnStart = useCallback(() => {
    const textarea = document
      .querySelector('[class*="sender"]')
      ?.querySelector("textarea") as HTMLTextAreaElement | null;
    voiceBaseRef.current = textarea?.value || "";
    voiceLenRef.current = 0;
    voiceSessionActiveRef.current = true;
  }, []);

  // Submit-time cleanup: stop recording, reset the ASR session, and clear the
  // replace boundaries. Call from both the direct-send and queue paths of
  // the sender's beforeSubmit.
  const stopVoiceOnSubmit = useCallback(() => {
    if (whisperSpeechRef.current?.isRecording()) {
      whisperSpeechRef.current?.toggleRecording();
    }
    whisperSpeechRef.current?.resetSession();
    voiceBaseRef.current = "";
    voiceLenRef.current = 0;
    voiceSessionActiveRef.current = false;
  }, []);

  // Voice shortcut — configurable, supports toggle and hold modes
  const shortcutCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import(
        "@/pages/Settings/VoiceTranscription/components/ShortcutSettings"
      ),
      import(
        "@/pages/Settings/VoiceTranscription/components/VolcengineConfigCard"
      ),
    ]).then(([shortcutMod, voiceMod]) => {
      if (cancelled) return;
      const { loadShortcut, loadShortcutMode, matchShortcut } = shortcutMod;
      const { isVoiceConnected } = voiceMod;

      let shortcut = loadShortcut();
      let mode = loadShortcutMode();
      let holdActive = false;

      const onStorage = () => {
        shortcut = loadShortcut();
        mode = loadShortcutMode();
      };
      window.addEventListener("storage", onStorage);

      const onKeyDown = (e: KeyboardEvent) => {
        if (!isChatActive() && !location.pathname.startsWith("/coding"))
          return;
        if (!whisperEnabled) return;
        if (!isVoiceConnected()) return;
        if (!matchShortcut(e, shortcut)) return;

        e.preventDefault();
        if (mode === "hold") {
          if (!whisperSpeechRef.current?.isRecording()) {
            whisperSpeechRef.current?.toggleRecording();
            holdActive = true;
          }
        } else {
          whisperSpeechRef.current?.toggleRecording();
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (mode !== "hold" || !holdActive) return;
        if (!matchShortcut(e, shortcut)) return;
        e.preventDefault();
        if (whisperSpeechRef.current?.isRecording()) {
          whisperSpeechRef.current?.toggleRecording();
        }
        holdActive = false;
      };

      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      shortcutCleanupRef.current = () => {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("storage", onStorage);
      };
    });

    return () => {
      cancelled = true;
      shortcutCleanupRef.current?.();
    };
  }, [isChatActive, whisperEnabled, location.pathname]);

  return {
    whisperSpeechRef,
    whisperEnabled,
    whisperChecked,
    handleWhisperTranscription,
    voiceOnStart,
    stopVoiceOnSubmit,
  };
}
