# 语音转写功能设计说明

## 概述

语音转写功能允许用户在聊天对话中通过语音输入文字，支持实时流式识别。系统支持三种 ASR（自动语音识别）后端：

| Provider | 说明 | 特点 |
|----------|------|------|
| `whisper_api` | OpenAI 兼容的 Whisper API 端点 | 录音完成后一次性转写 |
| `local_whisper` | 本地安装的 openai-whisper 库 | 离线可用，无需网络 |
| `volcengine_bigmodel` | 火山引擎大模型流式 ASR | **实时流式识别**，边说边出文字 |

> **当前默认**：系统启动时自动将 `transcription_provider_type` 设为 `volcengine_bigmodel`，使用火山引擎流式 ASR 作为主要语音输入方式。Whisper API / Local Whisper 仍保留作为一次性转写备选。

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端 (Console)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐   ┌───────────────────┐   ┌───────────────┐  │
│  │ Chat/index   │──▶│WhisperSpeechButton│──▶│ WebSocket 连接 │  │
│  │  (快捷键监听) │   │  (录音 + PCM 编码) │   │ (实时推送音频) │  │
│  └──────────────┘   └───────────────────┘   └───────┬───────┘  │
│                                                      │          │
│  ┌──────────────────────────────────────────────────┐│         │
│  │ Settings/VoiceTranscription                      ││         │
│  │  ├─ VolcengineConfigCard (凭证管理+连通性测试)    ││         │
│  │  ├─ ShortcutSettings (快捷键配置)                 ││         │
│  │  ├─ ProviderTypeCard (后端选择)                   ││         │
│  │  └─ ProviderSelectCard (Whisper选择)              ││         │
│  └──────────────────────────────────────────────────┘│         │
│                                                      │          │
│  ┌──────────────────────────────────────────────────┐│         │
│  │ api/clientConfig.ts (持久化配置)                  ││         │
│  │  - voice_connected (连接状态)                     ││         │
│  │  - qwenpaw_voice_shortcut (快捷键)               ││         │
│  │  - qwenpaw_voice_shortcut_mode (模式)            ││         │
│  │  - qwenpaw-last-used-agent (上次使用的 Agent)     ││         │
│  └──────────────────────────────────────────────────┘│         │
│                                                      │          │
└──────────────────────────────────────────────────────┼──────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端 (Python)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ workspace.py 路由                                         │   │
│  │  ├─ WebSocket /transcribe/ws    (流式转写)                │   │
│  │  ├─ POST /voice-test-connection (连通性测试)              │   │
│  │  ├─ GET/PUT /client-config      (客户端配置持久化)        │   │
│  │  ├─ GET/PUT /transcription-provider-type                  │   │
│  │  └─ GET/PUT /transcription-providers                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ audio_transcription.py                                    │   │
│  │  ├─ transcribe_audio()           (统一入口)               │   │
│  │  ├─ _transcribe_whisper_api()    (Whisper API)            │   │
│  │  ├─ _transcribe_local_whisper()  (本地 Whisper)           │   │
│  │  ├─ _transcribe_volcengine_bigmodel() (火山一次性)        │   │
│  │  ├─ stream_transcribe_volcengine()    (火山流式 ASR)      │   │
│  │  └─ test_volcengine_connection()    (连通性测试)          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ config.py                                                 │   │
│  │  └─ transcription_provider_type: Literal[                 │   │
│  │       "disabled"|"whisper_api"|"local_whisper"             │   │
│  │       |"volcengine_bigmodel"]                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ agents.py                                                 │   │
│  │  └─ PUT /agents/active (持久化活跃 Agent)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              火山引擎大模型 ASR 服务                              │
│  wss://openspeech.bytedance.com/api/v3/sauc/bigmodel            │
│  - 二进制帧协议 (4 字节头 + payload)                             │
│  - 实时推送 partial/final 结果                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 核心流程

### 1. 流式语音转写（Volcengine BigModel）— 主要方式

