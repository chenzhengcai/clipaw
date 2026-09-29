/**
 * SettingsPage.tsx — voice plugin settings.
 *
 * Ported from the fork's `console/src/pages/Settings/VoiceTranscription/*`
 * (VolcengineConfigCard + ShortcutSettings) into a single
 * self-contained page registered as a plugin route.  The upstream settings
 * page is left untouched.
 */
import type * as ReactNS from "react";
import { useTranslation } from "./i18n";
import { getHost } from "./host";

// Classic-JSX runtime needs `React` in scope; resolve it from the host so we
// share the host's React instance (and emit no bare `import "react"`).
const React: typeof ReactNS = getHost().React;
const { useCallback, useEffect, useRef, useState } = React;
import {
  DEFAULT_RESOURCE_ID,
  clearVoiceConnectionFlag,
  formatShortcut,
  isVoiceConnected,
  loadShortcut,
  loadShortcutMode,
  loadVoiceEnabled,
  loadVolcCredentials,
  matchShortcut,
  saveShortcutConfig,
  saveVoiceEnabled,
  saveVolcCredentials,
  setVoiceConnected,
  testVoiceConnection,
  type ShortcutDef,
  type ShortcutMode,
} from "./config";

const { antd, antdIcons } = getHost();
const { Card, Input, Form, Button, Space, message, Switch, Tag, Radio } = antd;
const { EditOutlined, CloseOutlined, CheckOutlined, ApiOutlined } = antdIcons;

const TEST_TIMEOUT_MS = 15_000;

const cardStyle: React.CSSProperties = {
  marginBottom: 16,
  borderRadius: 8,
};
const cardTitleStyle: React.CSSProperties = {
  margin: "0 0 4px",
  fontSize: 15,
  fontWeight: 600,
};
const cardDescStyle: React.CSSProperties = {
  margin: "0 0 12px",
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 13,
};
const hintStyle: React.CSSProperties = {
  color: "var(--ant-color-text-tertiary, rgba(0,0,0,0.35))",
  fontSize: 13,
  lineHeight: 2,
};
const optionLabelStyle: React.CSSProperties = {
  fontWeight: 500,
  marginRight: 6,
};
const optionDescStyle: React.CSSProperties = {
  color: "var(--ant-color-text-secondary, rgba(0,0,0,0.45))",
  fontSize: 12,
};

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

// ── Master switch card ──────────────────────────────────────────────────

/**
 * 实时语音输入总开关。
 * 开启：本插件的火山引擎流式实时语音（麦克风按钮经 senderPrefix 槽挂载）。
 * 关闭：插件麦克风与快捷键全部下线，Chat 页回退官方内置语音输入
 * （WhisperSpeechButton / SDK allowSpeech）。
 */
function MasterSwitchCard() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(loadVoiceEnabled);

  return (
    <Card style={cardStyle}>
      <h3 style={cardTitleStyle}>{t("toggleTitle")}</h3>
      <p style={cardDescStyle}>{t("toggleDesc")}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Switch
          checked={enabled}
          onChange={(checked: boolean) => {
            setEnabled(checked);
            void saveVoiceEnabled(checked);
          }}
        />
        <Tag color={enabled ? "green" : "default"}>
          {enabled ? t("toggleOn") : t("toggleOff")}
        </Tag>
      </div>
    </Card>
  );
}

// ── Volcengine credentials card ─────────────────────────────────────────

