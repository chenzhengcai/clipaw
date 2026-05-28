import { useEffect, useState } from "react";
import { Card, Input, Form, Radio, Space } from "antd";
import { useTranslation } from "react-i18next";
import { envApi } from "../../../../api/modules/env";
import styles from "../index.module.less";

const KEY_API_KEY = "volcengine_asr_api_key";
const KEY_APP_ID = "volcengine_asr_app_id";
const KEY_ACCESS_TOKEN = "volcengine_asr_access_token";
const KEY_RESOURCE_ID = "volcengine_asr_resource_id";
const CONNECTION_FLAG = "voice_connected";

/** Clear the connection flag (called when credentials change). */
export function clearVoiceConnectionFlag(): void {
  localStorage.removeItem(CONNECTION_FLAG);
}

/** Check if voice connection has been verified. */
export function isVoiceConnected(): boolean {
  return localStorage.getItem(CONNECTION_FLAG) === "1";
}

/** Mark voice connection as verified. */
export function setVoiceConnected(): void {
  localStorage.setItem(CONNECTION_FLAG, "1");
}

type AuthMode = "new_console" | "old_console";

interface VolcengineConfigCardProps {
  onConfigChange?: (hasCreds: boolean) => void;
}

export function VolcengineConfigCard({ onConfigChange }: VolcengineConfigCardProps) {
  const { t } = useTranslation();
  const [authMode, setAuthMode] = useState<AuthMode>("old_console");
  const [apiKey, setApiKey] = useState("");
  const [appId, setAppId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [resourceId, setResourceId] = useState("volc.bigasr.sauc.duration");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const envs = await envApi.listEnvs();
        const vars: Record<string, string> = {};
        for (const v of envs) {
          vars[v.key] = v.value;
        }
        const ak = vars[KEY_API_KEY] ?? "";
        const aid = vars[KEY_APP_ID] ?? "";
        const at = vars[KEY_ACCESS_TOKEN] ?? "";
        setApiKey(ak);
        setAppId(aid);
        setAccessToken(at);
        setResourceId(vars[KEY_RESOURCE_ID] ?? "volc.bigasr.sauc.duration");
        // Auto-detect auth mode from existing data
        if (aid && at) {
          setAuthMode("old_console");
        } else if (ak) {
          setAuthMode("new_console");
        }
        setLoaded(true);
        onConfigChange?.(!!(ak || (aid && at)));
      } catch {
        setLoaded(true);
      }
    };
    loadConfig();
  }, [onConfigChange]);

  // Save immediately on every change (no debounce, so values are
  // persisted before the user navigates away or clicks Save).
  useEffect(() => {
    if (!loaded) return;
    const doSave = async () => {
      // Credentials changed → reset connection status
      clearVoiceConnectionFlag();
      onConfigChange?.(false);
      try {
        const current = await envApi.listEnvs();
        const newEnvs: Record<string, string> = {};
        for (const v of current) {
          newEnvs[v.key] = v.value;
        }
        // Clear both formats, then set the active one
        delete newEnvs[KEY_API_KEY];
        delete newEnvs[KEY_APP_ID];
        delete newEnvs[KEY_ACCESS_TOKEN];
        if (authMode === "new_console") {
          if (apiKey) newEnvs[KEY_API_KEY] = apiKey;
        } else {
          if (appId) newEnvs[KEY_APP_ID] = appId;
          if (accessToken) newEnvs[KEY_ACCESS_TOKEN] = accessToken;
        }
        newEnvs[KEY_RESOURCE_ID] = resourceId || "volc.bigasr.sauc.duration";
        await envApi.saveEnvs(newEnvs);
        onConfigChange?.(!!(apiKey || (appId && accessToken)));
      } catch {
        // silently ignore
      }
    };
    doSave();
  }, [apiKey, appId, accessToken, resourceId, authMode, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className={styles.card}>
      <h3 className={styles.cardTitle}>
        {t("voiceTranscription.volcengineConfigTitle")}
      </h3>
      <p className={styles.cardDescription}>
        {t("voiceTranscription.volcengineConfigDesc")}
      </p>

      <Form layout="vertical">
        <Form.Item label={t("voiceTranscription.volcengineAuthModeLabel")}>
          <Radio.Group
            value={authMode}
            onChange={(e) => setAuthMode(e.target.value)}
          >
            <Space direction="vertical" size="small">
              <Radio value="old_console">
                {t("voiceTranscription.volcengineAuthModeOld")}
              </Radio>
              <Radio value="new_console">
                {t("voiceTranscription.volcengineAuthModeNew")}
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>

        {authMode === "new_console" ? (
          <Form.Item label={t("voiceTranscription.volcengineApiKeyLabel")}>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t("voiceTranscription.volcengineApiKeyPlaceholder")}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item label={t("voiceTranscription.volcengineAppIdLabel")}>
              <Input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="7796709212"
              />
            </Form.Item>
            <Form.Item label={t("voiceTranscription.volcengineAccessTokenLabel")}>
              <Input.Password
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={t("voiceTranscription.volcengineAccessTokenPlaceholder")}
              />
            </Form.Item>
          </>
        )}

        <Form.Item label={t("voiceTranscription.volcengineResourceIdLabel")}>
          <Input
            value={resourceId}
            onChange={(e) => setResourceId(e.target.value)}
            placeholder="volc.bigasr.sauc.duration"
          />
        </Form.Item>
      </Form>
    </Card>
  );
}
