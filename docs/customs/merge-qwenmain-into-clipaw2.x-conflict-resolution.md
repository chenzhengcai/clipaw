# 合并 qwenmain 到 clipaw2.x — 冲突解决记录

| 项目 | 值 |
|------|-----|
| 源分支 | `qwenmain`（上游同步分支） |
| 目标分支 | `clipaw2.x`（fork 主分支） |
| 合并时间 | 2026-11-18 |
| 合并前 clipaw2.x HEAD | `ddfd724f6`（fix） |
| 合并前 qwenmain HEAD | `014e87674`（Merge remote-tracking branch 'upstream/main' into qwenmain） |
| 合并基线（merge-base） | `505a5c6fa`（perf(history): reuse workspace-owned SQLite connections #8482，2026-10-30） |
| 冲突文件数 | 12 |
| 备份分支 | `backup/clipaw2.x-pre-merge-ddfd724f6`、tag `backup-pre-qwenmain-merge` |

## 0. 关键前提：qwenmain 不是纯净的上游分支

合并前必须知道这一事实，否则冲突会解错：

| 事实 | 数值 | 说明 |
|------|------|------|
| `upstream/main` 是否已全部并入 qwenmain | 是（upstream 侧 0 个提交未合并） | 上游进度都在里面 |
| qwenmain 中不属于 upstream 的提交 | 128 个 | 全部来自历史 fork 线（`clipaw2.0.0`） |
| qwenmain 与 upstream/main 的树差异 | 58 个文件 | 旧 fork 残留：`background-theme` 插件、`docs/customs/*`、旧语音组件、紫色主题、旧品牌图、`workspace.py` 旧语音端点、`message_convert.py` 等 |

结论：`git merge qwenmain` 同时带来「上游进度 + 旧 fork 残留」。旧残留大部分与 clipaw2.x 现有实现重复（且更旧），少量是 clipaw2.x **已删除**的东西（紫色主题、旧语音内置组件），必须在合并结果中保持删除。

## 1. 冲突根因：criss-cross 历史 + 递归虚拟基线

两个分支存在 **两个 merge base**：

```
505a5c6fa  ← 最后一个共同的上游提交（本应作为语义基线）
82a8d38a3  ← 2026-09-04 的 qwenmain 提交（当时已含 fork 代码），也是共同祖先
```

Git 用 `ort` 策略递归合并两个基线生成**虚拟基线**。该虚拟基线 ≈ 9 月的「上游 + fork」状态，于是：

- 某个 fork 定制**存在于虚拟基线**（9 月就有）
- qwenmain 当前版本**没有**它（qwenmain 自己的上游同步曾把它丢掉）
- clipaw2.x **有**它（且未改动）

→ git 判定「ours 未改、theirs 删除」→ **静默接受删除**，不产生冲突标记。

**这就是本次合并最危险的地方：丢功能不报冲突。**

### 本次实际发现的 3 处静默回退（已全部修复）

| # | 文件 | 被回退的 fork 定制 | 现象 | 修复 |
|---|------|-------------------|------|------|
| 1 | `src/qwenpaw/app/_app.py` | `_sync_bundled_plugins(get_plugins_dir())` 调用 | 函数定义还在，**调用点被吞**，启动时不再把 `plugins/apps/*` 同步到运行时插件目录 → 背景主题/语音插件不再自动安装 | 在插件初始化块补回调用（调用点 `_background_startup`） |
| 2 | `console/src-tauri/tauri.conf.json` | 品牌名 `CliPaw` / `io.agentscope.clipaw.desktop` / 窗口标题 `CliPaw` | 自动合并改回 `QwenPaw Desktop` / `io.agentscope.qwenpaw.desktop`（identifier 变化会导致升级/数据目录不兼容） | 恢复 3 处品牌字段，保留上游新增的 `"create": false` |
| 3 | 全仓库其余 74 个 fork 专属文件 | — | 审计后**未再发现**静默回退（见 §4） | — |

## 2. 方法与审计口径

为避免上述陷阱，本次不依赖「无冲突即正确」，改用集合审计（以 `505a5c6fa` 为语义基线）：

