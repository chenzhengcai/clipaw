# clipaw2.2.2 vs 上游 main 代码差异梳理

> 对比基准：`git diff main..clipaw2.2.2`
> 结论先行：`merge-base(main, clipaw2.2.2)` = main HEAD（77744172），即 **clipaw2.2.2 已完整包含 main 的全部历史**，差异全部是 clipaw 在 main 之上"加"的，没有"落后"。
>
> 净差异规模：**93 个文件，+10232 / -1045**。
> 其中 **plugins/ 下 25 个文件**（background-theme + qwenpaw-voice 两个插件，含它们的 package-lock）属于你已知的"插件不一样"，本文不重复展开。
>
> 下面梳理 **非 plugins 的 68 个文件改动**，并按"上游更新时冲突风险"分级。

---

## 一、纯新增文件（零冲突风险）

这些文件上游 main 不存在，合并时 git 不会触碰上游版本，**几乎不可能冲突**。

### 1. docs/customs/ —— clipaw 专属文档（12 个文件，+2299 行）
全部是新增 markdown，记录 clipaw 的迁移/修复决策：
- `README.md`、`clipaw2x-migration-audit.md`、`tauri-desktop-build.md`
- `agent-persistence.md`、`voice-transcription.md`、`voice-input-not-stopped-on-send.md`、`voice-streaming-replace-regression.md`
- `fix-window-close-stuck-and-backend-orphan.md`、`fix-window-close-stuck-on-quit.md`
- `file-attachment-not-visible-to-model.md`、`token-usage-chart-smooth.md`、`merge-main-into-clipaw2.0.0-conflict-resolution.md`

> 风险：无。**建议保留**，是后续合并排障的重要资产。

### 2. console/src-tauri/Info.plist、entitlements.plist（新增，麦克风权限）
macOS 麦克风权限声明，配合 qwenpaw-voice 插件。`tauri.conf.json` 已引用它们。

### 3. console/src-tauri/src/backend.rs 的新增函数 + tray.rs 的新增逻辑
详见第四节，属于"在已有文件里新增"，但插入点较独立。

### 4. console/src/api/clientConfig.ts（新增 77 行）
fork 专属文件，文件头明确标注"非上游文件"。前端 Agent 选择持久化（解决 Tauri 端口漂移导致 localStorage 丢失）。`App.tsx`、`agentStore.ts` 动态 import 它。

### 5. scripts/pack/assets/ 新增图标（256x256.ico、icon.png 等）
品牌图标，二进制，不影响逻辑。

---

## 二、低冲突风险：可配置/品牌类（上游若改同字段才会冲突）

| 文件 | 改动性质 | 风险点 |
|---|---|---|
| `console/src-tauri/Cargo.toml` | name 改 `clipaw-desktop`、description/authors 改 CliPaw | 上游若改包名/作者会冲突 |
| `console/src-tauri/tauri.conf.json` | productName→CliPaw、identifier→`io.agentscope.clipaw.desktop`、title 改名、macOS 配置从顶层挪到 `bundle.macOS`、NSIS compression zlib→lzma | **中风险**：上游每次升级 Tauri/调整 bundle 配置都会动这个文件 |
| `console/public/*.svg/*.png` | logo/online 图标替换为 clipaw 品牌（SVG 内嵌 base64 大图） | 低，上游若换图标才冲突 |
| `console/src-tauri/icons/*` | 应用图标替换 | 低 |
| `scripts/pack/assets/icon.*` | 打包图标替换（icns/ico/png/svg） | 低 |
| `console/package.json` | 加 `"ci": "^2.3.0"` 依赖（疑似误加，见下方建议）、加 `packageManager` 字段 | 低 |

---

## 三、中冲突风险：前端代码改动（上游高频变动区）

前端是上游迭代最快的区域，下列改动直接落在上游会反复修改的文件里，**合并 main 时最需要手动解冲突**。

### 1. `console/src/pages/Chat/index.tsx`（+53/-9 行，**最高频冲突点**）
语音输入插件化相关，逻辑虽已尽量收敛，但仍插在 ChatPage 主体的多个热点位置：
- 新增 `pluginVoiceOn` state + storage/自定义事件监听
- 修改 `Ctrl+Shift+M` 快捷键：插件开启时让位
- 修改 `allowSpeech` 公式：`pluginVoiceOn || (whisperChecked && !whisperEnabled)`
- 修改 `sender.prefix` 渲染顺序：`pluginSenderPrefix` 提前、`whisperEnabled && !pluginVoiceOn` 才渲染内置 WhisperSpeechButton
- 加注释说明插件接管录音停止

