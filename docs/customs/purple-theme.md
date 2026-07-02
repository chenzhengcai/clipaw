# 紫色主题插件化实现

## 一、背景与目标

### 1.1 需求

将项目的整体 UI 主题从默认的**橙色**（`#FF7F16`）改为**淡紫色**（`#7C5CFC`）风格，包括：
- Ant Design 组件的品牌色（按钮、开关、链接、选中态等）
- 全局背景色、卡片背景色
- 暗色模式下的对应紫色调

> 注：不改变布局、圆角、字体、菜单高度等结构性属性，保持官方原有的左侧菜单折叠样式和布局。

### 1.2 约束

- 这是一个开源项目，上游会持续更新
- 个人修改必须**尽可能少地与源代码冲突**
- 需要能**一键启用/禁用**自定义主题
- 不能改动 57 个 `.module.less` 文件（上游几乎每次更新都会改这些文件）

### 1.3 参考

远程分支 `origin/purper-theme` 有一个侵入式实现，改动了 59 个样式文件 + `App.tsx`，总计 2716 行插入、2728 行删除。本方案从中提取了色值和 token 配置，但完全重新设计了架构。

---

## 二、方案设计过程

### 2.1 方案评估

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A. 直接改源码**（purper-theme 分支方式） | 效果最完整 | 改 59 个文件，上游更新必冲突 | 不可行 |
| **B. 用现有插件系统** | 零侵入 | 插件 API 只能改 Chat widget 的 `colorPrimary`，无法覆盖全局 | 能力不足 |
| **C. 扩展插件系统 + CSS 覆盖层** | 改动最小，效果好 | 需改 1 个源文件 | 采用 |

### 2.2 最终方案：三层覆盖架构

```
第 1 层：Ant Design Token 覆盖（通过 ConfigProvider）
  └─ 覆盖 colorPrimary、colorBgLayout 等颜色 token
  └─ 影响所有 Ant Design 组件的颜色样式（不改变布局/圆角/字体）

第 2 层：CSS 变量覆盖（通过 tokens.css）
  └─ 定义 --color-primary 等 CSS 变量
  └─ 影响 layout.css 和 .module.less 中引用 CSS 变量的部分

第 3 层：CSS 选择器覆盖（通过 overrides.css）
  └─ 用高优先级选择器覆盖硬编码色值
  └─ 影响 layout.css 中不使用 CSS 变量的硬编码样式
```

### 2.3 为什么不走远程插件加载流程

分析发现，项目的前端插件系统（`usePluginLoader.ts`）是通过后端 API `/api/frontend_plugin` 获取插件列表，然后动态下载远程 JS 文件执行。这个流程：
1. 需要后端配合注册插件
2. 插件以 JS bundle 形式加载，不适合注入 CSS 文件
3. 插件 API 只暴露了 `theme.set({ colorPrimary })` 一个主题扩展点
4. 无法覆盖 ConfigProvider 的完整 token 和 components 配置

因此选择了**本地主题覆盖层**方案，不走远程插件加载流程。

---

## 三、改动文件清单

### 3.1 修改的源文件（6 个）

| 文件 | 改动类型 | 改动内容 | 改动行数 |
|------|---------|---------|---------|
| `console/src/App.tsx` | 修改 | import 主题系统 + store + ConfigProvider 动态合并逻辑 + 启动时 loadClientConfig | +33 行 |
| `console/src/pages/Settings/PluginManager/index.tsx` | 修改 | 注入内置主题插件到已安装列表，支持 Switch 切换 | +35 行 |
| `console/src/pages/Settings/PluginManager/hooks/usePluginColumns.tsx` | 修改 | 主题插件显示 Palette 图标 + Built-in 标签 + Switch 操作列 | +50 行 |
| `console/src/layouts/index.module.less` | 修改 | CSS 变量化改造 + 新增折叠导航样式（navItem/sectionHeader 等）+ 回退值 | ~234 行改动 |
| `console/src/layouts/Sidebar.tsx` | 修改 | 从 Ant Design Menu 重构为自定义折叠式导航 + SectionHeader 组件 | ~287 行改动 |
| `console/src/layouts/Header.tsx` | 修改 | 隐藏 logoDivider / resourcesMenu / github 按钮 / headerDivider | ~8 行改动 |

**App.tsx 具体改动（`console/src/App.tsx`）：**

1. **第 39-40 行**：import 主题系统
   ```typescript
   import { availableThemes } from "./themes";
   import { useThemeStore, resolveActiveTheme } from "./stores/themeStore";
   ```