| 集合 | 定义 | 判据 | 结果 |
|------|------|------|------|
| F（fork 改动） | `diff 505a5c6fa..clipaw2.x` 的文件 | 94 个 | — |
| U（上游改动） | `diff 505a5c6fa..upstream/main` 的文件 | 1128 个 | — |
| F \ U（仅 fork 改动） | 74 个 | 合并后必须**逐字节等于** fork 版本 | ✅ 74/74 |
| F ∩ U（双方都改） | 20 个 | 逐个人工核对 fork 意图 + 上游意图 | ✅ 全部核对 |
| 上游文件丢失 | `upstream/main` 有、合并后无 | 必须为 0 | ✅ 0 |
| 非上游新增文件 | 合并后新增、但 `upstream/main` 里没有 | 必须为 0（防残留复活） | ✅ 0 |
| 删除文件 | 合并后减少的 45 个 | 必须全是上游重构（`src/qwenpaw/harnesses/*` → `plugins/harness/*` 等） | ✅ 全部符合 |

被删除的 45 个文件均为上游自身重构：`src/qwenpaw/harnesses/**` 迁移到 `plugins/harness/{codex,qoder}`；`HarnessApprovalToggle`/`HarnessModelSelector` → `BackendApprovalToggle`/`BackendModelSelector`；`matrix_legacy.py`、`tests/fixtures/memory_tags_contract.json` 等下线。

## 3. 12 个冲突文件逐项分析

### 3.1 `src/qwenpaw/app/_app.py`

| 维度 | fork | 上游 |
|------|------|------|
| 导入 | 新增 `import shutil`（供 `_sync_bundled_plugins` 用） | 删除 `run_sync_io` 导入 |
| 启动即同步历史 | 保留 `_sync_scroll_history_on_startup` | **删除**：`sync_all_scroll_agents` 已不存在，改为 `preflight_sessions`/`sync_sessions_to_history` 由 `multi_agent_manager`、`workspace/service_factories` 调用 |
| 内置插件同步 | 新增 `_BUNDLED_PLUGIN_IDS`/`_bundled_plugins_root`/`_sync_bundled_plugins` | 无 |
| 插件注册表 | 无 | 新增 `app.state.plugin_registry` |
| 社区连接 | 无 | 新增 `CommunityConnectionService` + `poll_loop` |

**解决**：保留 `shutil` 导入与内置插件同步代码；删除已失效的 `_sync_scroll_history_on_startup`（其依赖的函数上游已移除，留着只会每次启动打一条 ImportError 日志）；采纳上游的 `plugin_registry` 与社区服务。

### 3.2 `pyproject.toml`

| 项 | fork | 上游 | 采用 |
|----|------|------|------|
| `transformers>=4.30.0` | 删除（打包瘦身 `ed4cc202c`） | 保留 | **fork**（`src/` 内 `transformers` 零引用，安全） |
| `test` extra | 删 `qoder-agent-sdk` | 删 `qoder-agent-sdk` + 加 `pyinstaller` | 上游结果（自动合并） |
| `codex` / `qoder` extras | 删除 | 保留（注释：过渡期，配合 Harness 插件单独安装） | **上游**（`plugins/harness/*/README.md` 明确引用 `qwenpaw[codex]`/`qwenpaw[qoder]`，删掉会出现无效 extra） |
| `full` extra | `[qwenpaw-data,hub,local,whisper]`（不含 `channels`/`codex`/`qoder`） | 含 `[channels]` | **fork**（`scripts/pack-tauri/build_pyinstaller.sh` 明确只用 slim extras，channels 由离线 staging 单独解析） |
| `matrix-e2ee` extra | 保留 | 删除（E2EE 依赖并入 `channels`：`vodozemac`/`atomicwrites`/`cachetools`/`peewee`，`matrix-nio` 升 0.26） | **上游**（全仓库无 `matrix-e2ee` 引用） |
| 依赖/包数据 | — | 新增 `markdown-it-py>=3.0.0,<5`、`local_models/runtime-release.json` | 上游（自动合并） |

### 3.3 `Makefile`