> **建议**：这是 fork 与上游冲突的"一号文件"。每次合并 main 必看。语音逻辑已经抽到插件里（`pluginSenderPrefix` 由插件注入），冲突面已比早期版本小，但 prefix/allowSpeech 这两处仍贴着上游核心渲染分支。

### 2. `console/src/locales/en.json` / `zh.json`（各 +43 行）
新增火山引擎 ASR 配置、快捷键、连通性测试等一大段 i18n key（在 `voiceTranscription` 和 `chat.speech` 节点内追加）。同时改了 `startRecording/stopRecording` 文案去掉快捷键后缀、新增 `notConnected`。

> 风险：中。上游若也改这两段 key 会冲突；追加的 key 一般不冲突，但插在已有 key 中间时仍可能错位。

### 3. `console/src/App.tsx`（+12 行）
启动时 `import("./api/clientConfig").loadClientConfig()` 恢复 Agent 选择。插在 `useUploadLimitStore.fetch()` 的 useEffect 后面。

### 4. `console/src/stores/agentStore.ts`（+7 行）
`setSelectedAgent` 内追加后端持久化（clientConfig + `/agents/active`）。

### 5. `console/src/api/modules/agent.ts`（+9 行）
新增 `setActiveAgent` 调用 + 注释。

### 6. `console/src/api/modules/plugin.ts`（+29 行）
新增 `fetchBackgroundThemeEnabled` / `toggleBackgroundThemeEnabled`（background-theme 插件开关 API）。

### 7. `console/src/os/MenuBar.tsx`（+10 行）
"返回控制台"跳转加 `withCacheBuster(withDesktopMarker(...))`。**注意**：`backendRuntime.ts` 本身在 main 已存在且与 clipaw 完全相同（blob 一致），这里只是"用法"差异。

### 8. `console/src/layouts/registry/builtinMenu.ts`（±4 行）
`core.checkpoints` 菜单 parentId 从 `core.agent-group`→`core.workspace-group`、order 80→75。

### 9. `console/src/layouts/index.module.less`（+6 行）
logo 高度 18px→60px、隐藏 `.appBrandAction`/`.headerDivider`、加 padding-bottom。

### 10. `console/src/styles/layout.css`（+5 行）
品牌布局微调。

### 11. `console/src/pages/Settings/TokenUsage/hooks/lineChartChrome.ts`（+1/-1 行）
Token 曲线加 `shape: "smooth"`（圆滑）。极小改动。

### 12. `console/src/tauri/BackendLoadingPage.tsx`（+1/-1 行）
极小改动。

### 13. 测试文件（2 个，各 +6~24 行，fork 语音插件相关）
- `console/src/pages/Chat/ChatPage.coverage.test.tsx`
- `console/src/pages/Chat/sdkHostIntegration.test.tsx`

两文件都给 whisper 用例加 `localStorage.setItem("qwenpaw_voice_enabled", "0")` 并新增"插件开启时隐藏内置 whisper 按钮"用例。

> 风险：中。上游每次改 ChatPage 测试都会牵连。

---

## 四、中高风险：Tauri/Rust 桌面端进程清理（上游较少动，但改动深）

> **2026 上游复查（main 77744172）**：官方**仍未修复**这两个问题——
> ① `exit_app` 仍是"Tauri async 任务跑 60s `stop_and_wait` 后才 `app.exit(0)`"，窗口在清理期间持续可见（Windows 卡死根因仍在）；
> ② `ExitRequested` 仍是无条件 `block_on(stop_and_wait)`（IPC 冻结/双重调用根因仍在）；
> ③ 无 `RunEvent::Exit` 处理、无进程树清理（macOS 孤儿进程仍在）。
> 结论：**clipaw 改造仍然必要**。
>
> **已完成冲突面收敛改造**：全部 fork 逻辑（约 430 行）抽到新文件
> `console/src-tauri/src/shutdown.rs`（fork 专属，零冲突）：
> - `tray.rs`：`exit_app` 改为 1 行委托 `shutdown::begin_exit`，`TrayState` 回归上游原样（diff 从 +267/-8 → ~24 行）
> - `backend.rs`：删除 `force_kill_sidecar`/`kill_process_tree_macos`，仅保留 3 处小改（`force_kill`/`finish_stop` 加 `pub(crate)` + 新增 `sidecar_pid()` 辅助方法，diff 从 +109 → ~11 行）
> - `lib.rs`：`mod shutdown;` + `.manage(ShutdownState::default())` + 三处 `shutdown::` 调用点（不可再减，属设计固有接线）
> - 验证：`cargo check` 通过、无警告

