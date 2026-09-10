# clipaw2.x 迁移全面对账 — 定制完整性审计

| 属性 | 值 |
|------|-----|
| 审计日期 | 2026-09-10 |
| 对比基线 | clipaw2.0.0 分支（`d6797401`）+ docs/customs/ 全部 10 篇档案 |
| 审计方式 | 逐档案核对"改动清单"标记（符号/文件/端点）在 clipaw2.x 的存活状态 |
| 结论 | 10 项定制存活；**2 项回归**（本次已修复）；1 项有意弃用 |

## 1. 核对结果总表

| # | 定制项 | 核对标记 | 状态 |
|---|--------|---------|------|
| 1 | 紫色主题三层覆盖 | `themes/purple/{theme.ts,tokens.css,overrides.css}`、`stores/themeStore.ts`、App.tsx `data-theme` 动态设置 | ✅ 完好 |
| 2 | 主题切换入口 | 老方案=PluginManager 内置主题插件；现方案=`SidebarSettingsPanel`（activeThemeId + themeMode） | ✅ 有意迁移（见 §3） |
| 3 | 侧边栏 | 老方案=自定义 SectionHeader/collapsedSections；现方案=回归上游 token 体系 | ✅ 有意弃用（`91afbf02`）；wobble 抖动保留（`useInboxWobble.ts` + Sidebar 4 处引用） |
| 4 | Agent 选择持久化 | `agent.ts setActiveAgent`、`agentStore` 双写、后端 `PUT /agents/active`（routers/agents.py:547） | ✅ 完好 |
| 5 | 模型隐藏/显示 | RemoteModelManageModal `handleToggleModelVisibility`/EyeOff、`modelSelectorModels` hidden 过滤、zh/en locales keys | ✅ 完好 |
| 6 | 语音转写后端 | workspace.py 5 端点（transcribe/ws、voice-test-connection、client-config、transcription-provider-*）+ audio_transcription.py 全函数 | ✅ 完好 |
| 7 | 语音转写前端 | WhisperSpeechButton、VolcengineConfigCard、ShortcutSettings、clientConfig.ts | ✅ 完好（Chat 集成回归另见 voice-streaming-replace-regression.md，已修） |
| 8 | 文件附件可见性 | `message_convert.py` `_file_url_to_local_path` + file 分支 TextBlock 转换 | ✅ 完好 |
| 9 | 窗口关闭/后端孤儿 | `shutdown_initiated`（lib.rs:123/tray.rs:344）、CloseWindowPrompt、BackendLoadingPage、`post_desktop_shutdown` | ✅ 完好 |
| 10 | Tauri 打包 + 环境管理 | build_macos_pyinstaller.sh 等脚本、routers/envs.py | ✅ 完好 |

## 2. 本次发现并修复的回归

### 回归 A：Token 消耗曲线圆滑丢失

- **现象**：Settings→Token 消耗两个折线图回到直线段
- **根因**：上游 #7502 重构把 `useTokenTypeConfig`/`useModelTrendConfig` 的公共配置抽成了共享 `hooks/lineChartChrome.ts`，迁移时 `style` 对象里的 `shape: "smooth"` 丢了（顶层 `smooth: true` 是 v1 遗留，@ant-design/plots v2 静默忽略）
- **修复**：`lineChartChrome.ts:33` → `style: { lineWidth: 3, fillOpacity: 0, shape: "smooth" }`
- **注意**：老修复点在两个 hooks 文件里（doc 记录 93/79 行），现在收敛到 lineChartChrome.ts 一处——token-usage-chart-smooth.md 的"所在行"信息已过时

### 回归 B：App 启动时 loadClientConfig 调用丢失

- **现象**：Tauri 端口变化重启后，语音快捷键、上次 Agent、语音连接状态全部丢失（localStorage 按 origin 隔离）
- **根因**：老 App.tsx 第 168 行的 `import("./api/clientConfig").then((m) => m.loadClientConfig())` 启动 effect 在迁移中丢失；`clientConfig.ts` 本身完好但没人调用
- **修复**：App.tsx `AppInner` 挂载 effect（语言恢复之后）恢复同款动态 import 调用
- **影响**：此项丢失会放大"快捷键失效"的观感——后端存着的配置永远回不来

## 3. 有意弃用/迁移（非回归，勿"修复"）

| 老方案（clipaw2.0.0） | 现方案（clipaw2.x） | 依据 |
|---|---|---|
| Sidebar 自定义 SectionHeader 折叠导航 | 上游 Menu + 语义 token | 用户自有提交 `91afbf02`"侧边栏样式回归上游 token 体系，紫色差异收敛至 themes/purple" |
| PluginManager 注入内置主题插件（Switch 切换） | SidebarSettingsPanel 主题切换（themeMode + activeThemeId） | 同上重构；`themes/index.ts` 注释仍提"插件管理页面可启用"——注释已过时 |

> purple-theme.md 的"改动文件清单/变更历史"停在 2026-06-20，早于 91afbf02 重构，阅读时以 §3 为准。

## 4. 验证

- `npx tsc -b --noEmit` ✅
- `vitest run src/App.runtime.test.tsx src/pages/Settings/TokenUsage` ✅ 4 文件 / 20 用例
- （语音修复部分见 voice-streaming-replace-regression.md：Chat 目录 45 文件 / 580 用例）

## 5. 检索关键词

`迁移对账`, `clipaw2.x`, `d6797401`, `loadClientConfig`, `client-config.json`, `shape: "smooth"`, `lineChartChrome`, `Token 消耗`, `曲线`, `圆滑`, `折线图`, `端口变化`, `Tauri 重启丢配置`, `审计`, `定制完整性`
