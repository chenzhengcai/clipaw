# 切换 Agent 导致对话丢失 — Bug 分析

> 状态：已定位根因，待修复
> 影响面：所有在 agent 生成回复过程中切换 agent 的用户
> 严重度：致命（用户视角 = 消息丢失 + 会话消失）

---

## 一、现象

用户在 A agent 的会话中发送消息，等待回复过程中：

1. 切换到 B agent
2. 在 B 中新建会话
3. 切回 A agent

**结果**：A 的会话变成空白，用户刚发送的消息不见了，聊天记录里也没有。

---

## 二、结论先行

**消息没有真正丢失，但"看起来丢了"——而且存在一个真实的数据丢失窗口。**

后端设计上"断连继续跑"：`task_tracker.py` 里每个 run 是独立的 asyncio task，HTTP 断开不会取消它。但**用户消息只在生成结束后才落库**（`SessionSaveHook` 挂在 `POST_RESPONSE` 阶段）。生成中途，消息的唯一副本是前端 `sessionStorage` 里的 `qwenpaw_pending_user_msg_*` 补丁缓存。

A→B→新建→回 A 这条链路，正好把"恢复"和"补丁"两条命线全部打断。

---

## 三、逐步还原事故链路

### 3.1 A 发消息，SSE 流式生成中

- `customFetch`（`console/src/pages/Chat/index.tsx:2587`）POST `/console/chat`，同时把消息存进 `sessionStorage` 补丁缓存（`setLastUserMessage`，key = A 的 chat UUID）。
- 后端 `post_console_chat`（`src/qwenpaw/app/routers/console.py:371`）调用 `get_or_create_chat` 建好 chat，run 开始。
- **此刻消息没有落库。**

### 3.2 切到 B —— 三件事同时坏掉

`AgentSelector.handleChange`（`console/src/components/AgentSelector/index.tsx:101`）同步调用 `setSelectedAgent(B)`，触发：

**(a) SDK 整体卸载重挂**

`index.tsx:2518-2573` 的 effect 里 `setRefreshKey(+1)`，而 `<AgentScopeRuntimeWebUI key={refreshKey}>`（`index.tsx:3726`）整个 remount。A 的 SSE fetch 带 `signal: data.signal`（`index.tsx:2763`），SDK 卸载时 abort → **前端流断开**（后端还在跑）。

**(b) sessionApi 清空 A 的全部状态**

`setActiveAgent`（`sessionApi/index.ts:752-779`）清 `sessionList`、`sessionResultCache`、`convertedSessionCache`、in-flight 请求。A 的会话从内存里蒸发。

**(c) 补丁缓存被静默丢弃**

最致命的一刀。pending 缓存存在 `sessionStorage`，但 `sessionApi` 的 epoch 机制让旧 A 时代的 `getSession` 结果全部作废。补丁本身还在 storage 里，但**没有任何代码会在"切回 A"时主动去读它**——它只在 `patchLastUserMessage` 里被读，而那要靠 `getSession` 走到。

### 3.3 在 B 新建会话

`useCreateNewSession`（`console/src/pages/Chat/hooks/useCreateNewSession.ts:15`）→ `sessionApi.createSession`（`sessionApi/index.ts:1628`）造一个本地时间戳 id（`Date.now()-xxx`），`onSessionCreated` 里 `removeLastChatId(B)`（`index.tsx:2499`）。

B 本身没问题——但注意这个本地 id 机制就是后面坑 A 的同一把刀。

### 3.4 切回 A —— 恢复失败的三重门

**(a) 恢复目标可能拿到脏数据**

effect 里 `getLastChatId(A)`（`index.tsx:2551`）恢复 URL。但 `agentStore.setLastChatId`（`agentStore.ts:151-166`）有个反直觉设计：**传入临时 id 会删掉已存的好 id**。如果 A 离开期间有任何临时 id 被误存，A 的真实 chat id 已被抹掉 → 恢复落空，停在 `/chat` 空白页。

**(b) 就算 URL 恢复对，`getChat` 返回空**

后端 `get_chat`（`src/qwenpaw/app/chats/api.py:699`）从 session state 读消息。A 还在生成中 → `state` 里没有这轮 → `messages=[]`。status 是 `running`，前端 `isGenerating` 判 true，会触发 `reconnect`（`index.tsx:3510`）拿 buffer 回放——**但回放里只有 assistant 的输出，没有用户那句话**（它没落库）。

**(c) 补丁机制接不上**

`patchLastUserMessage`（`sessionApi/index.ts:949`）本该把用户消息补进去，但它只在 `fetchAndBuildSession` 里跑，且要求 `loadPendingUserMessage(backendId)` 命中。如果 (a) 里 chat id 已丢，或 SDK remount 后 `currentSessionId` 是 undefined 导致 `getSession` 走了空分支（`sessionApi/index.ts:1471`），补丁永远不会执行。

**用户看到的就是：会话空白，自己刚发的话没了，聊天记录里也没有。**

---

## 四、根因归纳（按致命度排序）

