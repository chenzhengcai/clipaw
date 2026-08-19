/**
 * themes/purple/theme.ts — 紫色主题的 Ant Design token 覆盖配置
 *
 * 这里定义的 token 会通过 App.tsx 的 ConfigProvider 合并到 Ant Design 主题中，
 * 覆盖默认的橙色品牌色。
 *
 * CSS 变量覆盖由同目录的 tokens.css 和 overrides.css 处理。
 */
import type { ThemeOverride } from "../types";

// 副作用导入：注入 CSS 变量和全局样式覆盖
import "./tokens.css";
import "./overrides.css";

const purpleTheme: ThemeOverride = {
  id: "purple",
  name: "Purple Theme",
  description:
    "Elegant purple color scheme with smooth color transitions",
  version: "1.0.0",
  author: "Custom",

  // ── 亮色模式 token ──────────────────────────────────────────────────────
  lightTokens: {
    colorPrimary: "#7C5CFC",
    colorBgLayout: "#F8F7FC",
    colorBgContainer: "#FFFFFF",
    colorBgElevated: "#FFFFFF",
  },

  // ── 暗色模式 token ──────────────────────────────────────────────────────
  darkTokens: {
    colorPrimary: "#A78BFA",
    colorBgLayout: "#141418",
    colorBgContainer: "#1E1E24",
    colorBgElevated: "#252530",
  },

  // ── 亮色模式组件级覆盖 ──────────────────────────────────────────────────
  // 仅覆盖颜色相关属性，不改变布局/尺寸/圆角，保持官方原有的菜单折叠样式和布局
  lightComponents: {},

  // ── 暗色模式组件级覆盖 ─────────────────────────────────────────────────
  darkComponents: {},

  cssImports: ["./tokens.css", "./overrides.css"],
};

export default purpleTheme;

