import { useEffect, useState, useCallback } from "react";
import { Card, Radio, Space, Button, Tag } from "antd";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";

const STORAGE_KEY_SHORTCUT = "qwenpaw_voice_shortcut";
const STORAGE_KEY_MODE = "qwenpaw_voice_shortcut_mode";

export interface ShortcutDef {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  code: string; // event.code e.g. "KeyM"
}

export type ShortcutMode = "toggle" | "hold";

/** Detect macOS for display (⌘ vs Ctrl). */
function isMac(): boolean {
  return /Mac|iP(hone|[ao]d)/.test(navigator.platform || navigator.userAgent);
}

/** Format a ShortcutDef for display. */
export function formatShortcut(def: ShortcutDef): string {
  const mac = isMac();
  // Modifier-only key: just show the key name
  const modifierCodes: Record<string, string> = {
    AltLeft: mac ? "⌥" : "Alt",
    AltRight: mac ? "⌥" : "Alt",
    ControlLeft: mac ? "⌃" : "Ctrl",
    ControlRight: mac ? "⌃" : "Ctrl",
    ShiftLeft: mac ? "⇧" : "Shift",
    ShiftRight: mac ? "⇧" : "Shift",
    MetaLeft: mac ? "⌘" : "Win",
    MetaRight: mac ? "⌘" : "Win",
  };
  if (modifierCodes[def.code]) {
    return modifierCodes[def.code];
  }

  // Combination shortcut
  const parts = formatModifiers(def);
  const keyName = def.code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("Comma", ",")
    .replace("Period", ".")
    .replace("Slash", "/")
    .replace("Backslash", "\\")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Minus", "-")
    .replace("Equal", "=")
    .replace("Semicolon", ";")
    .replace("Quote", "'")
    .replace("Backquote", "`")
    .replace("Space", "Space");
  parts.push(keyName);
  return parts.join(mac ? "" : "+");
}

/** Default shortcut: Ctrl+Shift+M (Win) / Cmd+Shift+M (Mac). */
export function defaultShortcut(): ShortcutDef {
  const mac = isMac();
  return {
    ctrl: !mac,
    shift: true,
    alt: false,
    meta: mac,
    code: "KeyM",
  };
}

/** Return a display-friendly label for the primary modifier. */
function formatModifiers(def: ShortcutDef): string[] {
  const parts: string[] = [];
  const mac = isMac();
  if (def.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (def.alt) parts.push(mac ? "⌥" : "Alt");
  if (def.shift) parts.push(mac ? "⇧" : "Shift");
  if (def.meta) parts.push(mac ? "⌘" : "Win");
  return parts;
}

/** Read shortcut from localStorage. */
export function loadShortcut(): ShortcutDef {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SHORTCUT);
    if (raw) return JSON.parse(raw) as ShortcutDef;
  } catch { /* ignore */ }
  return defaultShortcut();
}

/** Read mode from localStorage. */
export function loadShortcutMode(): ShortcutMode {
  const raw = localStorage.getItem(STORAGE_KEY_MODE);
  return raw === "hold" ? "hold" : "toggle";
}

/** Save shortcut + mode to localStorage and backend. */
export async function saveShortcutConfig(def: ShortcutDef, mode: ShortcutMode): Promise<void> {
  localStorage.setItem(STORAGE_KEY_SHORTCUT, JSON.stringify(def));
  localStorage.setItem(STORAGE_KEY_MODE, mode);
  try {
    const { saveClientConfig } = await import("../../../../api/clientConfig");
    await saveClientConfig(STORAGE_KEY_SHORTCUT, JSON.stringify(def));
    await saveClientConfig(STORAGE_KEY_MODE, mode);
  } catch { /* backend not available */ }
}

const _MODIFIER_CODES = [
  "AltLeft","AltRight","ControlLeft","ControlRight",
  "ShiftLeft","ShiftRight","MetaLeft","MetaRight",
];

/** Check if a KeyboardEvent matches a ShortcutDef. */
export function matchShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  // Modifier-only shortcut: match by code only
  if (_MODIFIER_CODES.includes(def.code)) {
    return e.code === def.code;
  }
  // Combination shortcut: exact modifier match
  return (
    e.ctrlKey === def.ctrl &&
    e.shiftKey === def.shift &&
    e.altKey === def.alt &&
    e.metaKey === def.meta &&
    e.code === def.code
  );
}

export function ShortcutSettings() {
  const { t } = useTranslation();
  const [shortcut, setShortcut] = useState<ShortcutDef>(loadShortcut);
  const [mode, setMode] = useState<ShortcutMode>(loadShortcutMode);
  const [capturing, setCapturing] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();

      const isModifier = [
        "ControlLeft","ControlRight","ShiftLeft","ShiftRight",
        "AltLeft","AltRight","MetaLeft","MetaRight",
      ].includes(e.code);

      // For pure modifier keys (Alt/Ctrl/Shift/Cmd alone):
      // capture them as valid shortcuts.
      if (isModifier) {
        const def: ShortcutDef = {
          ctrl: false, shift: false, alt: false, meta: false,
          code: e.code,
        };
        setShortcut(def);
        saveShortcutConfig(def, mode);
        setCapturing(false);
        return;
      }

      // For normal keys: require at least one primary modifier
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        setCapturing(false);
        return;
      }

      const def: ShortcutDef = {
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
        code: e.code,
      };
      setShortcut(def);
      saveShortcutConfig(def, mode);
      setCapturing(false);
    },
    [capturing, mode],
  );

  useEffect(() => {
    if (capturing) {
      document.addEventListener("keydown", handleKeyDown, true);
      return () =>
        document.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [capturing, handleKeyDown]);

  const handleModeChange = (val: ShortcutMode) => {
    setMode(val);
    saveShortcutConfig(shortcut, val);
  };

  return (
    <Card className={styles.card}>
      <h3 className={styles.cardTitle}>
        {t("voiceTranscription.shortcutTitle")}
      </h3>
      <p className={styles.cardDescription}>
        {t("voiceTranscription.shortcutDesc")}
      </p>

      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {/* Shortcut key capture */}
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>
            {t("voiceTranscription.shortcutKey")}
          </div>
          <Button
            onClick={() => setCapturing(true)}
            style={{ minWidth: 200, textAlign: "center" }}
          >
            {capturing ? (
              <span style={{ color: "#1890ff" }}>
                {t("voiceTranscription.shortcutCapturing")}
              </span>
            ) : (
              <Tag color="blue" style={{ fontSize: 14, padding: "2px 8px" }}>
                {formatShortcut(shortcut)}
              </Tag>
            )}
          </Button>
        </div>

        {/* Mode selector */}
        <div>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>
            {t("voiceTranscription.shortcutMode")}
          </div>
          <Radio.Group value={mode} onChange={(e) => handleModeChange(e.target.value)}>
            <Space direction="vertical" size="small">
              <Radio value="toggle">
                <span className={styles.optionLabel}>
                  {t("voiceTranscription.shortcutModeToggle")}
                </span>
                <span className={styles.optionDescription}>
                  {t("voiceTranscription.shortcutModeToggleDesc")}
                </span>
              </Radio>
              <Radio value="hold">
                <span className={styles.optionLabel}>
                  {t("voiceTranscription.shortcutModeHold")}
                </span>
                <span className={styles.optionDescription}>
                  {t("voiceTranscription.shortcutModeHoldDesc")}
                </span>
              </Radio>
            </Space>
          </Radio.Group>
        </div>
      </Space>
    </Card>
  );
}
