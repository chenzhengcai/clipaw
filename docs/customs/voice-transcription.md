# 语音输入功能设计说明（插件化架构）

## 概述

语音输入功能允许用户在聊天对话中通过语音输入文字，基于**火山引擎大模型流式 ASR**（WebSocket 实时识别），支持：

| 能力 | 说明 |
|------|------|
| 实时流式识别 | 边说边出文字，partial 帧累积替换 |
| 一键总开关 | 关闭插件实时语音后自动回退**官方内置语音**（Whisper 按钮 / SDK `allowSpeech`） |
| 可配置快捷键 | `toggle`（按一下开/关）/ `hold`（按住说话） |
| 凭证连通性测试 | 未通过测试时麦克风按钮禁用 |
| 跨重启配置持久化 | 解决 Tauri 端口变化导致 localStorage 丢失 |

> **★ 本功能已完整插件化**，代码位于 `plugins/apps/qwenpaw-voice/`。
> 上游文件（`audio_transcription.py` / `workspace.py` / `config.py` 等）**不再
> 包含语音实现**；`Chat/index.tsx` 保留上游原生语音代码，仅新增插件开关门控
> （纯增量 +44/-5）。合并 `upstream/main` 时语音部分近零冲突。详见「冲突面」章节。

## 为什么改插件

原实现深度嵌入上游文件，是 merge 上游时的主要冲突源：

| 文件 | 原 fork 改动量 | 现在 |
|------|--------------|------|
| `src/qwenpaw/agents/utils/audio_transcription.py` | +593 行（火山流式/帧协议） | **0**（已还原） |
| `src/qwenpaw/app/routers/workspace.py` | +164 行（WS/REST/client-config） | **0**（已还原） |
| `src/qwenpaw/config/config.py` | +4 行（provider 枚举） | **0**（已还原） |
| `console/src/pages/Chat/index.tsx` | +659 行 | 恢复上游语音块，仅新增开关门控（**+44/-5 纯增量**） |
| `console/src/pages/Chat/voice/*` | 3 个新文件 | **删除**（移入插件） |
| `console/src/pages/Settings/VoiceTranscription/*` | 大幅改写 | **0**（已还原） |

## 插件结构

