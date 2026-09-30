# Bugfix：语音输入插件快捷键在打包版桌面应用中失效（浏览器正常）

## 状态

- 确认存在：✅（用户报告：浏览器里 Ctrl/Cmd+Shift+M 正常，打包版无效；麦克风按钮点击在两端都正常）
- 根因类型：插件用原始 `window.location.pathname` 判断页面作用域，未剥离桌面版的 `/console` 路由 basename
- 影响版本：qwenpaw-voice 插件 ≤ 1.5.0
- 修复状态：✅ 已修复（1.5.1），已同步至运行时插件目录

---

## 1. 现象

| 环境 | 麦克风按钮 | 快捷键 |
|------|-----------|--------|
| 浏览器（开发模式，`http://localhost:5173/chat/...`） | ✅ | ✅ |
| 打包版桌面应用（后端托管 console，`http://127.0.0.1:<port>/console/chat/...`） | ✅ | ❌ 静默无响应 |

插件开关关闭时回退的官方内置快捷键（ChatPage 自己的 Ctrl/Cmd+Shift+M）在打包版**正常**。

## 2. 根因

`plugins/apps/qwenpaw-voice/frontend/src/index.tsx` 的 `VoiceSenderPrefix` 全局快捷键监听里：

```ts
const isChatScope = () => {
  const p = window.location.pathname;        // ← 原始 pathname，未剥离 basename
  return p.startsWith("/chat") || p.startsWith("/coding");
};
```

两种运行环境的真实 URL：

- 浏览器开发模式：SPA 从根路径服务，pathname = `/chat/xxx` → `startsWith("/chat")` 命中
- 打包版桌面应用：Tauri 启动后 `BackendReadyGate` 将 webview 导航到后端托管的
  `${apiBaseUrl}/console`（见 `console/src/tauri/backendRuntime.ts`），pathname =
  `/console/chat/xxx` → `startsWith("/chat")` **不命中** → `onKeyDown` 直接 return，
  快捷键静默失效

**为什么官方内置快捷键没事**：宿主 ChatPage 的 `isChatActive` 用的是 react-router 的
`location.pathname`（`getRouterBasename` 识别 `/console` 前缀并由 Router 的 basename
机制剥离），所以它拿到的一直是 `/chat/xxx`。插件是独立 bundle，不能 import 宿主
react-router 实例，只能读原始 `window.location.pathname`——差的就在这一步。

**为什么麦克风点击没事**：`onMicClick` 劫持（capture click → `.spark-icon-spark-mic-line`）
不做任何 pathname 判断，所以两端都正常。这也是"插件已挂载、仅快捷键死"的原因——
排除了插件未加载/未连接（`isVoiceConnected`）等其他假设。

## 3. 修复

`isChatScope()` 先剥离 `/console` basename 再判断（与宿主 `getRouterBasename` 的
语义对齐，`(?=\/|$)` 防止误伤 `/consoles` 一类路径）：

```ts
const isChatScope = () => {
  const p = window.location.pathname.replace(/^\/console(?=\/|$)/, "");
  return p.startsWith("/chat") || p.startsWith("/coding");
};
```

## 4. 交付链路（重要）

1. **源码修复**：`plugins/apps/qwenpaw-voice/frontend/src/index.tsx`
2. **版本号 bump**：`plugin.json` 1.5.0 → **1.5.1**。
   `_app.py::_sync_bundled_plugins` 只在 plugin.json 版本号与运行时副本**不一致**时
   才整体替换——不 bump 版本，修复到不了 `~/.qwenpaw/plugins/`。
3. **前端重构建**：`cd plugins/apps/qwenpaw-voice/frontend && npm run build`
   （产物 `frontend/dist/index.js`，宿主经 `entry.frontend` blob-import 加载）。
4. **运行时同步**：打包版桌面应用**不内嵌插件**（qwenpaw.spec 的 datas 不收集
   plugins/apps；`_bundled_plugins_root()` 在打包环境中返回 None），它和开发版
   共用 `~/.qwenpaw/plugins/qwenpaw-voice`。已手动同步（等价 `_sync_bundled_plugins`
   的 copytree 语义，排除 node_modules/__pycache__ 等）。

## 5. 验证

- 正则单测 6/6：`/console/chat/abc → /chat/abc`、`/console → ""`、
  `/consoles/chat → /consoles/chat`（不误伤）等
- `tsc --noEmit` 通过；`vite build` 产物 35.79 kB，minified 源码中确认包含
  `window.location.pathname.replace(/^\/console(?=\/|$)/, "")`
- `~/.qwenpaw/plugins/qwenpaw-voice/plugin.json` 已为 1.5.1，dist 产物含修复
- **待用户实测**：完全退出打包版（含托盘/后台 backend），重新启动，在聊天页按
  Ctrl/Cmd+Shift+M 应触发录音、再按停止（hold 模式：按住说话松开停）

## 6. 合并冲突处理

本修复全部位于 fork 专属插件目录 `plugins/apps/qwenpaw-voice/`，上游不跟踪该目录，
**零合并冲突**。