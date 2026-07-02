import { useTranslation } from "react-i18next";
import { Button, Empty, Spin, Table, Tabs } from "antd";
import { ExternalLink, Package, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { usePluginManager } from "./hooks/usePluginManager";
import { usePluginColumns } from "./hooks/usePluginColumns";
import { useInstallModal } from "./hooks/useInstallModal";
import { InstallPluginModal } from "./components/InstallPluginModal";
import { OfficialPluginList } from "./components/OfficialPluginList";
import { MarketPluginList } from "./components/MarketPluginList";
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

  const columns = usePluginColumns({
    uninstallingId,
    onUninstall: handleUninstall,
    builtinThemeIds,
    activeThemeId,
    onToggleTheme,
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
