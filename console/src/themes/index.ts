/**
 * themes/index.ts — 主题注册中心
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 使用方式：
 *
 *   所有可用主题在 availableThemes 数组中注册。
 *   通过 themeStore 中的 activeThemeId 控制当前激活哪个主题。
 *   在插件管理页面可以启用/禁用主题。
 *
 * 添加新主题：
 *   1. 创建 themes/<name>/theme.ts
 *   2. 在下面的 availableThemes 数组中注册
 * ═══════════════════════════════════════════════════════════════════════════
 */

import purpleTheme from "./purple/theme";
import type { ThemeOverride } from "./types";

// ── 所有可用主题 ─────────────────────────────────────────────────────────────
export const availableThemes: ThemeOverride[] = [purpleTheme];

// ── 兼容旧的静态导出（供不使用 store 的场景） ───────────────────────────────
export const activeTheme: ThemeOverride | undefined = purpleTheme;

