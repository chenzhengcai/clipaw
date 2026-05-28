import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import { useAppMessage } from "../../../hooks/useAppMessage";

// Re-exported for backwards compat with old components (still on disk)
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
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // Auto-set provider type to volcengine_bigmodel
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

  const handleSave = async () => {
    setSaving(true);
    try {
      // Ensure provider type is volcengine_bigmodel
      await api.updateTranscriptionProviderType("volcengine_bigmodel");
      message.success(t("voiceTranscription.saveSuccess"));
    } catch (err) {
      console.error("Failed to save:", err);
      message.error(t("voiceTranscription.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    loading,
    saving,
    handleSave,
  };
}