2. **第 137-149 行**：通过 store 动态获取当前主题 + `useEffect` 设置 `data-theme` 属性
3. **第 167 行**：启动时调用 `loadClientConfig()` 恢复客户端配置（语音设置、Agent 选择等）
4. **第 204-224 行**：在 ConfigProvider 的 `theme` 配置中，使用 `currentTheme` 动态合并 token 和 components

合并逻辑的设计要点：
- 默认 `colorPrimary: "#FF7F16"` 写在前面，`currentTheme` 的 token 展开在后面 → 紫色 `colorPrimary` 会覆盖橙色
- 当 `currentTheme` 为 `undefined` 时（禁用主题），展开结果为空对象 → 完全不影响源码默认行为
- `components` 只在 `currentTheme` 存在时才合并，避免空对象覆盖
- 使用 Zustand store 持久化到 localStorage，刷新页面后主题选择不丢失

**Sidebar.tsx 具体改动（`console/src/layouts/Sidebar.tsx`）：**

1. 移除了 Ant Design `Menu` / `Badge` / `toAntdItems` / `deriveOpenKeys` 的使用
2. 新增 `SectionHeader` 组件 — 可折叠的分组标题（带箭头动画）
3. 新增 `collapsedSections` state — 默认所有分组折叠
4. Agent 菜单和 Settings 菜单均从 `Menu` 组件改为自定义 `button` 列表
5. 每个菜单项使用 `.navItem` / `.navItemActive` 样式类
6. Inbox 未读消息用自定义小红点代替 `Badge` 组件
7. 所有样式通过 CSS 变量 + 回退值实现，紫色主题下自动着色

**Header.tsx 具体改动（`console/src/layouts/Header.tsx`）：**

1. 隐藏 `logoDivider`（`display: none`）
2. 隐藏 `resourcesMenuItems` 下拉菜单
3. 隐藏 GitHub 按钮和 `headerDivider`
4. 以上均通过 `style={{ display: "none" }}` 实现，不删除代码

**layouts/index.module.less 具体改动：**

1. 所有硬编码色值改为 CSS 变量 + 回退值（如 `var(--color-border, #eae9e7)`）
2. 新增 `.settingsSection` 样式（与 `.agentScopedSection` 视觉一致）
3. 新增 `.navItem` / `.navItemActive` / `.navItemIcon` / `.navItemBadge` / `.navItemLabel` / `.navDivider` 样式
4. 新增 `.navSection` / `.sectionHeader` / `.sectionHeaderLabel` / `.sectionHeaderArrow` / `.sectionHeaderArrowCollapsed` / `.navSectionItems` 样式
5. `.logoImg` 高度从 16px 改为 60px（logo 放大）
6. 暗色模式下所有新增样式都有对应的 CSS 变量覆盖

**PluginManager/index.tsx 具体改动：**

1. 导入 `availableThemes` 和 `useThemeStore`
2. 将 `availableThemes` 转换为 `PluginInfo[]` 格式，注入到已安装插件列表头部
3. 主题插件的"卸载"操作实际执行的是 `setActiveThemeId(null)` 禁用主题
4. 传递 `builtinThemeIds`、`activeThemeId`、`onToggleTheme` 给列定义

**usePluginColumns.tsx 具体改动：**

1. 新增 `builtinThemeIds`、`activeThemeId`、`onToggleTheme` 参数
2. 名称列：主题插件显示 `<Palette>` 图标（紫色）+ `Built-in` 标签
3. 操作列：主题插件显示 `<Switch>` 开关代替删除按钮

### 3.2 新增文件（7 个）

| 文件 | 用途 | 行数 |
|------|------|------|
| `console/src/themes/types.ts` | `ThemeOverride` 类型定义（含 description/version/author） | 39 行 |
| `console/src/themes/index.ts` | 主题注册中心（`availableThemes` 数组 + 兼容导出） | 26 行 |
| `console/src/themes/purple/theme.ts` | 紫色主题的 Ant Design token 和 components 配置 | 110 行 |
| `console/src/themes/purple/tokens.css` | 紫色主题的 CSS 变量定义（亮色 + 暗色） | 107 行 |
| `console/src/themes/purple/overrides.css` | 全局 CSS 样式覆盖（亮色 + 暗色 + 聊天框 + AgentSelector + 全量橙色扫描补全 + 折叠导航） | 2033 行 |
| `console/src/stores/themeStore.ts` | Zustand 主题状态管理（持久化到 localStorage） | 38 行 |
| `docs/customs/README.md` | 自定义修改文档索引 | 17 行 |

### 3.3 文件关系图

