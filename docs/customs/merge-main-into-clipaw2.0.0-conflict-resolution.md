# 合并 main 到 clipaw2.0.0 — 冲突解决记录

## 基本信息

| 项目 | 值 |
|------|-----|
| 源分支 | `main` |
| 目标分支 | `clipaw2.0.0` |
| 合并时间 | 2026-07-24 |
| 合并前 clipaw2.0.0 HEAD | `3d4a0df3` (Merge branch 'agentscope-ai:main' into clipaw2.0.0) |
| main 最新提交 | `84b61ca3` (feat(inbox): wobble sidebar inbox on new approvals & color-code badge dot #6396) |
| 最终合并提交 | `ffdb750b` |

## 涉及提交

```
ffdb750b feat(sidebar): restore custom collapsible section headers with wobble fusion
f2f16bc3 feat(sidebar): default-collapse menu groups with auto-expand for active item
c6f6f186 Merge branch 'main' into clipaw2.0.0
84b61ca3 feat(inbox): wobble sidebar inbox on new approvals & color-code badge dot (#6396)
```

## 变更文件统计

共 13 个文件，+227/-26 行：

| 文件 | 变更 | 说明 |
|------|------|------|
| `console/src/hooks/useInboxWobble.ts` | 新增 (33 行) | wobble 开关 hook |
| `console/src/layouts/Sidebar.tsx` | +113/-26 | 核心冲突文件 |
| `console/src/layouts/index.module.less` | +62 | inboxShake 动画 + sideMenu 样式 |
| `console/src/layouts/registry/adapter.tsx` | +5/-0 | 新增 deriveOpenKeys / getItemClassName |
| `console/src/locales/en.json` | +2 | wobble 翻译 |
| `console/src/locales/id.json` | +2 | wobble 翻译 |
| `console/src/locales/ja.json` | +2 | wobble 翻译 |
| `console/src/locales/pt-BR.json` | +2 | wobble 翻译 |
| `console/src/locales/ru.json` | +2 | wobble 翻译 |
| `console/src/locales/vi.json` | +2 | wobble 翻译 |
| `console/src/locales/zh.json` | +2 | wobble 翻译 |
| `console/src/pages/Inbox/index.module.less` | +4 | 配套样式 |
| `console/src/pages/Inbox/index.tsx` | +22 | 配套调整 |

## 冲突文件

唯一冲突文件：`console/src/layouts/Sidebar.tsx`

其余 12 个文件均由 git 自动合并成功，无冲突。

## 冲突原因分析

两个分支对侧边栏菜单的 inbox badge 装饰和菜单渲染方式做了不同的实现，属于**功能冲突**：

| 功能维度 | main 分支 (PR #6396) | clipaw2.0.0 分支 |
|---|---|---|
| 菜单渲染 | antd `Menu` 组件 + `toAntdItems`/`deriveOpenKeys` | 自定义按钮 + `SectionHeader` + `collapsedSections` |
| inbox badge | antd `Badge` 组件，颜色区分（审批红 `#e04848` / 消息橙 `rgba(255,157,77,1)`） | 手动 inline span，固定橙色 |
| wobble 抖动 | 有（`useInboxWobble` + `shakeInbox` + hover 消除 + `seenApprovalIdsRef` 跟踪） | 无 |
| 折叠分组 | antd `Menu` 内置 `openKeys` 展开/折叠 | 自定义 `SectionHeader` + `collapsedSections` state，默认全折叠 |
| 审批颜色区分 | 有 | 无 |

冲突集中在 `decorateLabel` 函数及周围菜单项构造逻辑：main 新增了 wobble/颜色区分逻辑及 `agentMenuItems`/`settingsMenuItems`/`openKeys`，clipaw2.0.0 用的是手动 badge + 自定义按钮渲染。

## 解决过程

### 第一轮（有误）：直接采用 main 分支版本

初始方案用 `git checkout --theirs` 直接取 main 的 `Sidebar.tsx` 完整版本，理由是 main 功能更完整。

**问题**：直接采用 main 的 antd `Menu` 方案后，clipaw2.0.0 独有的自定义 `SectionHeader` 组件（带箭头图标的折叠分组标题）被丢失。虽然 antd `Menu` 的 `openKeys` 内置了分组展开/折叠，但视觉效果与交互方式与自定义 `SectionHeader` 完全不同：
- clipaw2.0.0 默认全折叠，点击 `SectionHeader` 展开
- main 默认全展开（`deriveOpenKeys` 返回所有分组 key）
- 自定义 `SectionHeader` 有箭头图标和专属样式，antd `SubMenu` 没有

### 第二轮（修正）：受控 openKeys 默认折叠

尝试把 `openKeys` 改成受控 state（初始空数组 = 全折叠），加 `onOpenChange` 响应用户点击，加自动展开选中项所在分组。

**问题**：仍然使用 antd `Menu` 的 `SubMenu`，视觉上是 antd 默认样式，不是 clipaw2.0.0 的自定义 `SectionHeader`。

### 第三轮（最终方案）：以 clipaw2.0.0 为基础融合 main 的 wobble

回退第二轮改动，以 clipaw2.0.0 的原始 `Sidebar.tsx`（commit `3d4a0df3`）为基础，手动融入 main 的 wobble 功能。

## 最终方案详情

### 保留 clipaw2.0.0 的部分

- **`SectionHeader` 组件**：带箭头图标的折叠分组标题，点击展开/收起
- **`collapsedSections` state**：默认全折叠（`core.control-group`、`core.agent-group`、`core.settings-group`、`plugins-group` 均为 `true`）
- **`toggleSection` 回调**：切换分组折叠状态
- **自定义按钮渲染**：`agentMenu.map` + `settingsMenu.map`，按 `__children` 分组渲染
- **`navSection` / `navItem` / `navItemActive` / `navItemBadge` 等样式**

### 融入 main 的部分

- **`useInboxWobble` hook**：用户可开关 wobble 功能
- **`shakeInbox` state**：新审批到达时设为 true
- **`effectiveShake = shakeInbox && wobbleEnabled`**：双重判断
- **`currentApprovalIdsRef` / `seenApprovalIdsRef`**：审批 ID 跟踪，检测新增审批
- **`handleInboxHover`**：hover Inbox 时标记已读、停止抖动
- **`inboxDotColor`**：颜色区分（有待审批 `#e04848` 红，仅未读消息 `rgba(255,157,77,1)` 橙）
- **inbox 菜单项加 `inboxShake` class**：抖动动画（展开模式 + simple 模式均生效）
- **inbox 菜单项加 `onMouseEnter={handleInboxHover}`**：hover 停止抖动
- **inbox polling 逻辑**：用 main 的审批跟踪版本（`currentIds` + `hasNewApprovals` 判断）

### 移除的 main 独有内容

- antd `Menu` 组件导入和渲染（改用自定义按钮）
- antd `Badge` 组件（改用手动 inline span）
- `toAntdItems` / `deriveOpenKeys` 导入（自定义渲染不需要）
- `agentMenuItems` / `settingsMenuItems` / `openKeys` memo
- `getItemClassName` 函数（改为直接在 render 中用 className 拼接）
- `inboxLiRefCallback`（antd `Menu` 专用，自定义按钮用 `onMouseEnter` 替代）

## 验证

- TypeScript 编译（`tsc --noEmit`）：零错误
- 无残留冲突标记
- 无未使用的 import
- 工作区干净

## 关键文件

- `console/src/layouts/Sidebar.tsx` — 核心冲突解决文件
- `console/src/hooks/useInboxWobble.ts` — main 新增的 wobble 开关 hook
- `console/src/layouts/index.module.less` — `inboxShake` 抖动动画 + `navSection`/`sectionHeader` 等样式
- `console/src/layouts/registry/adapter.tsx` — 自动合并，新增 `deriveOpenKeys`/`getItemClassName`（Sidebar 已不依赖，但保留供其他组件使用）