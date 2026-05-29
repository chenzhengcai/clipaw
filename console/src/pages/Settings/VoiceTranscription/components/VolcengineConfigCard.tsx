import { useEffect, useState, useCallback } from "react";
import { Card, Input, Form, Radio, Space, Button } from "antd";
import { EditOutlined, CloseOutlined, CheckOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { envApi } from "../../../../api/modules/env";
import {
  saveClientConfig,
  getClientConfig,
  removeClientConfig,
} from "../../../../api/clientConfig";
import styles from "../index.module.less";

const KEY_API_KEY = "volcengine_asr_api_key";
const KEY_APP_ID = "volcengine_asr_app_id";
const KEY_ACCESS_TOKEN = "volcengine_asr_access_token";
const KEY_RESOURCE_ID = "volcengine_asr_resource_id";
const CONNECTION_FLAG = "voice_connected";

export function clearVoiceConnectionFlag(): void {
  removeClientConfig(CONNECTION_FLAG);
}

export function isVoiceConnected(): boolean {
  return getClientConfig(CONNECTION_FLAG) === "1";
}

export async function setVoiceConnected(): Promise<void> {
  await saveClientConfig(CONNECTION_FLAG, "1");
}

type AuthMode = "new_console" | "old_console";

interface VolcengineConfigCardProps {
  onConfigChange?: (hasCreds: boolean) => void;
}

export function VolcengineConfigCard({ onConfigChange }: VolcengineConfigCardProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("old_console");
  const [apiKey, setApiKey] = useState("");
  const [appId, setAppId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [resourceId, setResourceId] = useState("volc.bigasr.sauc.duration");
  const [loaded, setLoaded] = useState(false);

  // Saved originals for cancel
  const [origAuthMode, setOrigAuthMode] = useState<AuthMode>("old_console");
  const [origApiKey, setOrigApiKey] = useState("");
  const [origAppId, setOrigAppId] = useState("");
  const [origAccessToken, setOrigAccessToken] = useState("");
  const [origResourceId, setOrigResourceId] = useState("volc.bigasr.sauc.duration");

  const loadConfig = useCallback(async () => {
    try {
      const envs = await envApi.listEnvs();
      const vars: Record<string, string> = {};
      for (const v of envs) {
        vars[v.key] = v.value;
      }
      const ak = vars[KEY_API_KEY] ?? "";
      const aid = vars[KEY_APP_ID] ?? "";
      const at = vars[KEY_ACCESS_TOKEN] ?? "";
      const rid = vars[KEY_RESOURCE_ID] ?? "volc.bigasr.sauc.duration";
      setApiKey(ak); setOrigApiKey(ak);
      setAppId(aid); setOrigAppId(aid);
      setAccessToken(at); setOrigAccessToken(at);
      setResourceId(rid); setOrigResourceId(rid);
      const mode: AuthMode = (aid && at) ? "old_console" : ak ? "new_console" : "old_console";
      setAuthMode(mode); setOrigAuthMode(mode);
      setLoaded(true);
      onConfigChange?.(!!(ak || (aid && at)));
    } catch {
      setLoaded(true);
    }
  }, [onConfigChange]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleEdit = () => {
    setOrigAuthMode(authMode);
    setOrigApiKey(apiKey);
    setOrigAppId(appId);
    setOrigAccessToken(accessToken);
    setOrigResourceId(resourceId);
    setEditing(true);
  };

  const handleCancel = () => {
    setAuthMode(origAuthMode);
    setApiKey(origApiKey);
    setAppId(origAppId);
    setAccessToken(origAccessToken);
    setResourceId(origResourceId);
    setEditing(false);
  };

  const handleSave = async () => {
    clearVoiceConnectionFlag();
    onConfigChange?.(false);
    try {
      const current = await envApi.listEnvs();
      const newEnvs: Record<string, string> = {};
      for (const v of current) {
        newEnvs[v.key] = v.value;
      }
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
      setOrigAuthMode(authMode);
      setOrigApiKey(apiKey);
      setOrigAppId(appId);
      setOrigAccessToken(accessToken);
      setOrigResourceId(resourceId);
      setEditing(false);
      onConfigChange?.(!!(apiKey || (appId && accessToken)));
    } catch {
      // silently ignore
    }
  };

  const hasCreds = !!(apiKey || (appId && accessToken));

  return (
    <Card
      className={styles.card}
      extra={
        editing ? (
          <Space size="small">
            <Button size="small" icon={<CloseOutlined />} onClick={handleCancel}>
              {t("common.cancel")}
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleSave}>
              {t("common.save")}
            </Button>
          </Space>
        ) : (
          <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>
            {t("common.edit")}
          </Button>
        )
      }
    >
      <h3 className={styles.cardTitle}>
        {t("voiceTranscription.volcengineConfigTitle")}
      </h3>
      <p className={styles.cardDescription}>
        {t("voiceTranscription.volcengineConfigDesc")}
      </p>

      {!editing && loaded && (
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, lineHeight: 2 }}>
          {hasCreds ? (
            <>
              <div>{t("voiceTranscription.volcengineAuthModeLabel")}: {authMode === "old_console" ? t("voiceTranscription.volcengineAuthModeOld") : t("voiceTranscription.volcengineAuthModeNew")}</div>
              {authMode === "new_console" ? (
                <div>{t("voiceTranscription.volcengineApiKeyLabel")}: ****</div>
              ) : (
                <>
                  <div>{t("voiceTranscription.volcengineAppIdLabel")}: {appId}</div>
                  <div>{t("voiceTranscription.volcengineAccessTokenLabel")}: ****</div>
                </>
              )}
              <div>{t("voiceTranscription.volcengineResourceIdLabel")}: {resourceId}</div>
            </>
          ) : (
            <div style={{ fontStyle: "italic" }}>{t("voiceTranscription.volcengineNotConfigured")}</div>
          )}
        </div>
      )}

      {editing && (
        <Form layout="vertical">
          <Form.Item label={t("voiceTranscription.volcengineAuthModeLabel")}>
            <Radio.Group value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
              <Space direction="vertical" size="small">
                <Radio value="old_console">{t("voiceTranscription.volcengineAuthModeOld")}</Radio>
                <Radio value="new_console">{t("voiceTranscription.volcengineAuthModeNew")}</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>

          {authMode === "new_console" ? (
            <Form.Item label={t("voiceTranscription.volcengineApiKeyLabel")}>
              <Input.Password value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t("voiceTranscription.volcengineApiKeyPlaceholder")} />
            </Form.Item>
          ) : (
            <>
              <Form.Item label={t("voiceTranscription.volcengineAppIdLabel")}>
                <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="7796709212" />
              </Form.Item>
              <Form.Item label={t("voiceTranscription.volcengineAccessTokenLabel")}>
                <Input.Password value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder={t("voiceTranscription.volcengineAccessTokenPlaceholder")} />
              </Form.Item>
            </>
          )}

          <Form.Item label={t("voiceTranscription.volcengineResourceIdLabel")}>
            <Input value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="volc.bigasr.sauc.duration" />
          </Form.Item>
        </Form>
      )}
    </Card>
  );
}