```
用户按下录音键 / 触发快捷键
    │
    ▼
前端检查 isVoiceConnected() — 未测试连通性则禁用按钮
    │
    ▼
前端获取麦克风权限 (MediaDevices.getUserMedia)
    │
    ▼
前端打开 WebSocket → ws(s)://{backend}/workspace/transcribe/ws
    │
    ▼
ws.onopen: 后端建立火山引擎 WSS 连接，发送 config 帧
    │
    ▼
前端 ScriptProcessorNode 采集音频 → 重采样为 16kHz Int16 PCM
    │
    ├──(每帧约 100ms)──▶ 前端发送 Binary Frame (PCM 数据)
    │                         │
    │                         ▼
    │                   后端 stream_transcribe_volcengine()
    │                         │
    │                         ▼
    │                   后端转发到火山引擎 WSS 端点
    │                         │
    │                         ▼
    │                   火山返回 partial/final JSON
    │                         │
    │                         ▼
    │                   后端推送 {"type":"partial","text":"..."} 给前端
    │                         │
    ◀─────────────────────────┘
    │
    ▼
前端实时更新输入框文字 (onTranscription callback, isPartial=true)
    │  └─ 替换策略：保留语音开始前的已有文字 (voiceBaseRef)，
    │     用新的 partial 文本替换语音部分 (voiceLenRef)
    │
    ▼
用户松开录音键 / 点击停止 / 发送消息
    │
    ▼
前端发送 Text Frame "DONE"
    │
    ▼
后端发送 final 帧，关闭连接
    │
    ▼
前端 onTranscription(text, isPartial=false) — 最终文字填入输入框
    │
    ▼
用户发送消息后，前端调用 resetSession() 清空 ASR 会话
```

### 2. 一次性转写（Whisper API / Local Whisper）— 备选方式

```
用户按下录音键
    │
    ▼
前端录制完整音频 → 停止后编码为 WAV/WebM
    │
    ▼
前端 POST /workspace/transcribe (multipart/form-data)
    │
    ▼
后端调用 transcribe_audio(file_path)
    │
    ├─ whisper_api → 调用远程 /v1/audio/transcriptions
    ├─ local_whisper → 本地 whisper.load_model("base").transcribe()
    └─ volcengine_bigmodel → _transcribe_volcengine_bigmodel()
         (ffmpeg 转 PCM 16kHz → 流式发送 → 收集最终文本)
    │
    ▼
返回完整文字给前端
```

## 文件清单

### 前端

| 文件路径 | 职责 | 改动类型 |
|----------|------|---------|
| `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx` | 录音按钮组件，WebSocket 流式 ASR + PCM 重采样 + 连通性检查 | 修改（重构） |
| `console/src/pages/Chat/index.tsx` | 聊天页面，集成语音按钮 + 可配置快捷键 + 流式文字替换 + 发送时停止录音 | 修改 |
| `console/src/pages/Settings/VoiceTranscription/index.tsx` | 语音转写设置页面入口 | 修改（精简） |
| `console/src/pages/Settings/VoiceTranscription/useVoiceTranscription.ts` | 设置页面状态管理 hook | 修改（精简） |
| `console/src/pages/Settings/VoiceTranscription/components/VolcengineConfigCard.tsx` | 火山引擎凭证配置 + 连通性测试 + 连接状态管理 | **新增** |
| `console/src/pages/Settings/VoiceTranscription/components/ShortcutSettings.tsx` | 快捷键录制与配置（toggle/hold 模式） | **新增** |
| `console/src/pages/Settings/VoiceTranscription/components/ProviderTypeCard.tsx` | ASR 后端类型选择（新增 volcengine 选项） | 修改 |
| `console/src/pages/Settings/VoiceTranscription/components/index.ts` | 组件导出索引 | 修改 |
| `console/src/api/clientConfig.ts` | 客户端配置持久化（跨 Tauri 端口重启） | **新增** |
| `console/src/api/modules/agent.ts` | `testVoiceConnection` + `setActiveAgent` API 方法 | 修改 |
| `console/src/stores/agentStore.ts` | Agent 选择持久化到后端 + clientConfig | 修改 |
| `console/src/App.tsx` | 启动时调用 `loadClientConfig()` 恢复配置 | 修改 |
| `console/src/locales/en.json` | 英文国际化（火山引擎配置、快捷键、连通性测试） | 修改 |
| `console/src/locales/zh.json` | 中文国际化 | 修改 |