```
console/src/App.tsx
  │
  ├─ import { availableThemes } from "./themes"
  │    │
  │    └─ themes/index.ts (注册中心)
  │         │
  │         └─ import purpleTheme from "./purple/theme"
  │              │
  │              ├─ themes/purple/theme.ts (Ant Design token 配置)
  │              │    ├─ import "./tokens.css"   (CSS 变量)
  │              │    └─ import "./overrides.css" (全局覆盖，2033 行)
  │              │
  │              └─ themes/types.ts (ThemeOverride 接口定义)
  │
  └─ import { useThemeStore, resolveActiveTheme } from "./stores/themeStore"
       │
       └─ stores/themeStore.ts (Zustand + persist → localStorage)

console/src/layouts/
  ├─ Sidebar.tsx           ← 修改：自定义折叠导航替代 Ant Design Menu
  ├─ Header.tsx            ← 修改：隐藏部分元素
  └─ index.module.less     ← 修改：CSS 变量化 + 新增导航样式

console/src/pages/Settings/PluginManager/
  ├─ index.tsx (注入 themePlugins 到已安装列表)
  └─ hooks/usePluginColumns.tsx (主题插件的 Palette 图标 + Switch)
```

---

## 四、启用/禁用主题

### 4.1 方式一：通过插件管理页面（推荐）

1. 打开 Settings → Plugin Manager
2. 在已安装列表中找到 **Purple Theme**（带 `Built-in` 标签和 `Palette` 图标）
3. 使用右侧的 **Switch 开关** 切换启用/禁用
4. 主题切换**即时生效**，无需刷新页面
5. 选择会持久化到 `localStorage`（key: `qwenpaw-theme-storage`），刷新后保持

> 默认 `activeThemeId` 为 `"purple"`，即首次启动即启用紫色主题。

### 4.2 方式二：通过代码控制

**在 React 组件中：**

```typescript
import { useThemeStore } from "@/stores/themeStore";

// 启用紫色主题
useThemeStore.getState().setActiveThemeId("purple");

// 禁用自定义主题（回到默认橙色）
useThemeStore.getState().setActiveThemeId(null);
```

**在 themes/index.ts 中完全移除主题注册：**

```typescript
// 注释掉 import 行即可完全移除紫色主题
// import purpleTheme from "./purple/theme";
export const availableThemes: ThemeOverride[] = [];
```

### 4.3 禁用后的行为

当 `activeThemeId` 为 `null` 或找不到对应主题时：
- `resolveActiveTheme()` 返回 `undefined`
- `useEffect` 移除 `html` 元素的 `data-theme` 属性
- **CSS 层**：`tokens.css` 和 `overrides.css` 中所有规则都在 `html[data-theme="purple"]` 作用域下，属性移除后所有 CSS 覆盖**立即失效**
- **Ant Design Token 层**：`...(isDark ? currentTheme?.darkTokens : currentTheme?.lightTokens)` 展开为 `...undefined` = 空，不覆盖任何 token
- **Components 层**：`...(currentTheme ? { components: ... } : {})` 展开为 `...{}` = 空
- **结果**：完全回到源码官方默认的橙色主题，无任何残留样式

---

## 五、上游更新冲突分析

### 5.1 冲突风险评估

| 文件 | 冲突概率 | 原因 | 合并策略 |
|------|---------|------|---------|
| `console/src/App.tsx` | **中** | 上游可能修改 ConfigProvider 的 theme 配置 | 手动合并：保留上游改动 + 保留我们的 import 行和 theme 合并逻辑 |
| `console/src/pages/Settings/PluginManager/index.tsx` | **中** | 上游可能重构插件管理页面 | 手动合并：保留上游结构 + 重新注入 themePlugins 逻辑 |
| `console/src/pages/Settings/PluginManager/hooks/usePluginColumns.tsx` | **中** | 上游可能修改列定义 | 手动合并：保留上游列 + 重新加入主题插件的判断逻辑 |
| `console/src/layouts/Sidebar.tsx` | **高** | 完全重构了导航实现，从 Ant Design Menu 改为自定义按钮列表 | 手动合并：如果上游重构 Sidebar，需重新适配折叠导航逻辑。建议在上游更新后评估是否回退到 Menu 组件 |
| `console/src/layouts/Header.tsx` | **低** | 仅用 `display:none` 隐藏元素，不删除代码 | 合并时保留上游改动，重新添加 `display:none` |
| `console/src/layouts/index.module.less` | **高** | 上游频繁修改侧边栏布局样式 + 我们新增了大量导航样式 | 手动合并：保留上游改动 + 确保所有 CSS 变量仍有回退值 + 保留新增的 navItem/sectionHeader 样式 |
| `console/src/themes/*` | **无** | 纯新增目录，上游不会有同名文件 | 无需处理 |
| `console/src/stores/themeStore.ts` | **低** | 新增文件，但上游可能新增同名 store | 检查是否有命名冲突即可 |