```
plugins/apps/qwenpaw-voice/
├── plugin.json                  # manifest（backend + frontend entry）
├── plugin.py                    # 后端入口：plugin = QwenpawVoicePlugin()
├── backend/
│   ├── __init__.py
│   ├── router.py                # APIRouter: /status, /voice-test-connection,
│   │                            #   /client-config(GET/PUT), WS /transcribe/ws
│   ├── volcengine_asr.py        # 火山二进制帧协议 + 流式会话 + 连通性测试
│   └── client_config.py         # ~/.clipaw/client-config.json 读写
└── frontend/
    ├── vite.config.ts           # ESM + classic JSX + external react
    ├── package.json
    ├── tsconfig.json
    ├── dist/index.js            # 构建产物（自包含，无裸 import）
    └── src/
        ├── index.tsx            # 入口：注册 route/menu/senderPrefix + 快捷键 + 提交拦截 + 总开关
        ├── host.ts              # window.QwenPaw host 桥接（React/antd/fetch）
        ├── i18n.ts              # 自带中英文案（不写上游 locales）
        ├── config.ts            # 配置键 + 总开关 + 快捷键定义 + 凭证读写
        ├── clientConfig.ts      # 插件侧客户端配置持久化
        ├── SpeechButton.tsx     # 麦克风按钮（WS 流式 + PCM 重采样）
        ├── useVoiceInput.ts     # 替换式流式转写（voiceBaseRef/voiceLenRef）
        └── SettingsPage.tsx     # 设置页（总开关 / 凭证 / 快捷键）
```

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  Console (宿主)                    插件 plugins/apps/qwenpaw-voice │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  window.QwenPaw.host  ──────────▶  getHost() (React/antd/fetch) │
│                                                                 │
│  ChatList.senderPrefix 扩展槽 ◀── ns.chat.sender.addPrefix()    │
│      └─ 挂载 SpeechButton（总开关开启时）                        │
│                                                                 │
│  routeRegistry / menuRegistry ◀── ns.route.add / ns.menu.add    │
│      └─ /qwenpaw-voice 设置页（菜单「语音输入」+ 麦克风图标）      │
│                                                                 │
│  Chat/index.tsx：上游语音块原样保留，仅新增 pluginVoiceOn 门控    │
│  （开→插件麦克风；关→官方 WhisperSpeechButton / allowSpeech）    │
│                                                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTP/WS  /api/qwenpaw-voice/*
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  插件后端 router.py (api.register_http_router, prefix=...)       │
│   ├─ GET  /status                                               │
│   ├─ POST /voice-test-connection                                │
│   ├─ GET/PUT /client-config                                     │
│   └─ WS   /transcribe/ws                                        │
│                                                                 │
│  volcengine_asr.py ──▶ wss://openspeech.bytedance.com/...       │
└─────────────────────────────────────────────────────────────────┘
```

## 关键设计点

### 1. 后端零改动

- `audio_transcription.py`、`workspace.py`、`config.py` **已还原为 fork base 版本**（diff = 0）
- 火山 ASR 全部逻辑复制到 `backend/volcengine_asr.py`（唯一改动：`load_envs`
  由包内相对导入改为 `from qwenpaw.envs import load_envs` 绝对导入）
- 插件路由经 `api.register_http_router(router, prefix="/qwenpaw-voice")` 挂到 `/api/qwenpaw-voice/*`
- 原 `/workspace/transcribe/ws` 的 `transcription_provider_type != "volcengine_bigmodel"` 检查
  改为插件内 `_credentials_ready()` 凭证检查 —— **不再依赖上游 config 枚举**

### 2. 前端集成：senderPrefix 槽 + Chat 开关门控

Chat 页复用已有的 `ChatList.senderPrefix` 扩展槽挂插件麦克风：

```tsx
// 插件入口自动注册
ns.chat.sender.addPrefix(PLUGIN_ID, <VoiceSenderPrefix />, { order: 0 });
```

`Chat/index.tsx` **保留上游原生语音块**（whisper 探测 / WhisperSpeechButton /
内置快捷键 / `allowSpeech` 公式，与 merge-base 逐字一致），只新增
`pluginVoiceOn` 门控：

```tsx
// 插件开启 → 内置按钮让位；关闭 → 显示官方内置按钮
{whisperEnabled && !pluginVoiceOn ? (
  <WhisperSpeechButton ref={whisperSpeechRef} ... />
) : null}

// allowSpeech 同理：恢复官方公式并加开关
allowSpeech: !pluginVoiceOn && whisperChecked && !whisperEnabled,
```

### 3. 总开关：实时语音 ⇄ 官方内置语音

设置页第一张卡片控制 `qwenpaw_voice_enabled`（默认开启）：

| 状态 | 麦克风 | 快捷键 | SDK `allowSpeech` |
|------|--------|--------|-------------------|
| 开启（默认） | 插件流式麦克风（senderPrefix 槽） | 插件可配置快捷键（toggle/hold） | 禁用（防双麦克风） |
| 关闭（`"0"`） | 官方 `WhisperSpeechButton`（whisper provider 已配置时） | 内置 Ctrl/Cmd+Shift+M | 恢复官方公式 |

同步机制（`config.ts saveVoiceEnabled`）：

1. 写 `localStorage.qwenpaw_voice_enabled`
2. 持久化到 `~/.clipaw/client-config.json`（跨重启）
3. 派发自定义事件 `qwenpaw-voice-change`（**同 tab**——设置页与 Chat 同属
   一个 SPA，storage 事件只跨 tab 触发）
4. storage 事件负责其他标签页

Chat 页与插件的 `VoiceSenderPrefix` 各自监听上述两类事件刷新
`pluginVoiceOn` / `voiceEnabled`，切换即时生效、无需刷新。

**重启持久化闭环**：插件 bundle 加载时 `loadClientConfig()` 从后端恢复
`qwenpaw_voice_enabled` 到 localStorage，恢复完成后**再次派发**
`qwenpaw-voice-change`——即使 Tauri 换端口清空了 localStorage、Chat 页已先
以默认值挂载，事件到达后立即纠正为持久化的开关状态。

**按钮位置/图标统一（开/关对输入框无感知）**：插件麦克风固定渲染在
sender prefix 行**第一项**（`Chat/index.tsx` 里 `{pluginSenderPrefix}` 排在
`prefix` 块最前），与官方 `WhisperSpeechButton` 同一位置。

图标/容器做到与官方**逐字段等价**（以生产环境真实 DOM 为基准核对）：

| 项 | 官方 WhisperSpeechButton | 插件 SpeechButton |
|----|-------------------------|-------------------|
| button class | antd 生成 `qwenpaw-btn qwenpaw-btn-text qwenpaw-btn-color-default qwenpaw-btn-variant-text qwenpaw-btn-icon-only` + `qwenpaw-sender-actions-btn qwenpaw-spark-icon-button spark-button` | 同（前 5 个 antd 自动生成，后 3 个手动 `className` 补齐） |
| button style | `font-weight: 500; line-height: 1;` | 同 |
| 图标包裹 | `span.spark-icon.spark-icon-spark-mic-line` + `role=img aria-label=spark-mic-line data-spark-icon=true` | **同**（直接复用官方类名，console 已全局加载 `.spark-icon` CSS） |
| 图形 | svg `width/height=1em viewBox="0 0 1024 1024" overflow="hidden" fill="currentColor" aria-hidden="true"` + 3 条 path | **同**（path 逐字复刻） |

> **尺寸的真正来源**：Chat 的 less 用 `[class$="-sender-actions-btn"]`
> 把该按钮固定为 **44×44px、圆角 12px**。官方按钮由 SDK 自动带上这个
> class，插件按钮必须手动补 —— 缺它则退化成裸 1em 图标，这就是此前
> "图标比官方小"的根因。

插件 bundle 无法 import `@agentscope-ai/icons`（blob 加载时裸 import 会
失败），但 console 已全局加载该库的 `.spark-icon` CSS，故插件**直接复用
官方类名**（无需自注入样式），DOM 与继承链完全一致。三态图标（idle
`SparkMicLine` / loading `LoadingOutlined 1.2em` / recording
`RecordingIcon 1.2em`）亦与官方相同。

开关切换只换**点击行为**（流式 vs 官方一次性），位置与外观不变。

### 4. 「发送时停止录音」如何做到零侵入

原实现在 `handleBeforeSubmit` 两处调用 `stopVoiceOnSubmit()`。
插件改为**捕获阶段 DOM 监听**（`index.tsx` 的 `VoiceSenderPrefix`）：

- `keydown`（Enter，非 Shift）且 target 是 textarea → 停止录音 + `resetSession()` + 清边界
- `click` 命中含 `send` 的按钮 → 同上

这样录制/提交的生命周期完全由插件自管，Chat 页无需任何调用点。

### 5. 前端 bundle 必须在宿主 React 内运行

宿主用 `import(blobUrl)` 加载插件（`usePluginLoader.executePluginScript`），因此：

- **必须是 ESM**（`formats: ["es"]`），不能用 IIFE
- **不能有裸 `import "react"`**（blob URL 无模块解析）→ 所有 React/antd 从
  `window.QwenPaw.host` 取；`jsxRuntime: "classic"` + 本地 `const React = host.React`
- **不能用 react-i18next**（它自带 `import "react"`）→ `i18n.ts` 自带文案表 +
  基于 host React 的 `useTranslation`，语言跟随 `localStorage.language`

验证：`grep -E '^import' dist/index.js` 应为空。

### 6. 自动发现

`src/qwenpaw/app/_app.py` 的 `_BUNDLED_PLUGIN_IDS`（**fork 专属机制**）加入
`"qwenpaw-voice"`，启动时把 `plugins/apps/qwenpaw-voice/` 复制进运行时插件
目录（`$QWENPAW_WORKING_DIR/plugins`，本机为 `~/.qwenpaw/plugins`），随插件
系统自动加载，无需手动 `qwenpaw plugin install`。

同步为**版本感知**：比对源/目标 `plugin.json` 的 `version`，不一致才整体替换
（一致则不动运行时，保护手工修改）。因此**修改插件源码后必须递增
`plugin.json` 版本号**，否则运行时继续跑旧拷贝。复制时排除 `node_modules` /
`__pycache__` 等开发产物（运行时只需 `frontend/dist/index.js`）。

### 7. 配置存储

| 类型 | 位置 |
|------|------|
| 火山凭证（API Key / Resource ID） | envs store（`volcengine_asr_api_key` 等） |
| UI 配置（总开关/快捷键/连接状态） | `~/.clipaw/client-config.json`，由插件 REST 提供 |
| Agent 持久化 | 同上文件；Console 的 `clientConfig.ts`（fork 文件）指向插件端点 |

> 火山 ASR 不再写入上游 `config.agents.transcription_provider_type`。
> 上游的 Whisper API / Local Whisper 转写能力保持原样可用。

## 冲突面

合并 `upstream/main` 时，语音相关的冲突点：

| 文件 | 状态 | 冲突可能性 |
|------|------|-----------|
| `plugins/apps/qwenpaw-voice/**` | 全新目录，上游不存在 | **无** |
| `src/qwenpaw/**`（语音相关） | 与 fork base 完全一致 | **无** |
| `console/src/pages/Settings/VoiceTranscription/**` | 与 fork base 完全一致 | **无** |
| `console/src/pages/Chat/index.tsx` | 上游语音块原样保留，仅新增开关门控（+44/-5 纯增量） | 低：门控为独立新增块，上游改动命中同区域才会冲突 |
| `src/qwenpaw/app/_app.py` | fork 专属的 `_BUNDLED_PLUGIN_IDS` 加一项 | 低（该机制本身即 fork 新增） |

**结论**：语音功能的冲突面从「6 个上游文件 / 1900+ 行」压缩到
「1 个上游文件的纯增量门控块 + 1 个 fork 专属常量的 1 个数组项」。

## API 端点（插件提供）

### WebSocket: `/api/qwenpaw-voice/transcribe/ws`

**浏览器 → 服务端：**
- Binary Frame：原始 PCM Int16 16kHz 单声道
- Text `"DONE"`：录音结束
- Text `"RESET"`：丢弃当前会话重开

**服务端 → 浏览器：**
- `{"type":"partial","text":"..."}` / `{"type":"final","text":"..."}` / `{"type":"error","message":"..."}`

### POST `/api/qwenpaw-voice/voice-test-connection`

请求体可选 `{api_key, resource_id}`；返回 `{ok: true}` 或 `{ok: false, error}`。

### GET/PUT `/api/qwenpaw-voice/client-config`

读写 `~/.clipaw/client-config.json`（PUT 为合并写入）。

### GET `/api/qwenpaw-voice/status`

返回 `{provider, configured}` —— 是否已配置火山凭证。

## 火山引擎 BigModel ASR 协议

- 连接：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`
- 帧：4 字节头 + 4 字节 payload_size + payload（大端）
- 消息类型：Full Client Request(1) / Audio Only(2) / Server Response(9) / Error(15)
- 音频块：200ms @16kHz/16bit/mono = 6400 字节
- 鉴权：新版 `X-Api-Key`；旧版 `X-Api-App-Key` + `X-Api-Access-Key`
- SSL 跳过证书校验（企业代理自签证书兼容）

## 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `volcengine_asr_api_key` | 火山 API Key（新版控制台） | （必填） |
| `volcengine_asr_resource_id` | 资源 ID | `volc.bigasr.sauc.duration` |
| `volcengine_asr_app_id` | App ID（旧版控制台） | （可选） |
| `volcengine_asr_access_token` | Access Token（旧版控制台） | （可选） |

## 构建与验证

```bash
# 前端 bundle
cd plugins/apps/qwenpaw-voice/frontend
npm install && npm run build      # → dist/index.js（ESM，自包含）

# 校验无裸 import（关键）
grep -E '^import' dist/index.js   # 应为空

# 后端插件加载
python -c "
import asyncio, tempfile, shutil
from pathlib import Path
from fastapi import FastAPI
from qwenpaw.plugins.loader import PluginLoader
from qwenpaw.plugins.registry import PluginRegistry
async def m():
    app = FastAPI(); PluginRegistry().set_plugin_http_app(app)
    tmp = Path(tempfile.mkdtemp())
    shutil.copytree(Path('plugins/apps/qwenpaw-voice'), tmp/'qwenpaw-voice')
    print(await PluginLoader([tmp]).load_all_plugins())
asyncio.run(m())"

# Console 类型检查 + 测试
cd console && npx tsc -b --noEmit && npx vitest run src/pages/Chat
```

## 注意事项

1. **`websockets` 依赖**：插件 `plugin.json` 声明，`backend/volcengine_asr.py` 需该库
2. **ffmpeg**：仅一次性转写模式（上游能力）需要
3. **连通性测试**：用户须先在插件设置页通过测试，未测试时麦克风按钮禁用
4. **ScriptProcessorNode 已弃用**：当前仍用（兼容性好），未来可迁 AudioWorkletNode
5. **partial 是累积全文**：前端必须替换语音段而非追加（`voiceBaseRef`/`voiceLenRef`）
6. **总开关与内置语音互斥**：插件开启时 `allowSpeech` 禁用、内置 Whisper 按钮
   让位；关闭时恢复官方默认（`allowSpeech: !pluginVoiceOn && whisperChecked && !whisperEnabled`）
7. **回退路径测试已恢复**：`ChatPage.coverage.test.tsx` /
   `sdkHostIntegration.test.tsx` 中「内置 whisper 按钮」4 个用例恢复运行
   （用例内设 `qwenpaw_voice_enabled="0"` 验证回退），并新增 1 个
   「插件开启时内置按钮让位」反向用例，双向覆盖开关

## 变更历史

| 日期 | 变更内容 |
|------|---------|
| 2026-06-18 | 初始实现：Whisper API + Local Whisper 一次性转写 |
| 2026-07-02 | 新增火山引擎 BigModel 流式 ASR、快捷键、client-config、流式替换策略 |
| 2026-09-28 | **重构为插件架构**：全部代码迁入 `plugins/apps/qwenpaw-voice/`；还原 3 个上游后端文件、`WhisperSpeechButton`、设置页；Chat 仅保留扩展槽渲染 |
| 2026-09-28 | **移除全自动语音交互功能**：删除 `useAutoVoice.ts` / `AutoVoiceIndicator.tsx` 及设置页对应卡片、配置键 `qwenpaw_auto_voice`、相关 i18n 文案 |
| 2026-09-28 | **更名「语音输入」+ 菜单麦克风图标**（`AudioOutlined`，同 background-theme 的 `menu.add` icon 模式） |
| 2026-09-28 | **新增实时语音总开关**：`qwenpaw_voice_enabled`（默认开）+ 设置页开关卡片 + `qwenpaw-voice-change` 同 tab 事件；Chat 恢复上游内置语音块并加 `pluginVoiceOn` 门控，关闭时回退官方 `WhisperSpeechButton` / `allowSpeech` |
| 2026-09-29 | **v1.2.0**：插件麦克风图标换官方 `SparkMicLine` 逐字复刻并固定 prefix 行首（开关切换位置/外观不变）；`loadClientConfig` 恢复后补广播事件（重启持久化闭环）；`_sync_bundled_plugins` 改版本感知重同步并排除 node_modules；插件麦克风渲染顺序移至 `pluginSenderPrefix` 第一项 |
| 2026-09-29 | **v1.3.0**：图标改 `span.qpv-spark-icon` + 官方 svg 路径逐字复刻（注入同款 `.spark-icon` CSS），按钮内联样式对齐 design 库 Button（`fontWeight:500, lineHeight:1`，去掉自定义 padding）——开/关对输入框完全无感知；同步补齐 `copytree(dirs_exist_ok=True)` 兜底；重新构建并同步 console 产物至 `src/qwenpaw/console` |
| 2026-09-29 | **v1.4.0**：按钮补官方 class `qwenpaw-sender-actions-btn`（Chat less 据此设 44×44/圆角12px —— 此前"图标偏小"的根因）/ `qwenpaw-spark-icon-button` / `spark-button`；图标包裹改回官方类名 `spark-icon spark-icon-spark-mic-line` + `data-spark-icon`（弃用自注入 `qpv-spark-icon`，console 已有全局 CSS）；svg 补 `overflow="hidden"`。DOM 以生产真实渲染为基准逐字段核对一致 |
| 2026-09-29 | **v1.5.0**：**彻底解决开/关按钮位置不一致** —— 根因：SDK 把 prefix 内容渲染在附件按钮之后，插件麦克风（prefix 槽）永远在附件后；而 SDK 语音按钮（`allowSpeech`）在附件前。方案：插件开启时 `allowSpeech=true`（SDK 语音按钮始终显示在附件前），插件渲染**隐藏的 SpeechButton**（提供流式录音逻辑）+ **捕获阶段劫持 SDK 语音按钮点击**（`stopPropagation` → 调 `speechRef.toggleRecording()`）+ **录音状态反馈**（`setInterval` 轮询状态 → 给 SDK 按钮 `style.color`）。开/关时可见麦克风始终是 SDK 原生的那个（位置、尺寸、图标、class 全一致） |
