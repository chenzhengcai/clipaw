/**
 * useVoiceInput.ts — replace-style streaming transcription into the sender
 * textarea.
 *
 * Ported from the fork's `console/src/pages/Chat/voice/useVoiceChatInput.ts`.
 * The plugin version is DOM-driven (it finds the sender textarea itself) so
 * the host Chat page needs zero modifications.
 *
 * Volcengine partial frames carry the full recognized-so-far text, so the
 * voice portion of the input must be *replaced*, never appended.
 */
import { getHost } from "./host";

const { React } = getHost();
const { useCallback, useRef } = React;

export interface VoiceInputController {
  handleTranscription: (text: string, isPartial?: boolean) => void;
  onStart: () => void;
  stopOnSubmit: () => void;
  /** Whether a voice session is currently active (between start & submit). */
  isActive: () => boolean;
}

/** Find the chat sender textarea (best-effort, host-version tolerant). */
function findSenderTextarea(): HTMLTextAreaElement | null {
  const sender = document.querySelector('[class*="sender"]');
  return (sender?.querySelector("textarea") as HTMLTextAreaElement) ?? null;
}

/**
 * Set a textarea's value in a way React controlled components pick up.
 * Mirrors `console/src/pages/Chat/utils.setTextareaValue`.
 */
function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(textarea);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useVoiceInput(): VoiceInputController {
  const voiceBaseRef = useRef(""); // text before voice started
  const voiceLenRef = useRef(0); // length of voice text in textarea
  // True between onStart and the submit-time stop. Late partial/final frames
  // that arrive after sending are ignored so the cleared input stays clean.
  const voiceSessionActiveRef = useRef(false);

  const handleTranscription = useCallback(
    (text: string, isPartial = false) => {
      if (!voiceSessionActiveRef.current) return;
      const textarea = findSenderTextarea();
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
  const onStart = useCallback(() => {
    const textarea = findSenderTextarea();
    voiceBaseRef.current = textarea?.value || "";
    voiceLenRef.current = 0;
    voiceSessionActiveRef.current = true;
  }, []);

  // Submit-time cleanup: clear the replace boundaries and mark the session
  // inactive so late frames are dropped.
  const stopOnSubmit = useCallback(() => {
    voiceBaseRef.current = "";
    voiceLenRef.current = 0;
    voiceSessionActiveRef.current = false;
  }, []);

  const isActive = useCallback(() => voiceSessionActiveRef.current, []);

  return { handleTranscription, onStart, stopOnSubmit, isActive };
}