### 5.2 App.tsx 冲突场景详解

**场景 1：上游修改了 `colorPrimary` 的值**

```diff
# 上游改动
- colorPrimary: "#FF7F16",
+ colorPrimary: "#1890ff",
```

→ 我们的代码在后面展开 `activeTheme?.lightTokens`，其中包含 `colorPrimary: "#7C5CFC"`，会覆盖上游的值。**无冲突**。

**场景 2：上游在 token 中新增了字段**

```diff
token: {
  colorPrimary: "#FF7F16",
+ colorSuccess: "#52c41a",
},
```

→ 我们的展开在最后，不会覆盖上游新增的字段（除非我们的 `lightTokens` 也定义了同名字段）。**无冲突**。

**场景 3：上游重构了 ConfigProvider 的写法**

例如上游把 `theme` 配置提取到一个变量中：

```typescript
const themeConfig = { ... };
<ConfigProvider theme={themeConfig} />
```

→ 这种情况需要**手动合并**：在新的 `themeConfig` 对象中加入我们的合并逻辑。

**场景 4：上游新增了 `components` 配置**

```diff
theme={{
  token: { colorPrimary: "#FF7F16" },
+ components: { Button: { borderRadius: 4 } },
}}
```

→ 我们的代码已经用 `...((selectedTheme as any)?.theme?.components || {})` 保留了上游的 components，然后展开我们的覆盖。**无冲突**。

### 5.3 Sidebar.tsx 冲突场景详解

> **重要**：Sidebar.tsx 是本次改动中冲突风险最高的文件。我们从 Ant Design `Menu` 组件完全重构为自定义 `button` 列表 + `SectionHeader` 折叠分组。

**场景 1：上游修改了 Menu 相关逻辑**

→ 如果上游修改了 `toAntdItems`、`deriveOpenKeys` 等适配器函数，我们的代码已经不使用这些函数，**无冲突**。但如果上游修改了 `agentMenu` / `settingsMenu` 的数据结构，我们的 `__children` 遍历逻辑需要适配。

**场景 2：上游修改了菜单项的点击行为**

→ 我们使用 `handleMenuClick` 保持与上游一致的点击逻辑，**低冲突风险**。

**场景 3：上游重构了整个 Sidebar 组件**

→ 需要重新评估是否保留自定义导航，或回退到上游的 Menu 实现。**高冲突风险**。

### 5.4 合并检查清单

上游更新后，按以下步骤检查：

1. `git diff main -- console/src/App.tsx` — 检查 App.tsx 是否有改动
2. 如果有改动，重点看 `ConfigProvider` 的 `theme` 属性是否变化
3. 确认我们的 `import { availableThemes }` 行还在
4. 确认我们的 `import { useThemeStore, resolveActiveTheme }` 行还在
5. 确认 `theme.token` 中的展开逻辑还在
6. 确认 `theme.components` 的合并逻辑还在
7. `git diff main -- console/src/layouts/Sidebar.tsx` — 检查 Sidebar 是否有改动（**重点关注**）
8. 如果有改动，确认 `SectionHeader` 组件和折叠导航逻辑是否需要适配
9. `git diff main -- console/src/layouts/index.module.less` — 检查样式是否有改动
10. 确认所有 CSS 变量仍有回退值
11. 确认新增的 `.navItem` / `.sectionHeader` 等样式还在
12. `git diff main -- console/src/pages/Settings/PluginManager/` — 检查插件管理是否有改动
13. `git diff main -- console/src/stores/` — 检查是否有新增的 themeStore 命名冲突
14. 运行 `npx tsc --noEmit` 确认类型无误
15. 启动 dev server 目视确认紫色主题生效
16. 进入 Settings → Plugin Manager 确认 Purple Theme 显示正常
17. 测试折叠导航的展开/折叠功能正常
18. 测试暗色模式下紫色主题正常

---

## 六、覆盖效果说明

### 6.1 Ant Design Token 覆盖（第 1 层）

通过 ConfigProvider 的 `theme.token` 覆盖，影响**所有 Ant Design 组件**：

