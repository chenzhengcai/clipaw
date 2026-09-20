import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import { useAppMessage } from "../../../hooks/useAppMessage";

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

type AudioMode = string;
type ProviderType = "disabled" | "local_whisper" | "whisper_api" | string;

export function useVoiceTranscription() {
  const { t } = useTranslation();
  const { message } = useAppMessage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>("auto");
  const [providerType, setProviderType] = useState<ProviderType>("disabled");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [availableProviders, setAvailableProviders] = useState<
    TranscriptionProvider[]
  >([]);
  const [localWhisperStatus, setLocalWhisperStatus] =
    useState<LocalWhisperStatus | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const [modeRes, typeRes, providersRes, whisperRes] = await Promise.all([
        api.getAudioMode(),
        api.getTranscriptionProviderType(),
        api.getTranscriptionProviders(),
        api.getLocalWhisperStatus(),
      ]);
      setAudioMode(modeRes.audio_mode ?? "auto");
      setProviderType(typeRes.transcription_provider_type ?? "disabled");
      setSelectedProviderId(providersRes.configured_provider_id ?? "");
      setAvailableProviders(
        (providersRes.providers ?? []).filter((p) => p.available),
      );
      setLocalWhisperStatus(whisperRes);
    } catch (err) {
      console.error("Failed to load voice transcription settings:", err);
      message.error(t("voiceTranscription.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showProviderSection = audioMode !== "native";
  const isLocalWhisper = providerType === "local_whisper";
  const isWhisperApi = providerType === "whisper_api";

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAudioMode(audioMode);
      await api.updateTranscriptionProviderType(providerType);
      if (isWhisperApi && selectedProviderId) {
        await api.updateTranscriptionProvider(selectedProviderId);
      }
      message.success(t("voiceTranscription.saveSuccess"));
    } catch (err) {
      console.error("Failed to save voice transcription settings:", err);
      message.error(t("voiceTranscription.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    loading,
    saving,
    audioMode,
    providerType,
    selectedProviderId,
    availableProviders,
    localWhisperStatus,
    showProviderSection,
    isLocalWhisper,
    isWhisperApi,
    setAudioMode,
    setProviderType,
    setSelectedProviderId,
    fetchSettings,
    handleSave,
  };
}
