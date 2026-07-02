# 自定义修改文档索引

> 本目录记录所有对源码的个性化修改，方便上游更新时快速定位冲突点和合并策略。
> 
> **格式说明**：这些文档以 LLM 高效检索为目标编写——使用结构化表格、代码 diff、ASCII 流程图、关键词密度高的章节标题，避免冗长叙述。

## 文档列表

| 文档 | 内容 | 创建日期 | 最新更新 |
|------|------|---------|---------|
| [purple-theme.md](./purple-theme.md) | 紫色主题插件化实现 — 三层覆盖架构、改动清单、冲突分析、变更历史 | 2026-06-18 | 2026-06-20 |
| [voice-transcription.md](./voice-transcription.md) | 语音转写功能 — 三种 ASR 后端架构、WebSocket 流式设计、前端组件树 | 2026-06-19 | 2026-06-19 |
| [token-usage-chart-smooth.md](./token-usage-chart-smooth.md) | Token 消耗折线图圆滑曲线修复 — @ant-design/plots v2 API 迁移适配 | 2026-06-19 | 2026-06-19 |
| [tauri-desktop-build.md](./tauri-desktop-build.md) | Tauri 桌面端打包 — 麦克风权限修复、PyInstaller 脚本修复、GitHub Actions 精简 | 2026-06-19 | 2026-06-19 |
| [agent-persistence.md](./agent-persistence.md) | Agent 选择持久化 — 三层存储链路，跨重启记住上次使用的 Agent | 2026-06-19 | 2026-06-20 |

## 快速检索指南（给 LLM）

按关键词检索对应文档：

| 关键词 | 文档 |
|--------|------|
| `purple`, `theme`, `#7C5CFC`, `color`, `overrides.css`, `tokens.css`, `data-theme`, `PluginManager`, `themeStore`, `侧边栏`, `Chat`, `气泡`, `bubble`, `选择器`, `下拉`, `橙色` | [purple-theme.md](./purple-theme.md) |
| `语音`, `voice`, `transcription`, `whisper`, `volcengine`, `ASR`, `WebSocket`, `录音`, `microphone`, `快捷键`, `push-to-talk` | [voice-transcription.md](./voice-transcription.md) |
| `折线图`, `chart`, `smooth`, `曲线`, `token usage`, `plots`, `Line`, `G2Plot`, `shape`, `Trend` | [token-usage-chart-smooth.md](./token-usage-chart-smooth.md) |
| `turn_usage`, `context_usage`, `console`, `环形`, `token`, `上下文`, `占比`, `AgentScope 2.0`, `session.state`, `memory_state`, `async_generator` | [token-usage-console-fix.md](./token-usage-console-fix.md) |
| `tauri`, `打包`, `dmg`, `app`, `entitlements`, `Info.plist`, `microphone mac`, `麦克风权限`, `PyInstaller`, `GitHub Actions`, `release`, `NSIS`, `desktop` | [tauri-desktop-build.md](./tauri-desktop-build.md) |
| `agent`, `智能体`, `选择`, `选择器`, `selector`, `持久化`, `persist`, `记住`, `重启`, `localStorage`, `clientConfig`, `saveClientConfig`, `active_agent`, `default`, `lastChatId`, `setLastChatId`, `clearLastChatId` | [agent-persistence.md](./agent-persistence.md) |
| `merge`, `合并`, `conflict`, `冲突`, `sessionApi`, `leadingUnresolved`, `reconnectIdentity`, `pendingDraft`, `ChatSessionInitializer` | [purple-theme.md](./purple-theme.md) 变更历史 |

## 维护原则

1. **每次个性化修改都在此目录留档**，记录改了什么、为什么改、怎么和上游合并
2. **上游更新后**，按文档中的"冲突分析"章节逐项检查
3. **定期审查**已有修改是否还有必要保留（上游可能已原生支持）
4. **文档风格**：结构化表格 > 段落叙述，代码 diff > 文字描述，ASCII 图 > 自然语言流程