| Token | 亮色值 | 暗色值 | 效果 |
|-------|--------|--------|------|
| `colorPrimary` | `#7C5CFC` | `#A78BFA` | 按钮、链接、选中态等主色 |
| `colorBgLayout` | `#F8F7FC` | `#141418` | 页面背景（淡紫灰） |
| `colorBgContainer` | `#FFFFFF` | `#1E1E24` | 卡片/容器背景 |
| `colorBgElevated` | `#FFFFFF` | `#252530` | 弹窗/下拉框背景 |

> 注：不再覆盖 `borderRadius`、`borderRadiusSM`、`borderRadiusLG`、`fontFamily` 等布局/排版属性，保持官方默认值。组件级覆盖（`lightComponents`/`darkComponents`）也已清空，不再改变菜单高度、按钮高度、圆角等。

### 6.2 CSS 变量覆盖（第 2 层）

`tokens.css` 定义的 CSS 变量会覆盖源码中 `var(--colorPrimary, #ff9d4d)` 等回退值：

| CSS 变量 | 亮色值 | 暗色值 |
|---------|--------|--------|
| `--color-primary` | `#7c5cfc` | `#a78bfa` |
| `--color-primary-hover` | `#6b4fe8` | `#b9a0fb` |
| `--color-primary-bg` | `rgba(124,92,252,0.08)` | `rgba(167,139,250,0.15)` |
| `--color-bg-base` | `#f8f7fc` | `#141418` |
| `--shadow-primary` | 紫色阴影 | 紫色阴影 |
| `--color-border` | `#cdd0dc` | `rgba(71,71,97,0.8)` |
| `--color-text-primary` | `rgba(38,36,76,0.88)` | `rgba(231,231,237,0.88)` |
| `--space-xs/sm/md/lg` | `4/8/12/16px` | 同亮色 |
| `--radius-sm/md/lg` | `8/12/16px` | 同亮色 |
| `--transition-fast` | `0.15s ease` | 同亮色 |
| `--font-family` | 系统字体栈 | 同亮色 |

### 6.3 CSS 选择器覆盖（第 3 层）

`overrides.css` 用高优先级选择器覆盖硬编码色值，共 2033 行，覆盖的组件包括：

- 全局背景色（body、layout、sider、header）
- 侧边栏相关（agentScopedSection、agentSelectorContainer、collapseToggleContainer、settingsSection）
- 自定义导航项（navItem、navItemActive、navItemBadge、sectionHeader）
- 菜单项选中/hover 态（包括 stickyChatButton）
- 折叠按钮 / 模式切换 / 收起导航项
- Simple 模式（新建聊天、导航项、会话列表）
- 版本号 / Update Modal
- 按钮 primary/hover/active（带紫色阴影）
- 链接色
- Switch、Tabs、Checkbox、Radio
- Input/Select focus 边框（紫色光晕）
- Pagination 当前页
- Spin、Badge、Progress、Slider
- Select 选中项、DatePicker 今日/选中
- Table 排序图标、Tag purple 增强
- Segmented 选中态、Steps 进度条
- 未读通知圆点
- **Chat 页面**（suggestionCommand 建议命令、prompt-icon 提示图标）
- **ModelSelector**（trigger 触发器、tabButton 标签按钮、modelItem 选中/hover、checkIcon 对勾、providerTag 标签）
- **ChatSessionDrawer/ChatSessionItem**（会话列表选中态、pin 按钮、新建会话按钮）
- **ChatActionGroup**（内联 style 的 color 覆盖）
- **chat-anywhere**（消息链接色、输入框焦点态、发送按钮、工具按钮 hover）
- **聊天气泡/输入框整体增强**（用户消息气泡紫色渐变背景、输入框焦点紫色光晕、代码块边框）
- 暗色模式下的全量覆盖（以上所有组件的暗色版本）
- 全局美化增强（卡片悬浮阴影、按钮过渡动画、滚动条美化、设置面板选中态）
- **layout.css 暗色模式全量覆盖**（pagination、checkbox、slider、datepicker、select、table sorter 等暗色模式下的 `#ff7f16` 硬编码）
- **layout.css 亮色模式背景覆盖**（body、`.ant-layout`、`.qwenpaw-menu` 的 `#f9f8f4` 暖灰背景 → 淡紫灰）
- **layouts/index.module.less 硬编码覆盖**（collapseToggle hover、modeToggleActive、simpleNewChat 暗色、collapsedNavItemActive 暗色、updateModalVersionTag 等）
- **全局 Tabs `!important` 覆盖**（Security、Config、Environments 等页面通过 `:global` 设置的 `#ff7f16 !important`）
- **各页面 .module.less 选中态覆盖**（Environments、Security、Agent/Config、Agent/Workspace、Agent/Skills、Agent/Tools、Settings/Models、Settings/SkillPool、Settings/Agents、Control/Channels、Inbox、Settings/Market、VoiceTranscription 等）
- **AgentSelector 补充覆盖**（`rgba(43,18,0,...)` 背景 → 紫色）
- **Control 页面背景覆盖**（Sessions、CronJobs、Heartbeat 的 `#f9f8f4` → 淡紫灰）
- **ThemeToggleButton / LanguageSwitcher** 悬浮背景覆盖
- **sidebarSettingsPanel / sidebarSessionList** 回退色覆盖
- **全局美化增强**（卡片边框微调、Modal/Drawer 阴影增强、Dropdown 阴影、输入框过渡动画、Divider 颜色）

