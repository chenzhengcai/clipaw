import React, {
  useCallback,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { IconButton } from "@agentscope-ai/design";
import { SparkMicLine } from "@agentscope-ai/icons";
import { Tooltip, message } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { getApiUrl } from "@/api/config";
import { isVoiceConnected } from "@/pages/Settings/VoiceTranscription/components/VolcengineConfigCard";

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const TARGET_SAMPLE_RATE = 16000;

export interface WhisperSpeechButtonRef {
  toggleRecording: () => void;
  isRecording: () => boolean;
  isLoading: () => boolean;
  /** Reset the ASR session — discard accumulated text, start fresh. */
  resetSession: () => void;
}

interface WhisperSpeechButtonProps {
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

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build ws:// or wss:// URL from the REST API base. */
function getWsUrl(path: string): string {
  const apiUrl = getApiUrl(path);
  if (apiUrl.startsWith("https://")) return apiUrl.replace("https://", "wss://");
  if (apiUrl.startsWith("http://")) return apiUrl.replace("http://", "ws://");
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${apiUrl}`;
}

/**
 * Resample Float32 audio from native sample rate to target (16kHz).
 * Simple linear interpolation — good enough for speech.
 */
function resampleTo16k(
  buffer: Float32Array,
  inputSampleRate: number,
): Int16Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    // No resampling needed — just convert to Int16
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
    const val =
      buffer[srcIdxFloor] * (1 - t) + buffer[srcIdxCeil] * t;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(val * 32767)));
  }
  return out;
}

/** Convert Int16Array to ArrayBuffer for WebSocket send. */
function int16ToBuffer(data: Int16Array): ArrayBuffer {
  // Int16 = 2 bytes per sample, little-endian
  const buf = new ArrayBuffer(data.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < data.length; i++) {
    view.setInt16(i * 2, data[i], true); // little-endian
  }
  return buf;
}

// ── Component ───────────────────────────────────────────────────────────

const WhisperSpeechButton = forwardRef<
  WhisperSpeechButtonRef,
  WhisperSpeechButtonProps
>(({ disabled, onTranscription, onStart }, ref) => {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const internalRecordingRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTextRef = useRef("");

  const cleanup = useCallback(() => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    // Stop AudioContext pipeline
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch { /* ignore */ }
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    // Send DONE and close WebSocket
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send("DONE");
        }
      } catch { /* ignore */ }
      try {
        wsRef.current.close();
      } catch { /* ignore */ }
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
      // Stop the audio pipeline — send DONE
      if (processorRef.current) {
        try { processorRef.current.disconnect(); } catch { /* ignore */ }
        processorRef.current = null;
      }
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      // Signal backend that recording is done
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send("DONE");
      }
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (internalRecordingRef.current || loading) return;

    onStart?.();

    try {
      // Open WebSocket to backend FIRST
      const wsUrl = getWsUrl("/workspace/transcribe/ws");
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = async () => {
        try {
          // Get microphone stream
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: { ideal: TARGET_SAMPLE_RATE },
            },
          });
          streamRef.current = stream;

          // Create AudioContext at the actual sample rate
          const audioCtx = new AudioContext({ sampleRate: stream.getAudioTracks()[0].getSettings().sampleRate });
          audioCtxRef.current = audioCtx;

          const source = audioCtx.createMediaStreamSource(stream);

          // ScriptProcessorNode: buffer size = 4096 (~256ms at 16kHz)
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

          // Auto-stop after max duration
          recordingTimerRef.current = setTimeout(() => {
            if (internalRecordingRef.current) {
              message.warning(
                t("chat.speech.recordingTooLong", {
                  limit: MAX_RECORDING_DURATION_MS / 1000,
                }),
              );
              stopRecording();
            }
          }, MAX_RECORDING_DURATION_MS);
        } catch (err) {
          console.error("Microphone access error:", err);
          message.error(t("chat.speech.microphoneError"));
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
            message.error(data.message || t("chat.speech.transcriptionFailed"));
            cleanup();
          }
        } catch {
          // ignore
        }
      };

      let hadError = false;

      ws.onerror = () => {
        hadError = true;
        // Don't show error yet — wait for onclose to see if text arrived
      };

      ws.onclose = () => {
        if (loading) {
          if (finalTextRef.current) {
            onTranscription(finalTextRef.current, false);
          } else if (hadError) {
            message.error(t("chat.speech.transcriptionFailed"));
          }
        }
        cleanup();
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Microphone setup error:", err);
      message.error(t("chat.speech.microphoneError"));
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
          ? t("chat.speech.notConnected")
          : loading
            ? t("chat.speech.transcribing")
            : recording
              ? t("chat.speech.stopRecording")
              : t("chat.speech.startRecording")
      }
      mouseEnterDelay={0.5}
    >
      <IconButton
        bordered={false}
        icon={
          loading ? (
            <LoadingOutlined style={{ fontSize: "1.2em" }} />
          ) : recording ? (
            <RecordingIcon />
          ) : (
            <SparkMicLine />
          )
        }
        onClick={voiceConnected ? toggleRecording : undefined}
        disabled={isDisabled}
        style={{
          color: recording || loading ? "#1890ff" : undefined,
        }}
      />
    </Tooltip>
  );
});

WhisperSpeechButton.displayName = "WhisperSpeechButton";

export default WhisperSpeechButton;
