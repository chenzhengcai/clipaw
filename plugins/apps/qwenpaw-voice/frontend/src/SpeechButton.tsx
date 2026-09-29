/**
 * SpeechButton.tsx — streaming-record microphone button.
 *
 * Ported from the fork's
 * `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx`.
 * Differences from the fork version:
 *  - React / antd / icons come from the console host (window.QwenPaw.host),
 *    not bundled imports.
 *  - The WebSocket points at the plugin backend (`/api/qwenpaw-voice/...`).
 *  - i18n uses the plugin's own translator (see i18n.ts).
 */
import { useTranslation } from "./i18n";
import { getHost } from "./host";
import { isVoiceConnected } from "./config";

const { React, antd, antdIcons } = getHost();
const { Tooltip, message, Button } = antd;
const { LoadingOutlined } = antdIcons;

const {
  useCallback,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} = React;

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const TARGET_SAMPLE_RATE = 16000;

export interface SpeechButtonRef {
  toggleRecording: () => void;
  isRecording: () => boolean;
  isLoading: () => boolean;
  /** Reset the ASR session — discard accumulated text, start fresh. */
  resetSession: () => void;
}

interface SpeechButtonProps {
  disabled?: boolean;
  onTranscription: (text: string, isPartial?: boolean) => void;
  onStart?: () => void;
}

// ── Recording icon (animated bars) ──────────────────────────────────────
const SIZE = 1000;
const COUNT = 4;
const RECT_WIDTH = 140;
const RECT_RADIUS = RECT_WIDTH / 2;
const RECT_HEIGHT_MIN = 250;
const RECT_HEIGHT_MAX = 500;
const DURATION = 0.8;

const RecordingIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox={`0 0 ${SIZE} ${SIZE}`}
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{
      color: "#1890ff",
      height: "1.2em",
      width: "1.2em",
      verticalAlign: "top",
    }}
  >
    <title>Speech Recording</title>
    {Array.from({ length: COUNT }).map((_, index) => {
      const dest = (SIZE - RECT_WIDTH * COUNT) / (COUNT - 1);
      const x = index * (dest + RECT_WIDTH);
      const yMin = SIZE / 2 - RECT_HEIGHT_MIN / 2;
      const yMax = SIZE / 2 - RECT_HEIGHT_MAX / 2;
      return (
        <rect
          fill="currentColor"
          rx={RECT_RADIUS}
          ry={RECT_RADIUS}
          height={RECT_HEIGHT_MIN}
          width={RECT_WIDTH}
          x={x}
          y={yMin}
          key={index}
        >
          <animate
            attributeName="height"
            values={`${RECT_HEIGHT_MIN}; ${RECT_HEIGHT_MAX}; ${RECT_HEIGHT_MIN}`}
            keyTimes="0; 0.5; 1"
            dur={`${DURATION}s`}
            begin={`${(DURATION / COUNT) * index}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="y"
            values={`${yMin}; ${yMax}; ${yMin}`}
            keyTimes="0; 0.5; 1"
            dur={`${DURATION}s`}
            begin={`${(DURATION / COUNT) * index}s`}
            repeatCount="indefinite"
          />
        </rect>
      );
    })}
  </svg>
);


// Mic glyph — byte-for-byte identical to the official WhisperSpeechButton
// icon: the console already ships the global `.spark-icon` CSS from
// @agentscope-ai/icons, so we reuse the very same classes and data attribute
// (no local CSS injection needed) plus the same svg attributes and paths.
// The master switch only swaps the click behavior (streaming vs one-shot),
// never the look, size, or position.
const MicIcon: React.FC = () => (
  <span
    className="spark-icon spark-icon-spark-mic-line"
    role="img"
    aria-label="spark-mic-line"
    data-spark-icon="true"
  >
    <svg
      viewBox="0 0 1024 1024"
      width="1em"
      height="1em"
      overflow="hidden"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M285.216 562.9408a248.64 248.64 0 0 0 37.6448 59.7312 249.008 249.008 0 0 0 52.5056 46.64 245.5232 245.5232 0 0 0 64.0672 30.288c23.52 7.2032 47.712 10.8032 72.5664 10.8032 24.8544 0 49.0432-3.6 72.5664-10.8032a245.5296 245.5296 0 0 0 64.0672-30.288 248.896 248.896 0 0 0 52.5056-46.64 248.5888 248.5888 0 0 0 37.648-59.7312 32 32 0 1 1 58.4256 26.1184 312.2432 312.2432 0 0 1-47.2832 75.0336 312.6752 312.6752 0 0 1-65.936 58.5664 309.168 309.168 0 0 1-80.688 38.1376C573.6768 769.8688 543.2416 774.4 512 774.4c-31.2416 0-61.6768-4.5344-91.3056-13.6064a309.184 309.184 0 0 1-80.688-38.1376 312.6912 312.6912 0 0 1-65.936-58.5664 312.32 312.32 0 0 1-47.2832-75.0336 32 32 0 1 1 58.4256-26.1184z"></path>
      <path d="M339.4304 219.68a183.6896 183.6896 0 0 1 41.3312-62.9184 183.6896 183.6896 0 0 1 62.9184-41.3312A183.9712 183.9712 0 0 1 512 102.4a183.9712 183.9712 0 0 1 68.32 13.0304 183.6896 183.6896 0 0 1 62.9184 41.3312 183.696 183.696 0 0 1 41.3312 62.9184A183.9616 183.9616 0 0 1 697.6 288v198.4a183.952 183.952 0 0 1-13.0304 68.3168 183.7088 183.7088 0 0 1-41.3312 62.9216 183.6896 183.6896 0 0 1-62.9184 41.3312A183.9616 183.9616 0 0 1 512 672a183.9616 183.9616 0 0 1-68.32-13.0304 183.6896 183.6896 0 0 1-62.9184-41.3312 183.7024 183.7024 0 0 1-41.3312-62.9216A183.9616 183.9616 0 0 1 326.4 486.4V288a183.9712 183.9712 0 0 1 13.0304-68.32z m86.5856 352.704a120.3392 120.3392 0 0 0 41.2224 27.0784A120.512 120.512 0 0 0 512 608a120.512 120.512 0 0 0 44.7616-8.5376 120.3392 120.3392 0 0 0 41.2224-27.0784 120.3584 120.3584 0 0 0 27.0784-41.2224A120.544 120.544 0 0 0 633.6 486.4V288c0-15.4624-2.848-30.384-8.5376-44.7616a120.3552 120.3552 0 0 0-27.0784-41.2224 120.3552 120.3552 0 0 0-41.2224-27.0784A120.5344 120.5344 0 0 0 512 166.4c-15.4624 0-30.384 2.848-44.7616 8.5376a120.3552 120.3552 0 0 0-41.2224 27.0784 120.3552 120.3552 0 0 0-27.0784 41.2224A120.5312 120.5312 0 0 0 390.4 288v198.4c0 15.4624 2.848 30.384 8.5376 44.7616a120.3584 120.3584 0 0 0 27.0784 41.2224zM512 710.4c17.6736 0 32 14.3264 32 32v147.2c0 17.6736-14.3264 32-32 32s-32-14.3264-32-32v-147.2c0-17.6736 14.3264-32 32-32z"></path>
      <path d="M352 889.6c0-17.6736 14.3264-32 32-32h256c17.6736 0 32 14.3264 32 32s-14.3264 32-32 32h-256c-17.6736 0-32-14.3264-32-32z"></path>
    </svg>
  </span>
);

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build ws:// or wss:// URL from the REST API base. */
function getWsUrl(path: string): string {
  const apiUrl = getHost().getApiUrl(path);
  if (apiUrl.startsWith("https://")) return apiUrl.replace("https://", "wss://");
  if (apiUrl.startsWith("http://")) return apiUrl.replace("http://", "ws://");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${apiUrl}`;
}

/** Resample Float32 audio from native sample rate to target (16kHz). */
function resampleTo16k(
  buffer: Float32Array,
  inputSampleRate: number,
): Int16Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      out[i] = Math.max(-32768, Math.min(32767, Math.round(buffer[i] * 32767)));
    }
    return out;
  }
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(buffer.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const srcIdxFloor = Math.floor(srcIdx);
    const srcIdxCeil = Math.min(srcIdxFloor + 1, buffer.length - 1);
    const t = srcIdx - srcIdxFloor;
    const val = buffer[srcIdxFloor] * (1 - t) + buffer[srcIdxCeil] * t;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(val * 32767)));
  }
  return out;
}

/** Convert Int16Array to ArrayBuffer for WebSocket send. */
function int16ToBuffer(data: Int16Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < data.length; i++) {
    view.setInt16(i * 2, data[i], true); // little-endian
  }
  return buf;
}

// ── Component ───────────────────────────────────────────────────────────