---

## 七、侧边栏重构说明

### 7.1 背景

原 Sidebar 使用 Ant Design `Menu` 组件渲染导航。为配合紫色主题的视觉效果，并改善折叠分组体验，将其重构为自定义导航组件。

### 7.2 重构内容

| 原实现 | 新实现 |
|--------|--------|
| Ant Design `<Menu mode="inline">` | 自定义 `<button>` 列表 |
| `toAntdItems()` 适配器 | 直接遍历 `MenuItem.__children` |
| `deriveOpenKeys()` 自动展开 | `collapsedSections` state 手动控制 |
| Ant Design `<Badge>` 未读标记 | 自定义小红点 `<span>` |
| Menu 内置样式 | `.navItem` / `.navItemActive` CSS 类 |

### 7.3 SectionHeader 组件

新增 `SectionHeader` 组件作为可折叠的分组标题：
- 显示分组名称 + 箭头图标
- 点击切换折叠/展开
- 折叠时箭头朝右（`rotate(0deg)`），展开时朝下（`rotate(90deg)`）
- 默认所有分组折叠

### 7.4 注意事项

- 此重构与紫色主题**解耦**：即使禁用紫色主题，自定义导航仍然生效（所有样式有回退值）
- 如果希望恢复官方 Menu 组件，需要 revert `Sidebar.tsx` 和 `index.module.less` 的改动
- `index.module.less` 中的 `.navItem` 等新样式使用了 CSS 变量 + 回退值，在禁用紫色主题时会回退到官方橙色

---

## 八、未覆盖的部分与已知限制

### 8.1 未覆盖

| 部分 | 原因 | 影响 |
|------|------|------|
| `.module.less` 中的 CSS Modules 类名内部样式 | CSS Modules 编译后类名带 hash，部分组件内部 hover 色、边框色通过 `[class*="name"]` 属性选择器已覆盖大部分，但可能仍有极少数遗漏 | 极少数组件内部可能有橙色残留 |
| Chat widget 内部样式（`@agentscope-ai/chat` 包） | 独立包，CSS 封装在内部 | 聊天气泡的部分内部样式仍为橙色 |
| Login 页面的部分样式 | Login 页面有独立的内联样式 | 登录页的 logo 和部分装饰色 |
| `@agentscope-ai/design` 包内的样式 | 第三方包，无法通过 CSS 覆盖 | 极少数组件可能有橙色残留 |
| TSX 内联 `style={{ color: "#FF7F16" }}` | 内联样式优先级最高，CSS 无法覆盖 | ModelSelector Loading 图标、ChannelDrawer 文字色、ACPDrawer 文字色、AgentStats 图表色等 |
| TSX 中 `strokeColor="#ff7f16"` 的 Progress 组件 | antd Progress 的 strokeColor prop 直接渲染为 SVG stroke 属性，CSS 无法覆盖 | LocalModelManageModal、LocalRuntimePanel、HarvestCard 的进度条 |
| TSX 中 `color="#ff7f16"` 的 Badge 组件 | antd Badge 的 color prop 生成内联样式 | Inbox 页面的未读徽标 |
| `#faad14` / `#fa8c16` | antd 标准 warning/orange 色，不属于品牌橙色系 | 不需要覆盖，保持原样 |

> **注**：Chat 页面的 ModelSelector、ChatSessionDrawer/Item、ChatActionGroup、chat-anywhere 等组件已在 `overrides.css` 中完成紫色覆盖。上表中的"Chat widget 内部样式"特指 `@agentscope-ai/chat` 这个独立 npm 包内封装的 CSS。

### 8.2 已知限制

1. **CSS 覆盖层的优先级问题**：部分 `.module.less` 中使用了 `:global(.dark-mode) .xxx` 选择器，优先级可能高于 `overrides.css` 中的选择器。如果发现某处颜色没有被覆盖，可能需要在 `overrides.css` 中增加更具体的选择器或 `!important`。