### 后端

| 文件路径 | 职责 | 改动类型 |
|----------|------|---------|
| `src/qwenpaw/agents/utils/audio_transcription.py` | 音频转写核心逻辑（三种 provider + 流式 ASR + 连通性测试 + 火山二进制帧协议） | 修改（大幅扩展） |
| `src/qwenpaw/app/routers/workspace.py` | WebSocket 端点 + REST API 端点 + client-config 持久化 | 修改 |
| `src/qwenpaw/app/routers/agents.py` | `PUT /agents/active` 持久化活跃 Agent | 修改 |
| `src/qwenpaw/config/config.py` | `transcription_provider_type` 新增 `volcengine_bigmodel` | 修改 |

## API 端点

### WebSocket: `/workspace/transcribe/ws`

流式语音转写 WebSocket 端点。

**协议（浏览器 → 服务端）：**
- Binary Frame: 原始 PCM Int16 16kHz 单声道音频块
- Text Frame `"DONE"`: 录音结束信号
- Text Frame `"RESET"`: 丢弃当前 ASR 会话，重新开始

**协议（服务端 → 浏览器）：**
- `{"type": "partial", "text": "..."}` — 中间识别结果
- `{"type": "final", "text": "..."}` — 最终识别结果
- `{"type": "error", "message": "..."}` — 错误信息

**服务端逻辑：**
1. 接受 WebSocket 连接后检查 `transcription_provider_type` 是否为 `volcengine_bigmodel`
2. 调用 `stream_transcribe_volcengine()` 创建火山引擎 ASR 会话
3. 从 WebSocket 接收音频帧，推入 `audio_queue`
4. 收到 `"DONE"` 后推入 `None` 哨兵触发结束标记
5. 收到 `"RESET"` 后关闭当前会话并重新创建新会话

### POST: `/workspace/voice-test-connection`

测试火山引擎 ASR 连通性。

**请求体（可选）：**
```json
{
  "api_key": "your-api-key",
  "resource_id": "volc.bigasr.sauc.duration"
}
```

**响应：**
```json
{ "ok": true }
// 或
{ "ok": false, "error": "error message" }
```

**逻辑：** 连接火山引擎 WSS 端点，发送 config 帧和 200ms 静音音频，等待响应。任何非 error 响应即表示连通。

### PUT: `/agents/active`

持久化当前活跃 Agent ID 到配置文件。

**请求体：**
```json
{ "agent_id": "xiaomi" }
```

### GET/PUT: `/workspace/client-config`

客户端配置持久化。解决 Tauri 端口变化导致 localStorage 丢失的问题。

**持久化的 key：**
- `voice_connected` — 火山引擎连接状态（`"1"` = 已连接）
- `qwenpaw_voice_shortcut` — 快捷键定义（JSON）
- `qwenpaw_voice_shortcut_mode` — 快捷键模式（`toggle` / `hold`）
- `qwenpaw-last-used-agent` — 上次使用的 Agent ID

**存储位置：** `~/.clipaw/client-config.json`

## 快捷键系统

### 两种模式

| 模式 | 行为 |
|------|------|
| `toggle` | 按一次开始录音，再按一次停止 |
| `hold` | 按住录音，松开停止 |

### 快捷键定义格式

```typescript
interface ShortcutDef {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;  // macOS ⌘
  code: string;   // KeyboardEvent.code, e.g. "KeyM"
}
```

### 默认快捷键

- **macOS**: `⌘ + ⇧ + M`
- **Windows/Linux**: `Ctrl + Shift + M`

### 存储位置

快捷键通过 `clientConfig.ts` 同时存储在：
1. `localStorage`（前端快速读取）
2. 后端 `client-config.json`（跨端口持久化）

### 快捷键监听范围

- 聊天页面（`isChatActive()` 为 true 时）
- Coding 模式页面（`location.pathname` 以 `/coding` 开头时）

