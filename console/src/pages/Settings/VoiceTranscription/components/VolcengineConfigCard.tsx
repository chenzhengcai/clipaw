import { useEffect, useState, useCallback, useRef } from "react";
import { Card, Input, Form, Button, Space, message as antMsg } from "antd";
import { EditOutlined, CloseOutlined, CheckOutlined, ApiOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { envApi } from "@/api/modules/env";
import { agentApi } from "@/api/modules/agent";
import {
  saveClientConfig,
  getClientConfig,
  removeClientConfig,
} from "@/api/clientConfig";
import styles from "../index.module.less";

const KEY_API_KEY = "volcengine_asr_api_key";
const KEY_RESOURCE_ID = "volcengine_asr_resource_id";
const CONNECTION_FLAG = "voice_connected";
const TEST_TIMEOUT_MS = 15_000;

export function clearVoiceConnectionFlag(): void {
  removeClientConfig(CONNECTION_FLAG);
}

export function isVoiceConnected(): boolean {
  return getClientConfig(CONNECTION_FLAG) === "1";
}

export async function setVoiceConnected(): Promise<void> {
  await saveClientConfig(CONNECTION_FLAG, "1");
}

interface VolcengineConfigCardProps {
  onConfigChange?: (hasCreds: boolean) => void;
}

export function VolcengineConfigCard({ onConfigChange }: VolcengineConfigCardProps) {
  const { t } = useTranslation();
  const [messageApi, contextHolder] = antMsg.useMessage();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [resourceId, setResourceId] = useState("volc.bigasr.sauc.duration");
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(isVoiceConnected);
  const testingRef = useRef(false);

  // Saved originals for cancel
  const [origApiKey, setOrigApiKey] = useState("");
  const [origResourceId, setOrigResourceId] = useState("volc.bigasr.sauc.duration");

  const loadConfig = useCallback(async () => {
    try {
      const envs = await envApi.listEnvs();
      const vars: Record<string, string> = {};
      for (const v of envs) {
        vars[v.key] = v.value;
      }
      const ak = vars[KEY_API_KEY] ?? "";
      const rid = vars[KEY_RESOURCE_ID] ?? "volc.bigasr.sauc.duration";
      setApiKey(ak); setOrigApiKey(ak);
      setResourceId(rid); setOrigResourceId(rid);
      setLoaded(true);
      onConfigChange?.(!!ak);
    } catch {
      setLoaded(true);
    }
  }, [onConfigChange]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleTest = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    try {
      const credentials = editing
        ? { api_key: apiKey, resource_id: resourceId || "volc.bigasr.sauc.duration" }
        : undefined;

      const res = await Promise.race([
        agentApi.testVoiceConnection(credentials),
        new Promise<{ ok: false; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error(t("voiceTranscription.testFailed"))), TEST_TIMEOUT_MS)
        ),
      ]);

      if (res.ok) {
        await setVoiceConnected();
        setConnected(true);
        messageApi.success(t("voiceTranscription.testSuccess"));
      } else {
        clearVoiceConnectionFlag();
        setConnected(false);
        messageApi.error(res.error || t("voiceTranscription.testFailed"));
      }
    } catch {
      clearVoiceConnectionFlag();
      setConnected(false);
      messageApi.error(t("voiceTranscription.testFailed"));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }, [t, editing, apiKey, resourceId, messageApi]);

  const handleEdit = () => {
    setOrigApiKey(apiKey);
    setOrigResourceId(resourceId);
    setEditing(true);
  };

  const handleCancel = () => {
    setApiKey(origApiKey);
    setResourceId(origResourceId);
    setEditing(false);
  };

  const handleSave = async () => {
    clearVoiceConnectionFlag();
    setConnected(false);
    onConfigChange?.(false);
    try {
      const current = await envApi.listEnvs();
      const newEnvs: Record<string, string> = {};
      for (const v of current) {
        newEnvs[v.key] = v.value;
      }
      delete newEnvs["volcengine_asr_app_id"];
      delete newEnvs["volcengine_asr_access_token"];
      if (apiKey) newEnvs[KEY_API_KEY] = apiKey;
      else delete newEnvs[KEY_API_KEY];
      newEnvs[KEY_RESOURCE_ID] = resourceId || "volc.bigasr.sauc.duration";
      await envApi.saveEnvs(newEnvs);
      setOrigApiKey(apiKey);
      setOrigResourceId(resourceId);
      setEditing(false);
      onConfigChange?.(!!apiKey);
    } catch {
      // silently ignore
    }
  };

  const hasCreds = !!apiKey;
  const canTest = editing ? !!(apiKey) : hasCreds;

  const testButton = (
    <Button
      size="small"
      icon={<ApiOutlined />}
      onClick={handleTest}
      loading={testing}
      disabled={!canTest}
    >
      {testing
        ? t("voiceTranscription.testing")
        : connected
          ? `${t("voiceTranscription.testConnected")} ✓`
          : t("voiceTranscription.testConnection")}
    </Button>
  );

  return (
    <Card
      className={styles.card}
      extra={
        editing ? (
          <Space size="small">
            {testButton}
            <Button size="small" icon={<CloseOutlined />} onClick={handleCancel}>
              {t("common.cancel")}
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={handleSave}>
              {t("common.save")}
            </Button>
          </Space>
        ) : (
          <Space size="small">
            {testButton}
            <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>
              {t("common.edit")}
            </Button>
          </Space>
        )
      }
    >
      {contextHolder}
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
              <div>{t("voiceTranscription.volcengineApiKeyLabel")}: ****</div>
              <div>{t("voiceTranscription.volcengineResourceIdLabel")}: {resourceId}</div>
            </>
          ) : (
            <div style={{ fontStyle: "italic" }}>{t("voiceTranscription.volcengineNotConfigured")}</div>
          )}
        </div>
      )}

      {editing && (
        <Form layout="vertical">
          <Form.Item label={t("voiceTranscription.volcengineApiKeyLabel")}>
            <Input.Password value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={t("voiceTranscription.volcengineApiKeyPlaceholder")} />
          </Form.Item>
          <Form.Item label={t("voiceTranscription.volcengineResourceIdLabel")}>
            <Input value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="volc.bigasr.sauc.duration" />
          </Form.Item>
        </Form>
      )}
    </Card>
  );
}