const SpeechButton = forwardRef<SpeechButtonRef, SpeechButtonProps>(
  ({ disabled, onTranscription, onStart }, ref) => {
    const { t } = useTranslation();
    const [recording, setRecording] = useState(false);
    const [loading, setLoading] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const internalRecordingRef = useRef(false);
    const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const finalTextRef = useRef("");

    const cleanup = useCallback(() => {
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (processorRef.current) {
        try {
          processorRef.current.disconnect();
        } catch {
          /* ignore */
        }
        processorRef.current = null;
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
      if (wsRef.current) {
        try {
          if (wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send("DONE");
          }
        } catch {
          /* ignore */
        }
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
      internalRecordingRef.current = false;
      setRecording(false);
      setLoading(false);
    }, []);

    const stopRecording = useCallback(() => {
      if (internalRecordingRef.current) {
        internalRecordingRef.current = false;
        setRecording(false);
        setLoading(true);
        if (processorRef.current) {
          try {
            processorRef.current.disconnect();
          } catch {
            /* ignore */
          }
          processorRef.current = null;
        }
        if (audioCtxRef.current) {
          try {
            audioCtxRef.current.close();
          } catch {
            /* ignore */
          }
          audioCtxRef.current = null;
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((tr) => tr.stop());
          streamRef.current = null;
        }
        if (recordingTimerRef.current) {
          clearTimeout(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send("DONE");
        }
      }
    }, []);

    const startRecording = useCallback(async () => {
      if (internalRecordingRef.current || loading) return;

      onStart?.();

      try {
        const wsUrl = getWsUrl("/qwenpaw-voice/transcribe/ws");
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onopen = async () => {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                channelCount: 1,
                sampleRate: { ideal: TARGET_SAMPLE_RATE },
              },
            });
            streamRef.current = stream;

            const audioCtx = new AudioContext({
              sampleRate: stream.getAudioTracks()[0].getSettings().sampleRate,
            });
            audioCtxRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            const inputSampleRate = audioCtx.sampleRate;

            processor.onaudioprocess = (e) => {
              if (!internalRecordingRef.current) return;
              if (ws.readyState !== WebSocket.OPEN) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm = resampleTo16k(inputData, inputSampleRate);
              const buf = int16ToBuffer(pcm);
              ws.send(buf);
            };

            source.connect(processor);
            processor.connect(audioCtx.destination);

            internalRecordingRef.current = true;
            setRecording(true);

            recordingTimerRef.current = setTimeout(() => {
              if (internalRecordingRef.current) {
                message.warning(
                  t("recordingTooLong", {
                    limit: MAX_RECORDING_DURATION_MS / 1000,
                  }),
                );
                stopRecording();
              }
            }, MAX_RECORDING_DURATION_MS);
          } catch (err) {
            console.error("Microphone access error:", err);
            message.error(t("microphoneError"));
            cleanup();
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);
            if (data.type === "partial" && data.text) {
              onTranscription(data.text, true);
              finalTextRef.current = data.text;
            } else if (data.type === "final") {
              if (data.text) {
                onTranscription(data.text, false);
                finalTextRef.current = data.text;
              } else if (finalTextRef.current) {
                onTranscription(finalTextRef.current, false);
              }
              cleanup();
            } else if (data.type === "error") {
              message.error(data.message || t("transcriptionFailed"));
              cleanup();
            }
          } catch {
            // ignore
          }
        };

        let hadError = false;

        ws.onerror = () => {
          hadError = true;
        };

        ws.onclose = () => {
          if (loading) {
            if (finalTextRef.current) {
              onTranscription(finalTextRef.current, false);
            } else if (hadError) {
              message.error(t("transcriptionFailed"));
            }
          }
          cleanup();
        };

        wsRef.current = ws;
      } catch (err) {
        console.error("Microphone setup error:", err);
        message.error(t("microphoneError"));
        cleanup();
      }
    }, [onTranscription, t, loading, stopRecording, cleanup]);

    const toggleRecording = useCallback(() => {
      if (loading) return;
      if (internalRecordingRef.current) {
        stopRecording();
      } else {
        finalTextRef.current = "";
        startRecording();
      }
    }, [loading, startRecording, stopRecording]);

    const resetSession = useCallback(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        finalTextRef.current = "";
        wsRef.current.send("RESET");
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        toggleRecording,
        isRecording: () => internalRecordingRef.current,
        isLoading: () => loading,
        resetSession,
      }),
      [toggleRecording, loading, resetSession],
    );

    const voiceConnected = isVoiceConnected();
    const isDisabled = disabled || loading || !voiceConnected;

    return (
      <Tooltip
        title={
          !voiceConnected
            ? t("notConnected")
            : loading
              ? t("transcribing")
              : recording
                ? t("stopRecording")
                : t("startRecording")
        }
        mouseEnterDelay={0.5}
      >
        <Button
          type="text"
          // Same classes as the official WhisperSpeechButton:
          // - qwenpaw-sender-actions-btn → Chat's less scopes
          //   [class$="-sender-actions-btn"] to 44×44 / radius 12px (this is
          //   what makes the official mic a 44px round-corner tile; without
          //   it the button shrinks to a bare 1em glyph).
          // - qwenpaw-spark-icon-button / spark-button → design-lib Button
          //   marker classes (kept for parity).
          className="qwenpaw-sender-actions-btn qwenpaw-spark-icon-button spark-button"
          icon={
            loading ? (
              <LoadingOutlined style={{ fontSize: "1.2em" }} />
            ) : recording ? (
              <RecordingIcon />
            ) : (
              <MicIcon />
            )
          }
          onClick={voiceConnected ? toggleRecording : undefined}
          disabled={isDisabled}
          style={{
            // Mirror the official design-lib Button exactly: it renders an
            // antd Button with { fontWeight: 500, lineHeight: 1 } and passes
            // the icon through unchanged. Same antd defaults ⇒ same box size.
            fontWeight: 500,
            lineHeight: 1,
            color: recording || loading ? "#1890ff" : undefined,
          }}
        />
      </Tooltip>
    );
  },
);

SpeechButton.displayName = "SpeechButton";

export default SpeechButton;
