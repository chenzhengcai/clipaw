import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemeOverride } from "../themes/types";

const STORAGE_KEY = "qwenpaw-theme-storage";

interface ThemeStore {
  /** 当前激活的主题 ID，null 表示使用默认主题 */
  activeThemeId: string | null;
  /** 设置激活的主题 */
  setActiveThemeId: (id: string | null) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      activeThemeId: "purple", // 默认启用紫色主题
      setActiveThemeId: (id) => set({ activeThemeId: id }),
    }),
    {
      name: STORAGE_KEY,
    },
  ),
);

/**
 * 根据 store 中的 activeThemeId 查找对应的 ThemeOverride。
 * 在组件中使用：const theme = useActiveTheme();
 */
export function resolveActiveTheme(
  themes: ThemeOverride[],
  activeThemeId: string | null,
): ThemeOverride | undefined {
  if (!activeThemeId) return undefined;
  return themes.find((t) => t.id === activeThemeId);
}

