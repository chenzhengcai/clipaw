/**
 * themes/types.ts — 主题覆盖层的类型定义
 *
 * 设计目标：让自定义主题以"覆盖层"方式叠加到源码默认主题之上，
 * 不修改源码中的任何默认值，只在 ConfigProvider 合并时 merge 进去。
 */
import type { ThemeConfig } from "antd";

/**
 * 自定义主题覆盖配置。
 * 所有字段都是可选的——只覆盖你需要改的部分。
 */
export interface ThemeOverride {
  /** 主题唯一标识 */
  id: string;
  /** 主题显示名称 */
  name: string;
  /** 主题描述 */
  description?: string;
  /** 主题版本 */
  version?: string;
  /** 主题作者 */
  author?: string;
  /** 亮色模式下的 Ant Design theme token 覆盖 */
  lightTokens?: ThemeConfig["token"];
  /** 暗色模式下的 Ant Design theme token 覆盖 */
  darkTokens?: ThemeConfig["token"];
  /** 亮色模式下的组件级 token 覆盖 */
  lightComponents?: ThemeConfig["components"];
  /** 暗色模式下的组件级 token 覆盖 */
  darkComponents?: ThemeConfig["components"];
  /**
   * CSS 文件的 import 副作用。
   * 主题模块在顶层 import CSS 文件即可，此字段仅用于文档标记。
   */
  cssImports?: string[];
}

