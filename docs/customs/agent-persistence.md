# Agent 选择持久化 — 跨重启记住上次使用的 Agent

## 问题

用户在下拉菜单中选择了某个 Agent（如 `xiaomi`），退出软件（关闭浏览器或关闭 Tauri 桌面端）后重新打开，选择器总是回到 `default`，需要每次都重新选择。

## 方案

三层持久化链路，确保 Agent 选择在所有场景下都能恢复：

```
setSelectedAgent("xiaomi")
  │
  ├─ ① localStorage.setItem("qwenpaw-last-used-agent", "xiaomi")
  │     └─ 同源浏览器 Tab 之间继承（即时生效）
  │
  ├─ ② clientConfig.saveClientConfig("qwenpaw-last-used-agent", "xiaomi")
  │     └─ PUT /workspace/client-config → 后端 client-config.json
  │     └─ 解决 Tauri 端口变化导致 localStorage 丢失
  │
  └─ ③ agentApi.setActiveAgent("xiaomi")
        └─ PUT /agents/active → config.json.active_agent
        └─ 后端侧持久化，供其他模块读取当前活跃 Agent
```

重启恢复流程（`loadClientConfig()` 在 `App.tsx` 初始化时调用）：

```
App.tsx mount
  → loadClientConfig()
    → GET /workspace/client-config
      → 读取 client-config.json 中的 "qwenpaw-last-used-agent"
        → useAgentStore.getState().setSelectedAgent(agentId)
          → AgentSelector 组件重新渲染，选中对应 Agent
```

## 修改文件

### 1. 后端 — `src/qwenpaw/app/routers/agents.py`

新增 `PUT /agents/active` 端点，第 238-268 行：

```python
@router.put("/active", summary="Set the active agent")
async def set_active_agent(
    body: dict = Body(..., examples=[{"agent_id": "xiaomi"}]),
) -> dict:
    agent_id = str(body.get("agent_id", "")).strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    config = load_config()
    if agent_id not in config.agents.profiles and agent_id != "default":
        raise HTTPException(status_code=400, detail=f"Agent '{agent_id}' not found")
    config.agents.active_agent = agent_id
    save_config(config)
    return {"active_agent": agent_id}
```

> **关键设计**：此路由必须声明在通用 `PUT /{agentId}` **之前**，否则 FastAPI 会将 `/active` 匹配到 `{agentId}` 参数路由，把 `"active"` 当成 agent ID 处理导致 422 错误。

### 2. 前端 API — `console/src/api/modules/agent.ts`

在 `agentApi` 对象末尾新增 `setActiveAgent` 方法：

```typescript
setActiveAgent: (agentId: string) =>
  request<{ active_agent: string }>("/agents/active", {
    method: "PUT",
    body: JSON.stringify({ agent_id: agentId }),
  }),
```

### 3. Agent Store — `console/src/stores/agentStore.ts`

在 `setSelectedAgent` 函数末尾新增两个异步持久化调用：

```typescript
// Persist to backend config.json so it survives restarts
import("../api/clientConfig").then((m) =>
  m.saveClientConfig(LAST_USED_AGENT_KEY, agentId),
).catch(() => {});
import("../api/modules/agent").then(({ agentApi }) =>
  agentApi.setActiveAgent(agentId),
).catch(() => {});
```

> **注意**：使用动态 `import()` 而非顶层静态 `import`，避免 Zustand store 初始化时产生循环依赖（`agentStore` → `clientConfig` → `agentStore`）。

### 4. Chat/index.tsx — Agent 切换时保存/恢复 lastChatId

Agent 切换时使用 `useAgentStore` 的 `setLastChatId` / `getLastChatId` 保存和恢复每个 Agent 最后使用的会话：

```typescript
// 离开旧 Agent 时保存当前 chatId
if (candidateChatId && prevAgent) {
  setLastChatId(prevAgent, candidateChatId);
}

// 切换到新 Agent 时恢复上次的 chatId（跳过纯数字 draft timestamp）
const restored = getLastChatId(selectedAgent);
const restoredIsDraftId = typeof restored === "string" && /^\d+$/.test(restored);
if (restored && !restoredIsDraftId) {
  navigateRef.current(buildSessionPath("chat", restored), { replace: true });
}
```

