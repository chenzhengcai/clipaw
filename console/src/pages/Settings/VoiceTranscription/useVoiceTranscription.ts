import { useEffect, useState } from "react";
import api from "../../../api";

export interface TranscriptionProvider {
  id: string;
  name: string;
  available: boolean;
}

export interface LocalWhisperStatus {
  available: boolean;
  ffmpeg_installed: boolean;
  whisper_installed: boolean;
}

export function useVoiceTranscription() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Auto-set provider type to volcengine_bigmodel so the
        // WebSocket streaming path is active by default.
        const provTypeRes = await api.getTranscriptionProviderType();
        if (provTypeRes.transcription_provider_type !== "volcengine_bigmodel") {
          await api.updateTranscriptionProviderType("volcengine_bigmodel");
        }
      } catch (err) {
        console.error("Failed to init voice transcription:", err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  return {
    loading,
  };
}