2. **CSS 变量命名不统一**：源码中 CSS 变量有多种命名风格（`--colorPrimary`、`--color-primary`、`--color-fill-tertiary`），`tokens.css` 目前只覆盖了 `--color-*` 风格的变量。Ant Design 注入的 `--colorPrimary` 等变量由 ConfigProvider token 控制，不需要在 CSS 中重复定义。

3. **Vite HMR**：修改 `tokens.css` 或 `overrides.css` 后，Vite 的 HMR 会自动更新样式，无需刷新页面。但修改 `theme.ts` 中的 token 值后需要刷新页面（因为 ConfigProvider 需要重新渲染）。

4. **Sidebar 重构的冲突风险**：Sidebar.tsx 从 Ant Design Menu 完全重构为自定义导航，是所有改动中上游冲突风险最高的文件。上游更新时需要特别关注此文件。

5. **Header 隐藏元素**：通过 `display: none` 隐藏了 logoDivider、resources 菜单、GitHub 按钮和 headerDivider，不删除代码以便上游更新时容易合并。

---

## 九、后续优化方向

### 9.1 短期优化

1. **补充 CSS 变量覆盖**：逐步排查 `.module.less` 中引用 `--colorPrimary`（驼峰命名）的地方，在 `tokens.css` 中补充对应的 CSS 变量
2. **Chat widget 主题**：通过现有插件 API `window.QwenPaw.chat.theme.set("purple-theme", { colorPrimary: "#7C5CFC" })` 覆盖 Chat widget 的主色
3. **Login 页面**：在 `overrides.css` 中补充 Login 页面的样式覆盖
4. **左侧菜单深度优化**：进一步优化侧边栏的间距、图标大小、文字排版，使整体更精致

### 9.2 中期优化

1. **推动上游统一 CSS 变量**：如果上游接受 PR，将 `.module.less` 中的硬编码色值改为 CSS 变量引用，那么我们的 `tokens.css` 就能覆盖所有地方
2. **主题市场**：支持从远程下载和安装第三方主题（扩展 `availableThemes` 的注册机制）
3. **更多主题**：在 `themes/` 下添加更多主题（如 blue、green），通过插件管理页面切换
4. **主题预览**：在插件管理中增加主题预览功能，切换前可以预览效果

### 9.3 长期优化

1. **推动上游支持完整的主题插件 API**：扩展 `window.QwenPaw.chat.theme.set` 支持完整的 Ant Design token，并增加 `window.QwenPaw.theme.set` 全局主题 API
2. **CSS-in-JS 迁移**：如果上游从 Less/CSS Modules 迁移到 CSS-in-JS（如 antd-style 的 `createStyles`），主题覆盖会更容易，因为所有样式都可以通过 token 控制
3. **主题导出/分享**：支持将自定义主题导出为 JSON 配置，方便分享给其他用户

---

## 十、文件结构总览

```
console/src/
├── themes/                          ← 新增：主题覆盖层
│   ├── types.ts                        ThemeOverride 类型定义（含 description/version/author）
│   ├── index.ts                        主题注册中心（availableThemes 数组）
│   └── purple/                         紫色主题
│       ├── theme.ts                    Ant Design token + components 配置（110 行）
│       ├── tokens.css                  CSS 变量定义（亮色 + 暗色，107 行）
│       └── overrides.css               全局 CSS 样式覆盖（亮色 + 暗色 + 美化 + 全量橙色扫描补全 + 折叠导航，2033 行）
├── stores/
│   └── themeStore.ts                ← 新增：Zustand 主题状态管理（persist → localStorage）
├── layouts/
│   ├── Sidebar.tsx                  ← 修改：自定义折叠导航替代 Ant Design Menu
│   ├── Header.tsx                   ← 修改：隐藏部分元素（display:none）
│   └── index.module.less            ← 修改：CSS 变量化 + 新增导航样式 + 回退值
├── pages/Settings/PluginManager/
│   ├── index.tsx                    ← 修改：注入 themePlugins 到已安装列表
│   └── hooks/usePluginColumns.tsx   ← 修改：主题插件的 Palette 图标 + Switch
├── App.tsx                          ← 修改：import 主题系统 + 动态合并逻辑 + loadClientConfig
└── ...
```

---

## 十一、相关引用