> **2026-06-20 简化**：Chat/index.tsx 中 `clearLastChatId` 草稿检查逻辑已移除，`hasPendingDraft` 兼容层也已清理。qwenmain 重构了 sessionApi（`leadingUnresolved` 模式），隐式管理草稿生命周期，不再需要显式的 pendingDraft 检查。注意 `clearLastChatId` 方法本身仍在 `agentStore.ts` 中保留，仅作为未使用的 store API 表面。

## 已有基础设施（本分支已存在，无需修改）

| 文件 | 职责 |
|------|------|
| `console/src/api/clientConfig.ts` | `saveClientConfig(key, value)` — 写入 `client-config.json`；`loadClientConfig()` — 应用启动时从后端恢复配置到 localStorage + agent store |
| `console/src/App.tsx:187` | `import("./api/clientConfig").then(m => m.loadClientConfig())` — 应用初始化时触发配置恢复 |

## 关键数据结构

**`client-config.json`（后端文件，跨重启持久化）：**
```json
{
  "qwenpaw-last-used-agent": "xiaomi",
  "voice_connected": "...",
  "qwenpaw_voice_shortcut": "...",
  "qwenpaw_voice_shortcut_mode": "..."
}
```

**`config.json`（后端主配置，`active_agent` 字段）：**
```json
{
  "agents": {
    "active_agent": "xiaomi",
    "profiles": { ... }
  }
}
```

## 为什么需要三个持久化层

| 层级 | 存储位置 | 失效场景 | 作用 |
|------|---------|---------|------|
| `localStorage` | 浏览器 | Tauri 端口变化、清除浏览器数据 | 浏览器同源 Tab 即时共享 |
| `client-config.json` | 后端文件系统 | 无（除非手动删除） | **Tauri 跨端口/跨重启**主方案 |
| `config.json.active_agent` | 后端配置文件 | 无（除非手动删除） | 后端需要知道活跃 Agent 时读取 |

> Tauri 桌面端每次启动后端进程使用随机端口，`localStorage` 基于 origin，端口变化后数据丢失。`client-config.json` 存储在文件系统，不受端口影响。

## 上游更新冲突分析

| 文件 | 冲突概率 | 原因 | 合并策略 |
|------|---------|------|---------|
| `agents.py` | **低** | 上游可能在这个位置插入其他端点 | 确认 `PUT /active` 在 `PUT /{agentId}` 之前 |
| `agent.ts`（前端 API）| **低** | 上游可能新增 API 方法 | 保留 `setActiveAgent` 在末尾 |
| `agentStore.ts` | **低** | 上游可能修改 `setSelectedAgent` 函数体 | 保留两行 `import()` 调用在函数末尾 |
| `Chat/index.tsx` agent 切换 | **低** | qwenmain 重构了 sessionApi，但 agent 切换的 `setLastChatId`/`getLastChatId` 逻辑与上游互补 | 保留我们的 `restoredIsDraftId` 过滤 + 上游的 `setChatLoading(true)` 队列保护 |

## 变更历史

| 日期 | 变更内容 |
|------|---------|
| 2026-06-19 | 初始实现：三层持久化链路 + agent 切换时保存/恢复 lastChatId |
| 2026-06-19 | 合并 qwenmain 上游修复（队列 agent ID 绑定、session 删除后导航）— 无冲突 |
| 2026-06-20 | 合并 qwenmain agentscope 2.0 大规模更新 — Chat/index.tsx 3 处冲突已解决 |
| 2026-06-20 | **简化**：移除 Chat/index.tsx 中的 `clearLastChatId` 草稿检查及 pendingDraft 兼容层，对齐 qwenmain 重构后的 sessionApi（`leadingUnresolved` 模式）；`clearLastChatId` store 方法仍保留但未使用 |