这是 clipaw 为"macOS 退出后残留 qwenpaw-backend/Chrome 孤儿进程"和"Windows 退出卡死 5-6 分钟"做的专项修复，**逻辑深、跨 lib.rs/tray.rs/backend.rs**：

### 1. `console/src-tauri/src/tray.rs`（+267 行，最大块）
- `exit_app` 改为：原子 `shutdown_initiated` 守卫 + 派生 **OS 线程**（非 Tauri async task）跑 `stop_and_wait`，窗口立即隐藏，线程完成后自己 `app.exit(0)`
- 新增 `shutdown_initiated` / `join_shutdown_thread` 状态
- 新增 `EXIT_CLEANUP_TIMEOUT`、`SHUTDOWN_DETACH_TIMEOUT` 常量
- 新增 `exit_cleanup_blocking`（同步 `RunEvent::Exit` 兜底）

### 2. `console/src-tauri/src/lib.rs`（+57 行）
- macOS `ExitRequested{code:None}`（Cmd+Q）改为 `api.prevent_exit()` + `tray::exit_app`（原来走 close prompt）
- 新增 `RunEvent::Exit` 分支调 `tray::exit_cleanup_blocking`
- `shutdown_initiated` 时 join 线程而非重复 `stop_and_wait`

### 4. `console/src-tauri/src/backend.rs`（改造后仅 ~11 行 diff）
- ~~新增 `force_kill_sidecar` + `kill_process_tree_macos`~~（已迁至 `shutdown.rs`）
- 保留：`force_kill`/`finish_stop` 加 `pub(crate)` 前缀 + 新增 `sidecar_pid()` 方法（供 shutdown.rs 读取 PID，避免暴露私有字段）

### 4. `console/src-tauri/Cargo.lock`（+82 行）
随上述新增逻辑/依赖变化的锁文件。

> 风险评估：**中高**。上游 Tauri 端改动频率低于前端，但 `lib.rs` 的 `RunEvent` 匹配臂、`tray.rs` 的 `exit_app` 是退出流程核心，一旦上游重构退出逻辑（Tauri v2 升级时常见），这三处需整体重新适配，不能简单三向合并。**建议把这块抽成 fork 专属模块**（如 `shutdown.rs`），减少与上游 `tray.rs`/`lib.rs` 的行级重叠。

---

## 五、后端 Python 改动（src/qwenpaw/，中风险）

### 1. `src/qwenpaw/app/_app.py`（+99 行，新增）
- 新增 `_BUNDLED_PLUGIN_IDS`、`_bundled_plugins_root`、`_read_plugin_version`、`_sync_bundled_plugins`：启动时把 `plugins/apps/` 下的 background-theme、qwenpaw-voice 复制到运行时 plugins 目录并自动加载
- 在 `lifespan` 里调用 `_sync_bundled_plugins(get_plugins_dir())`

> 风险：中。`lifespan` 函数是上游启动主流程，插入点需随上游演化调整。

### 2. `src/qwenpaw/app/routers/agents.py`（+22 行，新增）
新增 `PUT /agents/active` 端点 `set_active_agent`，持久化当前 Agent 到 config。

> 风险：低-中。新增路由附加在文件尾部，上游若同处加路由才冲突。

### 3. `src/qwenpaw/runtime/message_convert.py`（+80 行，含修改）