| 资源 | 说明 |
|------|------|
| `origin/purper-theme` 分支 | 侵入式实现参考，色值和 token 配置来源 |
| [Ant Design 主题定制文档](https://ant.design/docs/react/customize-theme-cn) | ConfigProvider theme token 参考 |
| [Zustand 文档](https://docs.pmnd.rs/zustand) | 状态管理和 persist 中间件参考 |
| `console/src/styles/layout.css` | 源码全局样式，包含大量暗色模式覆盖 |
| `console/src/plugins/hostSdk/install.ts` | 现有插件 theme API（只支持 colorPrimary） |
| `console/src/contexts/ThemeContext.tsx` | 亮色/暗色模式切换机制 |
| `console/src/pages/Settings/PluginManager/` | 插件管理页面（注入主题插件的位置） |
| `console/src/api/modules/plugin.ts` | `PluginInfo` 类型定义（themePlugin 的类型基础） |

---

## 十二、变更历史

| 日期 | 变更内容 | 涉及文件 |
|------|---------|---------|
| 2026-06-18 (第一轮) | 初始实现：三层覆盖架构 + 静态主题注入 | App.tsx, themes/ (5 文件) |
| 2026-06-18 (第二轮) | 插件管理集成 + 动态主题切换 + 全局样式优化 | App.tsx, themeStore.ts, PluginManager (2 文件), types.ts, index.ts, theme.ts, overrides.css (1161 行) |
| 2026-06-18 (修复) | 移除 App.tsx 中未使用的 `activeTheme` 导入 | App.tsx |
| 2026-06-19 (关键修复) | **CSS 作用域化**：所有 CSS 规则从 `:root`/`html` 改为 `html[data-theme="purple"]` 作用域，App.tsx 新增 `useEffect` 动态设置/移除 `data-theme` 属性。修复了"插件关闭后 CSS 覆盖仍然生效"的问题 | tokens.css, overrides.css, App.tsx |
| 2026-06-19 (布局还原) | **移除所有布局/尺寸/圆角覆盖**：删除 `lightTokens`/`darkTokens` 中的 `borderRadius`、`borderRadiusSM`、`borderRadiusLG`、`fontFamily`；清空 `lightComponents`/`darkComponents`。确保左侧菜单折叠样式、布局完全保持官方原有行为，紫色主题仅做颜色替换 | theme.ts |
| 2026-06-19 (聊天框紫色覆盖) | **新增聊天框全面紫色覆盖**：ModelSelector、ChatSessionDrawer/Item、ChatActionGroup、chat-anywhere 等组件 | overrides.css (+521 行) |
| 2026-06-19 (回退值修复) | **修复插件关闭后侧边栏样式丢失**：为 `index.module.less` 中所有无回退值的 CSS 变量添加官方默认回退值 | index.module.less |
| 2026-06-19 (CSS变量补全) | **补全 tokens.css 缺失变量**：补全 17 个变量（亮色+暗色） | tokens.css (+45 行) |
| 2026-06-19 (气泡选择器修复) | 修复聊天气泡背景误覆盖整行 | overrides.css |
| 2026-06-19 (AgentSelector紫色覆盖) | 新增智能体选择器紫色覆盖 | overrides.css (+120 行) |
| 2026-06-19 (精简模式按钮修复) | 修复精简模式"新建聊天"按钮橙色问题 | overrides.css (+20 行) |
| 2026-06-19 (合并 qwenmain) | 第一次上游合并 | Chat/index.tsx |
| 2026-06-20 (合并 qwenmain 2.0) | 第二次上游合并 | sessionApi, Chat/index.tsx, desktop-release.yml |
| 2026-06-20 (移除 pendingDraft) | 清理兼容层 | sessionApi, Chat/index.tsx |
| 2026-07-02 (全量橙色扫描补全) | **全量扫描源码橙色硬编码并补全覆盖**：layout.css 暗色/亮色、各页面 .module.less 选中态、AgentSelector、全局 Tabs `!important`、全局美化增强等 | overrides.css (+~450 行) |
| 2026-07-02 (侧边栏重构) | **Sidebar 从 Ant Design Menu 重构为自定义折叠导航**：新增 SectionHeader 组件、navItem/navItemActive 样式、collapsedSections state、Inbox 自定义红点。Header 隐藏 logoDivider/resources/GitHub。index.module.less CSS 变量化改造 + 新增导航样式 + logo 放大。overrides.css 新增折叠导航紫色覆盖 | Sidebar.tsx, Header.tsx, index.module.less, overrides.css |
| 2026-07-02 (App.tsx 集成) | App.tsx 新增 `loadClientConfig()` 调用，恢复语音设置和 Agent 选择 | App.tsx |