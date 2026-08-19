import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Button, Empty, Spin, Table, Tabs } from "antd";
import { ExternalLink, Package, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { usePluginManager } from "./hooks/usePluginManager";
import { usePluginColumns } from "./hooks/usePluginColumns";
import { useInstallModal } from "./hooks/useInstallModal";
import { InstallPluginModal } from "./components/InstallPluginModal";
import { OfficialPluginList } from "./components/OfficialPluginList";
import { MarketPluginList } from "./components/MarketPluginList";
import {
  fetchBackgroundThemeEnabled,
  toggleBackgroundThemeEnabled,
} from "@/api/modules/plugin";
import { availableThemes } from "@/themes";
import { useThemeStore } from "@/stores/themeStore";
import type { PluginInfo } from "@/api/modules/plugin";
import styles from "./index.module.less";

const builtinThemeIds = new Set(availableThemes.map((t) => t.id));

const themePlugins: PluginInfo[] = availableThemes.map((t) => ({
  id: `theme-${t.id}`,
  name: t.name,
  version: t.version || "1.0.0",
  description: t.description || "",
  author: t.author || "Built-in",
  enabled: true,
  loaded: true,
  plugin_type: "frontend" as const,
}));

export default function PluginManagerPage() {
  const { t } = useTranslation();

  const { plugins, loading, refresh, uninstallingId, handleUninstall } =
    usePluginManager();
  const installModal = useInstallModal(refresh);

  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveThemeId = useThemeStore((s) => s.setActiveThemeId);

  const onToggleTheme = (themeId: string) => {
    setActiveThemeId(activeThemeId === themeId ? null : themeId);
  };

  // Background-theme master switch (plugin-backed, switch-only row).
  const [backgroundThemeEnabled, setBackgroundThemeEnabled] =
    useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBackgroundThemeEnabled().then((enabled) => {
      if (!cancelled) setBackgroundThemeEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggleBackgroundTheme = (enabled: boolean) => {
    // Optimistic flip; revert when the plugin backend is unreachable.
    const prev = backgroundThemeEnabled;
    setBackgroundThemeEnabled(enabled);
    toggleBackgroundThemeEnabled(enabled).then((next) => {
      if (next === null) setBackgroundThemeEnabled(prev);
    });
  };

  const columns = usePluginColumns({
    uninstallingId,
    onUninstall: handleUninstall,
    builtinThemeIds,
    activeThemeId,
    onToggleTheme,
    backgroundThemeEnabled,
    onToggleBackgroundTheme,
  });

  const dataSource = [...themePlugins, ...(plugins || [])];

  const tabItems = [
    {
      key: "installed",
      label: t("pluginManager.installed"),
      children: (
        <Spin spinning={loading}>
          {!loading && dataSource.length === 0 ? (
            <Empty
              image={<Package size={48} strokeWidth={1} />}
              description={t("pluginManager.noPlugins")}
              style={{ marginTop: 24 }}
            />
          ) : (
            <Table
              dataSource={dataSource}
              columns={columns}
              rowKey="id"
              pagination={false}
              className={styles.table}
            />
          )}
        </Spin>
      ),
    },
    {
      key: "official",
      label: t("pluginManager.officialTitle"),
      children: <OfficialPluginList onInstalled={refresh} />,
    },
    {
      key: "market",
      label: t("pluginManager.marketTitle"),
      children: <MarketPluginList onInstalled={refresh} />,
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        parent={t("nav.settings")}
        current={t("nav.pluginManager")}
        extra={
          <>
            <Button
              icon={<ExternalLink size={16} />}
              onClick={() =>
                window.open("https://platform.agentscope.io/plugins", "_blank")
              }
            >
              {t("pluginManager.publishBtn")}
            </Button>
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={installModal.openModal}
            >
              {t("pluginManager.installBtn")}
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        <Tabs items={tabItems} className={styles.tabs} />
      </div>

      <InstallPluginModal {...installModal} />
    </div>
  );
}
