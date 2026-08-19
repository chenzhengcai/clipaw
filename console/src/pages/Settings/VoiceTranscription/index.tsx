import { useTranslation } from "react-i18next";
import { Spin } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { useVoiceTranscription } from "./useVoiceTranscription";
import {
  VolcengineConfigCard,
  ShortcutSettings,
} from "./components";
import styles from "./index.module.less";

function VoiceTranscriptionPage() {
  const { t } = useTranslation();
  const { loading } = useVoiceTranscription();

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
      <PageHeader
        items={[
          { title: t("nav.settings") },
          { title: t("voiceTranscription.title") },
        ]}
      />
      <div className={styles.content}>
        <VolcengineConfigCard onConfigChange={() => {}} />
        <ShortcutSettings />
      </div>
    </div>
  );
}

export default VoiceTranscriptionPage;