fork 新增 `venv` / `build-console` / `dev` 三个开发目标（+50 行）；上游未改动（qwenmain 侧为空 → 被判定为「删除」）。

**解决**：完整保留 fork 版本。

### 3.4 `scripts/pack/build_common.py`

两边在**同一位置各加了一个校验步骤**，属互补冲突：

| 侧 | 新增内容 |
|----|----------|
| fork | `conda run --no-capture-output`（3 处）、`certifi` 可用性校验、slim extras + `--progress-bar on` |
| 上游 | 断言默认桌面环境**不得**含 `openai_codex` / `codex_cli_bin` / `qoder_agent_sdk` |

**解决**：两段校验都保留（certifi 校验 + Harness SDK 缺席断言），`--no-capture-output` 保留。

### 3.5 `scripts/pack-tauri/qwenpaw.spec`

| 维度 | fork | 上游 | 采用 |
|------|------|------|------|
| qoder/codex CLI 二进制（~400MB） | 删除 `qoder_binaries`/`codex_binaries`，`binaries=[]` | 同样删除 | 一致（保留 fork 的说明注释） |
| 独立 worker 源码 datas | 只加 `modes/coding/_worker.py` | 循环 4 个：`_worker.py`、`agents/context/scroll/memoryspace.py`、`backup/_ops/sqlite_snapshot.py`、`utils/sqlite_uri.py` | **上游**（超集；4 个模块均已存在） |
| `collect_runtime_metadata` extras | `qwenpaw[qwenpaw-data,hub,local]` | `qwenpaw[full]` | **fork**（与实际安装一致） |
| datas/metadata | — | `visual_compression/assets`、`local_models/runtime-release.json`、`copy_metadata(..., recursive=True)` | 上游（自动合并） |
| excludes | `torch`/`torchvision`/`torchaudio`/`transformers`/codex/qoder | `qwenpaw.harnesses` + codex/qoder | **并集** |
| hiddenimports | 终端 PTY 后端（`terminal_windows`/`terminal_posix`/`winpty`） | — | fork（自动合并保留） |

### 3.6 `console/src-tauri/tauri.conf.json`

fork：品牌 `CliPaw`、`identifier` `io.agentscope.clipaw.desktop`、`bundle.macOS`（`infoPlist`/`entitlements`/`minimumSystemVersion`）上移、`nsis.compression` 改 `lzma`。
上游：窗口新增 `"create": false`（自动合并已带入）。

**解决**：fork 全部保留 + 上游 `"create": false`；同时修复 §1 中被静默改回的 3 处品牌字段。

### 3.7 `console/src-tauri/src/tray.rs`

fork **未改动**（等于基线）；上游改动为真实功能：新增「View pending approvals」托盘项与 `qwenpaw:open-approvals` 事件、删除 `CloseAction::Quit`（以 `#[serde(alias = "quit")]` 兼容旧配置）、macOS `app.show()`、关闭逻辑修复、新增单测。

**解决**：取上游完整版本（ours == 基线，无 fork 损失）。

### 3.8 `console/src-tauri/Cargo.lock`

两边都把 Tauri 包重命名为 `clipaw-desktop`（fork 改名；qwenmain 也带着旧 fork 的改名，但 **lock 未重新生成**，仍是 `qwenpaw-desktop`）。上游同时为宿主包新增依赖：`rfd`、`notify-rust`、`mac-usernotifications`、`windows-core 0.61.2`、`winreg`、`windows 0.61.3`。

**解决**：单一 `[[package]] name = "clipaw-desktop"` 条目，依赖列表取上游版本（含新增依赖，且 `windows`/`windows-core` 用带版本限定形式，因为 lock 内已有 0.61.3 与 0.62.2 两个版本）。校验：TOML 可解析、602 个包、所有依赖引用可解析。

### 3.9 `.github/workflows/desktop-release.yml`

fork 把该 workflow 从 1010 行重写为 209 行（`CliPaw Desktop Build`，只保留 Windows/macOS 两个打包 job，直接 `softprops/action-gh-release` 上传；明确移除 release secrets 校验、功能验证、OSS 上传/索引、updater 签名）。

