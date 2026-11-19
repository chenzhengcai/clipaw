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

/**
 * Find the chat sender textarea.
 *
 * The SDK marks its input with `data-sender-input="true"` (the Chat page's
 * styles rely on it too), so prefer that.  The old `[class*="sender"]`
 * lookup can match a wrapper *before* the real sender in document order
 * (e.g. the plugin's own button carries `qwenpaw-sender-actions-btn`), which
 * silently dropped every transcription.  Only visible textareas qualify.
 */
function findSenderTextarea(): HTMLTextAreaElement | null {
  const isVisible = (el: HTMLElement) => el.offsetParent !== null;

  const marked = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(
      'textarea[data-sender-input="true"]',
    ),
  );
  const visibleMarked = marked.find(isVisible) ?? marked[0];
  if (visibleMarked) return visibleMarked;

  for (const sender of Array.from(
    document.querySelectorAll<HTMLElement>('[class*="sender"]'),
  )) {
    const textarea = sender.querySelector("textarea");
    if (textarea && isVisible(textarea)) return textarea;
  }

  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement) return focused;
  return null;
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

  const handleTranscription = useCallback((text: string, isPartial = false) => {
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
  }, []);

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