> **2026 上游复查（main 77744172）**：
> ① 官方 `_request_input_to_msgs` 的 file 分支**仍硬编码** `DataBlock(media_type="application/octet-stream")`——bug 仍在；
> ② 但官方在**别处**有两步演进：agentscope formatter 已原生支持 `application/pdf`（`_format_file_source` base64 inline），且 `_fixup_media_list` 的 `btype == "file"` 分支会把 file block 转成与 clipaw **完全同格式**的 TextBlock（`File 'x' is available at: path`）——即官方的兜底方向与 clipaw 收敛一致，只是没接到 console 上传链路上；
> ③ 官方 `_fixup_media_list` 的 data 分支只处理"文件已删除"和 file:// URL 规范化，**不处理 media_type 不支持**的情况，console 的 http preview URL 会被 formatter 静默丢弃。
> 结论：**clipaw 修复仍然必要**，且方向与官方一致。
>
> **已完成冲突面收敛改造**：
> - file 分支内联代码（27 行）抽为独立 helper `_file_content_to_text_block()`，分支内只剩 1 行调用 + 注释（合并冲突时秒解）
> - 修复了被合并冲掉的上游测试断言：`test_file_input_preserves_independent_original_content` 的 `type == "data"` 改为 `"text"`（带 fork 注释说明）
> - 恢复了丢失的 4 个 file_attachment 测试（此前某次 merge main 时被覆盖丢失）
> - 验证：`pytest tests/unit/runtime/test_message_convert.py` 9/9 通过
>
> **遗留决策点（未做，待上游演化）**：PDF 附件目前也走 TextBlock 路径（模型需用 file_io 工具读本地文件）。若想用上官方 formatter 的原生 PDF 支持（base64 inline 直读），可在 helper 里按扩展名猜 media_type、PDF 走 `DataBlock(application/pdf)`——但需权衡大 PDF 的 payload 膨胀与非 OpenAI formatter 的覆盖面，等上游把 console 链路接通后再跟进更稳。

具体改动（改造后结构）：
- 纯新增：`_file_url_to_local_path()`（URL→本地路径，三种格式）、`_file_content_to_text_block()`（FileContent→TextBlock，含 fork 说明）
- `_request_input_to_msgs` 的 file 分支：仅 1 行调用 helper + 1 行 fork 注释（原为 27 行内联改写）
- 风险：**降为中**。函数新增部分不与上游行重叠；分支内冲突面缩至 2 行。

---

## 六、打包脚本改动（scripts/，低-中风险）

### 1. `scripts/pack-tauri/qwenpaw.spec`（+63 行，大量删除）
- 删掉 qoder/codex 的 binary 收集逻辑（~400MB CLI 不打进包）
- `binaries=[]`，`excludes` 新增 `torch/torchvision/torchaudio/transformers/codex_cli_bin/qoder_agent_sdk/openai_codex`
- 删掉 `_metadata_pkgs` 里的 codex/qoder 项

### 2. `scripts/pack-tauri/build_macos_pyinstaller.sh`（+32 行）
品牌名 QwenPaw→CliPaw、app 路径改用 `tauri.conf.json` 的 productName 动态读取、删掉 Tauri updater 签名 staging 段。

### 3. `scripts/pack-tauri/build_pyinstaller.{sh,ps1}`（各 +4 行）
品牌/路径小改。

### 4. `scripts/pack-tauri/stage_node_runtime.py`（+9 行）
新增 `_prune_runtime`：删除 node runtime 的 `include/`（C 头文件，省 ~64MB）。

### 5. `scripts/pack/build_common.py`（+14 行）
conda run 加 `--no-capture-output`。

### 6. `scripts/pack/build_macos.sh`（+9 行）
品牌/路径小改。

> 风险：低-中。spec 文件改动较集中，上游若重构 PyInstaller 打包会冲突；其余多为品牌字符串替换，冲突可快速解决。

---

## 七、CI/构建配置改动

### 1. `.github/workflows/desktop-release.yml`（+78/-840，**重写**）
从完整 release 流水线（legacy 打包 + Tauri 打包 + 校验 + OSS 上传 + updater 签名）**精简为只有 Tauri Windows + macOS 两个 job，直接上传 GitHub Release**。文件头注释说明了删除了哪些 job。

> 风险：**高（但可控）**。上游每次发布都会改这个 workflow，合并时几乎必然冲突。**建议**：clipaw 不依赖上游这个文件的演化，合并时直接用 clipaw 版本（冲突时 `ours`），但要定期对照上游新 job，手动拣选需要的能力。

### 2. `.github/workflows/desktop-build.yml` / `fork-verify-desktop.yml`（各 +4 行）
NSIS 安装步骤加 `arch: amd64`。

> 风险：低。小改，但 step 名也改了，上游若改同一 step 会冲突。

### 3. `Makefile`（+50 行）
顶部新增 `venv` / `build-console` / `dev` 三个开发 target。插在原有 `.PHONY` 声明前。

### 4. `pyproject.toml`（+10 行，含删除）
- 删 `transformers>=4.30.0` 依赖
- 删 test extras 里的 `qoder-agent-sdk`
- 删 `codex`、`qoder` 两个 extras
- `full` extras 去掉 codex/qoder

