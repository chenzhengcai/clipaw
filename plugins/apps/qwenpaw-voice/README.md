# qwenpaw-voice — 语音输入插件

基于**火山引擎大模型流式 ASR** 的实时语音转文字插件。整个语音功能（后端 +
前端 + 设置页）都封装在本插件目录内，**不修改任何上游源码文件**，因此合并
`upstream/main` 时语音部分零冲突。

## 功能

- **实时流式识别**：边说边出文字（WebSocket + PCM 16kHz）
- **一键总开关**：关闭插件实时语音后自动回退官方内置语音输入
- **可配置快捷键**：`toggle`（按一下开/关）/ `hold`（按住说话）
- **凭证连通性测试**：未通过测试时麦克风按钮禁用
- **跨重启配置持久化**：解决 Tauri 端口变化导致 localStorage 丢失

## 总开关（实时语音 ⇄ 官方内置语音）

设置页第一张卡片为「实时语音输入」开关（`qwenpaw_voice_enabled`，默认开启）：

| 状态 | 行为 |
|------|------|
| **开启**（默认） | 麦克风由本插件接管：优先**劫持宿主已有的麦克风按钮**（SDK `allowSpeech` 麦克风或官方 `WhisperSpeechButton`），点击走火山流式 ASR；宿主没有任何麦克风时，插件在 `senderPrefix` 槽渲染自己的按钮。宿主内置按钮不会被触发，因此不会出现「双麦克风」或「点到内置一次性转写」 |
| **关闭** | 插件麦克风与快捷键全部下线；Chat 页回退官方内置语音（`WhisperSpeechButton` + `allowSpeech`） |

> **v1.5.3 修复**：此前插件只劫持 SDK 的 `.spark-icon-spark-mic-line` 按钮。
> 一旦宿主没有渲染该按钮（`allowSpeech=false`，例如已配置 Whisper 转写
> provider），点击麦克风会走宿主自己的转写接口而不是插件，表现为
> **「点击麦克风没有输入语音」**。现在插件按 DOM 发现任意宿主麦克风
> （SDK 麦克风 / 官方 Whisper 按钮的 lucide `mic` 图标），都劫持到流式识别；
> 一个都没有时才渲染自己的按钮（`data-qwenpaw-voice-mic` 标记，避免自劫持）。

切换即时生效：插件在 `localStorage` 写键后派发 `qwenpaw-voice-change`
自定义事件（同 tab），storage 事件（跨 tab）负责其余标签页同步。开关值持久化
到 `~/.clipaw/client-config.json`，跨重启生效——插件加载时从后端恢复配置并
再次广播事件，已挂载的 Chat 页会立即读到恢复后的开关值（即使 Tauri 换端口
清了 localStorage）。

**按钮位置与图标（开/关对输入框无感知）**：

- **位置**：优先复用宿主自己的麦克风按钮，因此位置/外观与官方完全一致；
  仅当宿主没有麦克风按钮时，才在 sender prefix 槽渲染插件自己的按钮。
- **图标**：直接复用官方类名 `spark-icon spark-icon-spark-mic-line` +
  `data-spark-icon="true"`，svg 用官方同款属性（含 `overflow="hidden"`）与
  3 条逐字复刻的 path。console 已全局加载 `.spark-icon` CSS，无需自注入。
- **容器**：antd `Button type="text"` + `{fontWeight:500, lineHeight:1}`，
  并手动补 `className="qwenpaw-sender-actions-btn qwenpaw-spark-icon-button
  spark-button"`。**其中 `qwenpaw-sender-actions-btn` 是关键**：Chat 的 less
  用 `[class$="-sender-actions-btn"]` 把它定为 44×44px / 圆角 12px（官方按钮
  由 SDK 自动带上），缺它就会退化成裸 1em 图标、显得偏小。

⇒ 两者 DOM 结构与字体继承链一致，尺寸/样式完全相同。开关切换只换"点击后的
行为"（流式 vs 官方一次性），按钮位置与外观不变。

## 结构

```
plugin.json              # 插件 manifest
plugin.py                # 后端入口（plugin = QwenpawVoicePlugin()）
backend/
  router.py              # /status, /voice-test-connection, /client-config, WS /transcribe/ws
  volcengine_asr.py      # 火山二进制帧协议 + 流式会话 + 连通性测试
  client_config.py       # client-config.json 读写
frontend/
  vite.config.ts         # ESM + classic JSX + external react
  src/index.tsx          # 入口：注册 route/menu/senderPrefix + 快捷键 + 提交拦截 + 总开关
  src/host.ts            # window.QwenPaw host 桥接
  src/SpeechButton.tsx   # 麦克风按钮
  src/SettingsPage.tsx   # 设置页（总开关 / 凭证 / 快捷键）
  dist/index.js          # 构建产物（需执行 npm run build 生成）
```

## 构建

```bash
cd frontend
npm install
npm run build        # → dist/index.js

# 关键校验：产物必须自包含（宿主用 import(blobUrl) 加载，无模块解析）
grep -E '^import' dist/index.js   # 应为空
```

> **发布提示**：修改插件源码后必须**递增 `plugin.json` 的 `version`**。
> 启动时 `_sync_bundled_plugins` 按 manifest 版本比对决定是否重同步到
> 运行时目录（`~/.qwenpaw/plugins/`）——版本不变则运行时保持旧拷贝。
> 同步时自动排除 `node_modules` / `__pycache__` 等开发产物。

## 集成方式

宿主（Console）提供的扩展点：

| 扩展点 | 用途 |
|--------|------|
| `window.QwenPaw.host` | React / antd / getApiUrl / getApiToken |
| `window.QwenPaw.chat.sender.addPrefix()` | 在输入框前缀挂载麦克风按钮 |
| `window.QwenPaw.route.add()` + `menu.add()` | 注册 `/qwenpaw-voice` 设置页（菜单显示「语音输入」+ `AudioOutlined` 麦克风图标） |

后端通过 `api.register_http_router(router, prefix="/qwenpaw-voice")` 把 REST +
WebSocket 挂到 `/api/qwenpaw-voice/*`。

自动加载：`src/qwenpaw/app/_app.py` 的 `_BUNDLED_PLUGIN_IDS` 已包含
`"qwenpaw-voice"`，启动时自动同步到运行时插件目录。

## 配置

- 火山凭证：envs store (`volcengine_asr_api_key` / `volcengine_asr_resource_id`)
- UI 配置：`~/.clipaw/client-config.json`（含总开关、快捷键、连接状态）

详细设计见 [`docs/customs/voice-transcription.md`](../../../docs/customs/voice-transcription.md)。