## 连通性检查机制

### 前端

- `VolcengineConfigCard` 组件提供"测试连通性"按钮
- 测试成功后设置 `voice_connected = "1"` 到 clientConfig
- `WhisperSpeechButton` 通过 `isVoiceConnected()` 检查连接状态
- **未测试连通性时，录音按钮禁用**，Tooltip 提示"语音服务未连接"

### 后端

- `test_volcengine_connection()` 连接火山引擎 WSS，发送静音音频验证
- 支持 15 秒超时
- SSL 证书验证跳过（兼容企业代理环境）

## 火山引擎 BigModel ASR 协议

### 连接地址

```
wss://openspeech.bytedance.com/api/v3/sauc/bigmodel
```

### 认证方式

**方式一：新版控制台（API Key）**
```
X-Api-Key: {api_key}
X-Api-Resource-Id: {resource_id}  (默认: volc.bigasr.sauc.duration)
X-Api-Request-Id: {uuid}
X-Api-Sequence: -1
```

**方式二：旧版控制台（App ID + Access Token）**
```
X-Api-App-Key: {app_id}
X-Api-Access-Key: {access_token}
X-Api-Resource-Id: {resource_id}
X-Api-Request-Id: {uuid}
X-Api-Sequence: -1
```

### 二进制帧格式

每帧 4 字节头 + 4 字节 payload_size + payload：

```
Byte 0: (protocol_version << 4) | header_size   →  0x11
Byte 1: (message_type << 4) | flags
Byte 2: (serialization << 4) | compression
Byte 3: 0x00 (reserved)
Byte 4-7: payload_size (big-endian uint32)
Byte 8+:  payload
```

- **Full Client Request** (mt=1, flags=0, ser=1): JSON payload 包含音频参数
- **Audio Only** (mt=2, flags=0): 纯 PCM 音频数据
- **Last Audio** (mt=2, flags=2): 最后一帧音频（空 payload）
- **Server Response** (mt=9, ser=1): JSON 响应，包含识别结果
- **Server Error** (mt=15): 错误响应

### JSON 配置 payload

```json
{
  "user": { "uid": "qwenpaw" },
  "audio": {
    "format": "pcm",
    "rate": 16000,
    "bits": 16,
    "channel": 1,
    "language": "zh-CN"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true
  }
}
```

### 音频块大小

200ms 的 16kHz 16bit 单声道 PCM = 6400 字节

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `volcengine_asr_api_key` | 火山引擎 API Key（新版控制台） | （必填） |
| `volcengine_asr_resource_id` | 资源 ID | `volc.bigasr.sauc.duration` |
| `volcengine_asr_app_id` | App ID（旧版控制台） | （可选） |
| `volcengine_asr_access_token` | Access Token（旧版控制台） | （可选） |

## 配置方式

### 方式一：Settings 页面配置（推荐）

1. 进入 **Settings → Voice Transcription**
2. 在 **Volcengine ASR Configuration** 卡片中点击"Edit"填入 API Key
3. 点击"Save"保存
4. 点击"Test Connection"验证连通性 — 测试成功后录音按钮才可用
5. 在 **Shortcut Settings** 中配置快捷键和触发模式（可选）

> 页面加载时自动将 `transcription_provider_type` 设为 `volcengine_bigmodel`，无需手动选择。

### 方式二：环境变量配置

在 `.env` 或系统环境变量中设置：

```bash
VOLCENGINE_ASR_API_KEY=your-api-key
VOLCENGINE_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
VOLCENGINE_ASR_APP_ID=your-app-id        # 旧版控制台
VOLCENGINE_ASR_ACCESS_TOKEN=your-token    # 旧版控制台
```

然后在 `config.yaml` 中设置：

```yaml
agents:
  transcription_provider_type: volcengine_bigmodel
```

## 使用方式

配置完成并通过连通性测试后，在聊天页面：

