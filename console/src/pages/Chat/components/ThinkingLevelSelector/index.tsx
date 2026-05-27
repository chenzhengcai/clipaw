import { useState, useEffect, useCallback } from "react";
import { Dropdown, Tooltip } from "antd";
import { ThunderboltOutlined, ThunderboltFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { providerApi } from "../../../../api/modules/provider";
import { useAgentStore } from "../../../../stores/agentStore";

type ThinkingLevel = "close" | "high" | "max";

const ICON_COLORS: Record<ThinkingLevel, string> = {
  close: "#999",
  high: "#faad14",
  max: "#fa8c16",
};

export default function ThinkingLevelSelector() {
  const { t } = useTranslation();
  const { selectedAgent } = useAgentStore();
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("close");
  const [loading, setLoading] = useState(false);

  // Load current thinking_level from backend on mount / agent change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const active = await providerApi.getActiveModels({
          scope: "effective",
          agent_id: selectedAgent,
        });
        if (cancelled) return;
        const tl = active?.active_llm?.thinking_level;
        if (tl === "high" || tl === "max" || tl === "close") {
          setThinkingLevel(tl);
        }
      } catch {
        // backend may not have active model yet; ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  const handleChange = useCallback(
    async (level: ThinkingLevel) => {
      setThinkingLevel(level);
      setLoading(true);
      try {
        const active = await providerApi.getActiveModels({
          scope: "effective",
          agent_id: selectedAgent,
        });
        const activeLlm = active?.active_llm;
        if (activeLlm?.provider_id && activeLlm?.model) {
          await providerApi.setActiveLlm({
            provider_id: activeLlm.provider_id,
            model: activeLlm.model,
            scope: selectedAgent ? "agent" : "global",
            agent_id: selectedAgent || undefined,
            thinking_level: level,
          });
        }
      } catch {
        // revert on failure
        setThinkingLevel(thinkingLevel);
      } finally {
        setLoading(false);
      }
    },
    [selectedAgent, thinkingLevel],
  );

  const iconColor = ICON_COLORS[thinkingLevel];

  const menuItems = [
    {
      key: "close",
      label: t("modelSelector.thinkingClose"),
      icon: <ThunderboltOutlined style={{ fontSize: 14, color: "#999" }} />,
    },
    {
      key: "high",
      label: t("modelSelector.thinkingHigh"),
      icon: <ThunderboltOutlined style={{ fontSize: 14, color: "#faad14" }} />,
    },
    {
      key: "max",
      label: t("modelSelector.thinkingMax"),
      icon: <ThunderboltFilled style={{ fontSize: 14, color: "#fa8c16" }} />,
    },
  ];

  return (
    <Tooltip title={t("modelSelector.thinkingLevel")} mouseEnterDelay={0.5}>
      <Dropdown
        trigger={["click"]}
        disabled={loading}
        menu={{
          items: menuItems.map((item) => ({
            ...item,
            onClick: () => handleChange(item.key as ThinkingLevel),
          })),
          selectable: true,
          selectedKeys: [thinkingLevel],
        }}
      >
        {thinkingLevel === "max" ? (
          <ThunderboltFilled
            style={{
              fontSize: 18,
              color: iconColor,
              cursor: "pointer",
              transition: "color 0.2s",
            }}
          />
        ) : (
          <ThunderboltOutlined
            style={{
              fontSize: 18,
              color: iconColor,
              cursor: "pointer",
              transition: "color 0.2s",
            }}
          />
        )}
      </Dropdown>
    </Tooltip>
  );
}