function VolcengineConfigCard() {
  const { t } = useTranslation();
  const [messageApi, contextHolder] = message.useMessage();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [resourceId, setResourceId] = useState(DEFAULT_RESOURCE_ID);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(isVoiceConnected);
  const testingRef = useRef(false);

  const loadConfig = useCallback(async () => {
    const { apiKey: ak, resourceId: rid } = await loadVolcCredentials();
    setApiKey(ak);
    setResourceId(rid || DEFAULT_RESOURCE_ID);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleTest = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    try {
      const credentials = editing
        ? {
            api_key: apiKey,
            resource_id: resourceId || DEFAULT_RESOURCE_ID,
          }
        : undefined;
      const res = await Promise.race([
        testVoiceConnection(credentials),
        new Promise<{ ok: false; error: string }>((_, reject) =>
          setTimeout(
            () => reject(new Error(t("testFailed"))),
            TEST_TIMEOUT_MS,
          ),
        ),
      ]);
      if (res.ok) {
        await setVoiceConnected();
        setConnected(true);
        messageApi.success(t("testSuccess"));
      } else {
        clearVoiceConnectionFlag();
        setConnected(false);
        messageApi.error(res.error || t("testFailed"));
      }
    } catch {
      clearVoiceConnectionFlag();
      setConnected(false);
      messageApi.error(t("testFailed"));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  }, [t, editing, apiKey, resourceId, messageApi]);

  const handleSave = async () => {
    clearVoiceConnectionFlag();
    setConnected(false);
    try {
      await saveVolcCredentials(apiKey, resourceId);
      setEditing(false);
    } catch {
      messageApi.error(t("testFailed"));
    }
  };

  const hasCreds = !!apiKey;
  const canTest = editing ? !!apiKey : hasCreds;

  const testButton = (
    <Button
      size="small"
      icon={React.createElement(ApiOutlined)}
      onClick={handleTest}
      loading={testing}
      disabled={!canTest}
    >
      {testing
        ? t("testing")
        : connected
          ? `${t("testConnected")} ✓`
          : t("testConnection")}
    </Button>
  );

  return (
    <Card
      style={cardStyle}
      extra={
        editing ? (
          <Space size="small">
            {testButton}
            <Button
              size="small"
              icon={React.createElement(CloseOutlined)}
              onClick={() => {
                setEditing(false);
                void loadConfig();
              }}
            >
              {t("cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={React.createElement(CheckOutlined)}
              onClick={handleSave}
            >
              {t("save", { defaultValue: "Save" })}
            </Button>
          </Space>
        ) : (
          <Space size="small">
            {testButton}
            <Button
              size="small"
              icon={React.createElement(EditOutlined)}
              onClick={() => setEditing(true)}
            >
              {t("edit", { defaultValue: "Edit" })}
            </Button>
          </Space>
        )
      }
    >
      {contextHolder}
      <h3 style={cardTitleStyle}>{t("volcengineConfigTitle")}</h3>
      <p style={cardDescStyle}>{t("volcengineConfigDesc")}</p>

      {!editing && loaded && (
        <div style={hintStyle}>
          {hasCreds ? (
            <>
              <div>{t("volcengineApiKeyLabel")}: ****</div>
              <div>
                {t("volcengineResourceIdLabel")}: {resourceId}
              </div>
            </>
          ) : (
            <div style={{ fontStyle: "italic" }}>
              {t("volcengineNotConfigured")}
            </div>
          )}
        </div>
      )}

      {editing && (
        <Form layout="vertical">
          <Form.Item label={t("volcengineApiKeyLabel")}>
            <Input.Password
              value={apiKey}
              onChange={(e: any) => setApiKey(e.target.value)}
              placeholder={t("volcengineApiKeyPlaceholder")}
            />
          </Form.Item>
          <Form.Item label={t("volcengineResourceIdLabel")}>
            <Input
              value={resourceId}
              onChange={(e: any) => setResourceId(e.target.value)}
              placeholder={DEFAULT_RESOURCE_ID}
            />
          </Form.Item>
        </Form>
      )}
    </Card>
  );
}

// ── Shortcut card ───────────────────────────────────────────────────────

function ShortcutSettings() {
  const { t } = useTranslation();
  const [shortcut, setShortcut] = useState<ShortcutDef>(loadShortcut);
  const [mode, setMode] = useState<ShortcutMode>(loadShortcutMode);
  const [capturing, setCapturing] = useState(false);
  const heldModifiersRef = useRef<Set<string>>(new Set());

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_CODES.has(e.code)) {
        heldModifiersRef.current.add(e.code);
        return;
      }
      const held = heldModifiersRef.current;
      const def: ShortcutDef = {
        ctrl: held.has("ControlLeft") || held.has("ControlRight"),
        shift: held.has("ShiftLeft") || held.has("ShiftRight"),
        alt: held.has("AltLeft") || held.has("AltRight"),
        meta: held.has("MetaLeft") || held.has("MetaRight"),
        code: e.code,
      };
      setShortcut(def);
      void saveShortcutConfig(def, mode);
      setCapturing(false);
      heldModifiersRef.current.clear();
    },
    [capturing, mode],
  );

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      if (MODIFIER_CODES.has(e.code)) {
        heldModifiersRef.current.delete(e.code);
        if (heldModifiersRef.current.size === 0) {
          const def: ShortcutDef = {
            ctrl: false,
            shift: false,
            alt: false,
            meta: false,
            code: e.code,
          };
          setShortcut(def);
          void saveShortcutConfig(def, mode);
          setCapturing(false);
        }
      }
    },
    [capturing, mode],
  );

  useEffect(() => {
    if (!capturing) return;
    heldModifiersRef.current.clear();
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [capturing, handleKeyDown, handleKeyUp]);

  return (
    <Card style={cardStyle}>
      <h3 style={cardTitleStyle}>{t("shortcutTitle")}</h3>
      <p style={cardDescStyle}>{t("shortcutDesc")}</p>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>
            {t("shortcutKey")}
          </div>
          <Button
            onClick={() => setCapturing(true)}
            style={{ minWidth: 200, textAlign: "center" }}
          >
            {capturing ? (
              <span style={{ color: "#1890ff" }}>
                {t("shortcutCapturing")}
              </span>
            ) : (
              <Tag color="blue" style={{ fontSize: 14, padding: "2px 8px" }}>
                {formatShortcut(shortcut)}
              </Tag>
            )}
          </Button>
        </div>
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>
            {t("shortcutMode")}
          </div>
          <Radio.Group
            value={mode}
            onChange={(e: any) => {
              const val = e.target.value as ShortcutMode;
              setMode(val);
              void saveShortcutConfig(shortcut, val);
            }}
          >
            <Space direction="vertical" size="small">
              <Radio value="toggle">
                <span style={optionLabelStyle}>
                  {t("shortcutModeToggle")}
                </span>
                <span style={optionDescStyle}>
                  {t("shortcutModeToggleDesc")}
                </span>
              </Radio>
              <Radio value="hold">
                <span style={optionLabelStyle}>
                  {t("shortcutModeHold")}
                </span>
                <span style={optionDescStyle}>
                  {t("shortcutModeHoldDesc")}
                </span>
              </Radio>
            </Space>
          </Radio.Group>
        </div>
      </Space>
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function VoiceSettingsPage() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: 24,
        maxWidth: 760,
        margin: "0 auto",
        height: "100%",
        overflowY: "auto",
      }}
    >
      <h2 style={{ margin: "0 0 4px", fontSize: 20 }}>
        {t("title")}
      </h2>
      <p style={cardDescStyle}>{t("description")}</p>
      <MasterSwitchCard />
      <VolcengineConfigCard />
      <ShortcutSettings />
    </div>
  );
}