1. **点击麦克风按钮** — 开始/停止录音
2. **使用快捷键** — 根据配置的模式（toggle/hold）控制录音
3. 录音期间，识别文字会**实时**填入输入框（partial 替换更新）
4. 停止录音后，最终文字自动填入
5. **发送消息时**自动停止录音并重置 ASR 会话
6. 下次语音输入从空白开始

## 技术要点

### 音频处理

- 使用 `ScriptProcessorNode`（4096 buffer）采集浏览器麦克风音频
- 原始采样率（通常 44100Hz/48000Hz）重采样为 **16000Hz**（线性插值）
- 编码为 **Int16 PCM** 单声道格式（little-endian）
- 通过 WebSocket 实时发送 Binary Frame

### 流式文字替换策略

前端维护两个 ref 来实现 partial 文本的增量替换：
- `voiceBaseRef` — 语音开始前输入框中的已有文字
- `voiceLenRef` — 当前语音已插入的文字长度

**partial 更新：** 保留 `voiceBaseRef` 前缀，替换 `voiceLenRef` 长度的语音部分为新 partial 文本。
**final 更新：** 保留 `voiceBaseRef` 前缀，追加最终文本，重置 `voiceLenRef = 0`。

### 连接管理

- WebSocket 连接在每次录音时建立，录音结束后关闭
- 支持异常断开自动清理（`cleanup` 函数）
- 最大录音时长 5 分钟（前端计时器保护）
- 发送消息时自动停止录音 + `resetSession()` 清空 ASR 会话

### 配置持久化

- Tauri 桌面应用每次启动可能使用不同端口
- `localStorage` 基于 origin，端口变化会丢失数据
- `clientConfig.ts` 通过后端文件存储（`~/.clipaw/client-config.json`）解决此问题
- App 启动时自动调用 `loadClientConfig()` 恢复配置到 localStorage
- `SYNC_KEYS` 集合控制哪些 key 需要跨端口同步

### 凭证读取优先级

后端 `_get_volcengine_creds_full()` 按以下顺序读取凭证：
1. **envs store**（Settings 页面保存的环境变量）— 优先
2. **系统环境变量**（`VOLCENGINE_ASR_*`）— 回退

支持两种鉴权方式：
- 新版控制台：`api_key` → `X-Api-Key` header
- 旧版控制台：`app_id` + `access_token` → `X-Api-App-Key` + `X-Api-Access-Key` headers

### SSL 证书

- `_build_volcengine_ssl_ctx()` 创建跳过证书验证的 SSL 上下文
- 原因：桌面端常运行在企业代理后，代理注入的自签名证书会导致默认验证失败

## 注意事项

1. **websockets 依赖**：后端需要安装 `websockets` Python 库（`uv pip install websockets`）
2. **ffmpeg 依赖**：一次性转写模式需要系统安装 ffmpeg
3. **连通性测试**：用户必须先通过连通性测试才能使用语音输入，未测试时录音按钮禁用
4. **自动 provider 设置**：设置页面加载时自动将 provider type 设为 `volcengine_bigmodel`，确保 WebSocket 流式路径默认激活
5. **ScriptProcessorNode 弃用警告**：当前使用 `ScriptProcessorNode`（已标记 deprecated），未来可考虑迁移到 `AudioWorkletNode`，但兼容性更好
6. **partial 文本质量**：火山引擎返回的 partial 是累积文本（非增量），前端直接替换语音部分即可
7. **RESET 信号**：前端发送消息后调用 `resetSession()`，后端关闭当前 ASR 会话并创建新会话，确保下次语音输入从空白开始
8. **Agent 持久化**：选择 Agent 时同时持久化到后端配置文件（`PUT /agents/active`）和 client-config，解决 Tauri 端口变化后 Agent 选择丢失的问题

## 变更历史

| 日期 | 变更内容 |
|------|---------|
| 2026-06-18 | 初始实现：Whisper API + Local Whisper 一次性转写 |
| 2026-07-02 | 新增火山引擎 BigModel 流式 ASR：WebSocket 实时转写、二进制帧协议、连通性测试、快捷键系统（toggle/hold）、客户端配置持久化、流式文字替换策略、发送时自动停止录音+重置会话、Agent 选择持久化 |