| # | 根因 | 位置 | 性质 |
|---|------|------|------|
| 1 | **用户消息延迟到生成结束才落库**，中途唯一副本是前端 sessionStorage 补丁 | `src/qwenpaw/hooks/session/session_hook.py` POST_RESPONSE | 架构性数据风险 |
| 2 | **agent 切换 = 核弹式清空**：SDK remount 断 SSE + sessionApi 清全部缓存/列表/in-flight | `console/src/pages/Chat/index.tsx:2570` + `console/src/pages/Chat/sessionApi/index.ts:752` | 设计过于粗暴 |
| 3 | **`setLastChatId(临时id)` 反向删除好 id**，恢复目标被污染 | `console/src/stores/agentStore.ts:155-161` | 逻辑陷阱 |
| 4 | **补丁缓存被动触发**，没有"切回时主动校验未落库消息"的补偿路径 | `console/src/pages/Chat/sessionApi/index.ts:949` | 恢复链路缺口 |
| 5 | 生成中 `getChat` 返回 `messages=[]`，前端无"正在生成但历史为空"的占位态 | `src/qwenpaw/app/chats/api.py:768` | 体验缺陷 |

---

## 五、修复方案（按性价比排序）

### 方案 1：后端立刻落库用户消息【根治，强烈推荐】

**位置**：`src/qwenpaw/app/routers/console.py` 的 `post_console_chat`

**做法**：收到请求、run 开始前就把用户消息写入 conversation history，而不是等 `POST_RESPONSE` 阶段。

**收益**：
- 彻底消除"生成中途消息没落库"的窗口
- 前端 `sessionStorage` 补丁缓存可以整个退役
- 任何时刻刷新/切换/断连，历史都是完整的

**风险**：低。只是落库时机提前，不改数据结构。

### 方案 2：`setLastChatId` 收到临时 id 时忽略而非删除【止血，1 行改动】

**位置**：`console/src/stores/agentStore.ts:155-161`

**现状**：
```typescript
if (isLocalTimestamp(chatId)) {
  // 删掉已存的好 id
  const remainingChatIds = { ...state.lastChatIdByAgent };
  delete remainingChatIds[agentId];
  return { lastChatIdByAgent: remainingChatIds };
}
```

**改为**：
```typescript
if (isLocalTimestamp(chatId)) {
  // 忽略，保护已存的好 id
  return;
}
```

**收益**：防止恢复目标被临时 id 污染。

### 方案 3：agent 切换不卸载 SDK【体验优化，中等改动】

**位置**：`console/src/pages/Chat/index.tsx:2570` + `3726`

**现状**：`setRefreshKey(+1)` 导致 `<AgentScopeRuntimeWebUI key={refreshKey}>` 整个 remount，SSE 断开、内存消息清空。

**改为**：不 remount SDK，只切 session。让 SDK 的 `setCurrentSessionId` 走正常切换流程。

**收益**：保住 SSE 连接和内存消息，切换更顺滑。

**风险**：中。需要验证 SDK 内部状态切换是否干净。

### 方案 4：切回 agent 时主动扫 pending 消息【补偿，小改动】

**位置**：`console/src/pages/Chat/index.tsx` 的 agent 切换 effect

**做法**：切回 A 时，主动扫 `sessionStorage` 里该 agent 的 `qwenpaw_pending_user_msg_*`，发现未确认落库就显示"发送中/待恢复"占位，而不是空白。

**收益**：兜底恢复，用户至少能看到"消息在路上"。

### 方案 5：`getChat` 在 `status=running` 且 `messages` 为空时返回占位【体验优化】

**位置**：`src/qwenpaw/app/chats/api.py:768`

**做法**：后端知道 payload（存在 `_RunState` 里），当 `status=running` 且历史为空时，返回一个 synthetic pending user message。

**收益**：前端无需补丁缓存，历史天然完整。

---

## 六、推荐修复顺序

1. **方案 1**（后端立刻落库）——根治，消除数据丢失窗口
2. **方案 2**（`setLastChatId` 忽略临时 id）——止血，1 行改动
3. **方案 4**（切回时扫 pending）——补偿，提升体验
4. 方案 3 和 5 作为后续优化

---

## 七、关键代码索引

| 文件 | 关键行 | 作用 |
|------|--------|------|
| `src/qwenpaw/app/routers/console.py` | 371-473 | POST /console/chat，run 开始 |
| `src/qwenpaw/app/task_tracker.py` | 253-343 | attach_or_start，run 独立于连接 |
| `src/qwenpaw/hooks/session/session_hook.py` | 79-112 | SessionSaveHook，POST_RESPONSE 落库 |
| `src/qwenpaw/app/chats/api.py` | 699-788 | GET /chats/{id}，读历史 |
| `console/src/pages/Chat/index.tsx` | 2518-2573 | agent 切换 effect |
| `console/src/pages/Chat/index.tsx` | 2587-2781 | customFetch，发消息 |
| `console/src/pages/Chat/index.tsx` | 3510-3543 | reconnect，断线重连 |
| `console/src/pages/Chat/sessionApi/index.ts` | 752-779 | setActiveAgent，清空状态 |
| `console/src/pages/Chat/sessionApi/index.ts` | 949-1012 | patchLastUserMessage，补丁缓存 |
| `console/src/stores/agentStore.ts` | 151-166 | setLastChatId，临时 id 删除好 id |
| `console/src/pages/Chat/hooks/useCreateNewSession.ts` | 15-23 | 新建会话 |