上游新增：`plugin-versions` 闸门 job（`plugin-release-guard.yml`）、各 job `needs` 依赖、macOS 超时 60→90、prerelease 跳过 updater manifest。

**解决**：采用 fork 版本。原因：上游新增内容全部指向 fork 已删除的 job（`check-release-secrets`/`upload-release`/`upload-oss`），且 `plugin-versions` 闸门会引入 fork 自定义插件（background-theme/voice）与上游发布基线不一致时的阻塞风险；macOS 超时项在 fork 版本中不存在该配置（GitHub 默认 360 分钟），无需移植。

### 3.10 `console/src/layouts/index.module.less`

fork 仅改动样式（`padding-bottom: 20px`、隐藏部分元素、logo 高度 60px 等）；上游未改 → **取 fork**。

### 3.11 `console/src/pages/Settings/VoiceTranscription/{index.tsx,components/index.ts}`

两者 ours == 基线（fork 相对基线**没有**改动这两个文件）。上游 11 月新增功能 `3e0df9010 feat(transcription): make the Whisper API model name configurable (#8052)`，新增 `TranscriptionModelCard` 组件、导出与渲染。

**解决**：取上游（新增 `TranscriptionModelCard` 导出 + 导入 + 渲染）。这与 fork 的语音插件化**不冲突**：fork 的设计是「插件实时语音优先，关闭时回退官方内置语音」，官方 Whisper 设置页继续保留；`ShortcutSettings`/`VolcengineConfigCard`（旧 fork 内置语音残留，已被 `859014b42 fix 语音输入插件化` 删除）**不复活**。

## 4. 20 个「双方都改」文件的核对结果

| 文件 | 合并结果 | 结论 |
|------|----------|------|
| `.github/workflows/desktop-build.yml` | fork NSIS `arch: amd64` + 上游 `timeout-minutes: 90` | ✅ |
| `.github/workflows/desktop-release.yml` | fork 精简版 | ✅ 见 §3.9 |
| `console/package.json` | fork + 上游 `dompurify` | ✅ lock 内已有该包 |
| `console/src-tauri/Cargo.toml` | fork 改名/描述 + 上游新增 windows/macOS 依赖与 `rust-version 1.90` | ✅ |
| `console/src-tauri/Cargo.lock` | 见 §3.8 | ✅ |
| `console/src-tauri/tauri.conf.json` | 见 §3.6 | ✅ |
| `console/src/api/modules/agent.ts` | fork `setActiveAgent`/`PUT /agents/active` + 上游 `get/updateTranscriptionModel` | ✅ |
| `console/src/api/modules/plugin.ts` | fork background-theme 开关 API + 上游 `installation_origin`/`market_id`/`setPluginEnabled`/`force=true` | ✅ |
| `console/src/App.tsx` | 上游 `useUiLocale`/`AuthStatusProvider`/`useDesktopTrayLabels` 重构 + fork `loadClientConfig()` 启动调用 | ✅ |
| `console/src/layouts/registry/builtinMenu.ts` | 上游 Community 菜单项 | ✅ |
| `console/src/locales/{en,zh}.json` | 无 fork 键丢失、无已删键复活；6 处文案差异均为上游更新 | ✅ |
| `console/src/pages/Chat/ChatPage.coverage.test.tsx` | 上游 mock 重命名（`BackendApprovalToggle`/`decisionModelConfigured`） | ✅ |
| `console/src/pages/Chat/index.tsx` | fork `pluginVoiceOn` 门控 6 处全存活 + 上游新增 | ✅ |
| `console/src/pages/Chat/sdkHostIntegration.test.tsx` | fork `qwenpaw_voice_enabled="0"` 用例设置保留 | ✅ |
| `pyproject.toml` | 见 §3.2 | ✅ |
| `scripts/pack-tauri/qwenpaw.spec` | 见 §3.5 | ✅ |
| `scripts/pack/build_common.py` | 见 §3.4 | ✅ |
| `src/qwenpaw/app/_app.py` | 见 §3.1 | ✅ |
| `src/qwenpaw/app/routers/agents.py` | fork `PUT /agents/active`（Agent 选择持久化）存活 + 上游重构 | ✅ |

