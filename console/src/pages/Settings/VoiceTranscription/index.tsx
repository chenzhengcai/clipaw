import { useState, useCallback } from "react";
import { Button } from "@agentscope-ai/design";
import { Spin, message as antMsg } from "antd";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { agentApi } from "@/api/modules/agent";
import { useVoiceTranscription } from "./useVoiceTranscription";
import {
  VolcengineConfigCard,
  ShortcutSettings,
  clearVoiceConnectionFlag,
  isVoiceConnected,
  setVoiceConnected,
} from "./components";
import styles from "./index.module.less";

function VoiceTranscriptionPage() {
  const { t } = useTranslation();
  const [, msgCtx] = antMsg.useMessage();
  const { loading, saving, handleSave } = useVoiceTranscription();
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(isVoiceConnected);

  const handleTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await agentApi.testVoiceConnection();
      if (res.ok) {
        setVoiceConnected();
        setConnected(true);
        antMsg.success(t("voiceTranscription.testSuccess"));
      } else {
        clearVoiceConnectionFlag();
        setConnected(false);
        antMsg.error(
          res.error || t("voiceTranscription.testFailed"),
        );
      }
    } catch {
      clearVoiceConnectionFlag();
      setConnected(false);
      antMsg.error(t("voiceTranscription.testFailed"));
    } finally {
      setTesting(false);
    }
  }, [t]);

  const handleSaveWithCheck = useCallback(async () => {
    if (!isVoiceConnected()) {
      antMsg.warning(t("voiceTranscription.testRequired"));
      return;
    }
    await handleSave();
  }, [handleSave, t]);

  if (loading) {
    return (
      <div className={styles.voiceTranscriptionPage}>
        <div className={styles.centerState}>
          <Spin />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.voiceTranscriptionPage}>
      {msgCtx}
      <PageHeader
        items={[
          { title: t("nav.settings") },
          { title: t("voiceTranscription.title") },
        ]}
      />
      <div className={styles.content}>
        <VolcengineConfigCard onConfigChange={(ok) => {
          if (!ok) { setConnected(false); clearVoiceConnectionFlag(); }
        }} />
        <ShortcutSettings />
      </div>

      <div className={styles.footerButtons}>
        <Button
          onClick={handleTest}
          loading={testing}
          type={testing ? "default" : "primary"}
          ghost={!testing}
          style={{ marginRight: 8 }}
        >
          {testing
            ? t("voiceTranscription.testing")
            : connected
              ? `${t("voiceTranscription.testConnected")} ✓`
              : t("voiceTranscription.testConnection")}
        </Button>
        <Button
          type="primary"
          onClick={handleSaveWithCheck}
          loading={saving}
          disabled={!connected}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export default VoiceTranscriptionPage;