> 风险：中。`pyproject.toml` 是上游常改文件，删 codex/qoder/transformers 这类改动需在每次合并时重新确认上游是否新增了与这些相关的依赖。

---

## 八、汇总表：按"合并 main 时冲突概率"排序

| 风险 | 文件/区域 | 合并策略建议 |
|---|---|---|
| 🔴 高 | `.github/workflows/desktop-release.yml` | 基本用 clipaw 版（ours），定期对照上游 |
| 🟢 已降 | `console/src-tauri/src/shutdown.rs`（新文件，承载原 tray/lib/backend 改造） | **零冲突**。上游若最终修复退出问题，删除本模块、恢复三文件上游版即可 |
| 🟢 已降 | `console/src-tauri/src/tray.rs`（~24 行 diff） | exit_app 1 行委托 + 注释，冲突秒解 |
| 🟢 已降 | `console/src-tauri/src/backend.rs`（~11 行 diff） | 3 处 `pub(crate)`/`sidecar_pid`，冲突秒解 |
| 🟡 中 | `console/src-tauri/src/lib.rs`（~60 行 diff） | ExitRequested/Exit 接线属设计固有，不可再减；每次合并手动复查 |
| 🟡 已降 | `src/qwenpaw/runtime/message_convert.py`（helper 抽出后） | 分支内 2 行；上游若修复"附件不可见"（不再硬编码 octet-stream）可整体回归上游 |
| 🟡 中 | `src/qwenpaw/app/_app.py` bundled plugin sync | 关注 lifespan 函数演化 |
| 🟡 中 | `console/src/locales/{en,zh}.json` i18n 追加 | 追加 key 尽量放节点末尾 |
| 🟡 中 | `console/src-tauri/tauri.conf.json` | bundle 配置变更点集中，三向合并需细看 |
| 🟡 中 | `pyproject.toml` 删 codex/qoder/transformers | 每次合并重确认依赖 |
| 🟢 低 | `console/src/api/clientConfig.ts`（新文件） | 零冲突，保持 fork 专属 |
| 🟢 低 | `docs/customs/*`（12 新文档） | 零冲突，保留 |
| 🟢 低 | 品牌/图标/Info.plist/entitlements | 上游换图标才冲突 |

---

## 九、降低后续冲突的几点建议

1. **`desktop-release.yml` 单独维护**：clipaw 版与上游版目标差异巨大，合并时直接保留 clipaw 版，别尝试三向合并。
2. **Tauri 进程清理逻辑抽模块**（✅ 已完成）：`force_kill_sidecar` / `kill_process_tree_macos` / `begin_exit` / `join_shutdown_thread` / `exit_cleanup_blocking` 已集中到 `console/src-tauri/src/shutdown.rs`；`tray.rs`/`backend.rs` 基本回归上游，`lib.rs` 只留接线。上游若最终修复退出问题，删除本模块即可整体回归。
3. **message_convert 的 file 分支**（✅ 已收敛）：内联代码抽为 `_file_content_to_text_block()` helper；上游测试断言已改 `"text"`（带注释）；4 个丢失测试已恢复。升级时第一时间核对上游 file 分支是否还硬编码 octet-stream，若官方接入 formatter 原生 PDF/文件支持，可整体回归上游实现。
4. **i18n 追加策略**：新加的 key 一律追加到所在 JSON 对象末尾，不要插在已有 key 中间，降低错位冲突。
5. **`console/package.json` 的 `"ci"` 依赖**：疑似误把 npm 包 `ci`（一个 CLI 工具）加进 dependencies，与构建无直接关系，建议移除以减少与上游 package.json 的 diff。
6. **保留 docs/customs 冲突解决记录**：`merge-main-into-clipaw2.0.0-conflict-resolution.md` 这类文档对下次合并极有价值，务必保留并持续更新。
7. **插件代码独立**：background-theme 与 qwenpaw-voice 已在 `plugins/apps/` 下自成体系，且 backend/前端入口通过 fork 专属文件（clientConfig.ts、plugin.ts 的新增函数）接入，冲突面已最小化，继续保持。

---

## 附：差异总览数字

- **非 plugins 改动文件数**：68 / 93
- **非 plugins 新增行**：约 7900 / 10232（plugins + 其测试占约 2300）
- **纯新增文件（零冲突）**：docs/customs 12 + clientConfig.ts + Info.plist + entitlements.plist + 4 个 backend.rs 函数 ≈ 16 项
- **改动既有文件（有冲突面）**：约 52 项，其中高/中高风险约 8 项