> 说明：`src/qwenpaw/runtime/message_convert.py`、`src/qwenpaw/app/routers/workspace.py`、`src/qwenpaw/config/config.py` 等虽在 qwenmain 的残留清单中，但上游在本区间**未改动**，属「仅 fork 改动」，审计为逐字节一致。

## 5. 验证

| 项 | 结果 |
|----|------|
| 冲突标记残留 | 0（全仓库 `git grep '^<<<<<<< '`） |
| Fork 专属文件（74） | 74/74 与 `ddfd724f6` 逐字节一致 |
| 上游文件丢失 | 0 |
| 残留复活（紫色主题 / 旧品牌图 / 旧语音组件） | 0（`console/src/themes/**`、`themeStore.ts`、`docs/customs/purple-theme.md`、`clipaw1..5.jpeg`、`cliPow.svg`、`ShortcutSettings.tsx`、`VolcengineConfigCard.tsx` 均不存在） |
| Python 语法（`compileall src/qwenpaw`） | ✅ 通过 |
| Python 内部导入解析（194 个变更文件） | ✅ 0 个悬空模块引用 |
| TS 相对导入解析（332 个变更文件） | ✅ 0 个真实悬空（6 处为 `.d.ts`/mock 既有写法） |
| `tests/unit/app` + `tests/unit/runtime` | 3380 passed / 18 skipped / 3 failed（均为环境问题：`official_channels/index.json` 被 gitignore 未生成 ×2；PATH 无 `python` ×1） |
| `tests/unit/plugins` | 1002 passed；失败用例经与合并前 `ddfd724f6` 对照，为**既有环境问题**（子进程使用 venv 中旧版 `agentscope 2.0.7`，分支要求 2.0.10）及上游新增用例依赖 `official_channels/index.json` |
| fork 插件导入兼容 | ✅ `qwenpaw.plugins.api.PluginApi.register_http_router`、`qwenpaw.envs.load_envs`、`qwenpaw.constant.WORKING_DIR` 均存在；插件清单 `qwenpaw_version.min` 2.0.x ≤ 宿主 2.3.1b1；无 `sdk` 声明时 `validate_sdk(None)` 直接放行 |
| `pyproject.toml` / `Cargo.lock` / workflow YAML | ✅ 可解析（其中 `cargo metadata --offline` 因本机 crates.io 缓存过旧无法完成，改做依赖引用一致性校验：0 问题） |

## 6. 下次同步上游的检查清单

1. **先确认基线唯一性**：`git merge-base --all qwenmain clipaw2.x`。若出现多个基线，按本文 §1 处理——不要相信「无冲突即正确」。
2. 合并后跑 §2 的四个集合审计（F\U 逐字节一致、上游零丢失、零残留复活、删除项全部属于上游重构）。
3. 重点回归三项易丢定制：
   - `_app.py` 的 `_sync_bundled_plugins(get_plugins_dir())` 调用
   - `tauri.conf.json` 的 `CliPaw` 品牌与 `io.agentscope.clipaw.desktop`
   - `Chat/index.tsx` 的 `pluginVoiceOn` 门控（6 处）
4. `plugins/apps/{background-theme,qwenpaw-voice}` 依赖的 `PluginApi` 接口是否仍兼容。
5. 若上游再次改动语音设置页，注意 `TranscriptionModelCard` 属上游功能（保留），`ShortcutSettings`/`VolcengineConfigCard` 属旧 fork 残留（保持删除）。

## 7. 检索关键词

`合并 qwenmain`, `clipaw2.x`, `criss-cross`, `merge-base`, `虚拟基线`, `silent revert`, `静默丢失`, `_sync_bundled_plugins`, `CliPaw`, `clipaw.desktop`, `tauri.conf.json`, `pluginVoiceOn`, `TranscriptionModelCard`, `ShortcutSettings`, `VolcengineConfigCard`, `codex`, `qoder`, `full extra`, `matrix-e2ee`, `Cargo.lock`, `clipaw-desktop`, `desktop-release.yml`, `plugin-versions`, `build_common.py`, `qwenpaw.spec`, `harnesses → plugins/harness`