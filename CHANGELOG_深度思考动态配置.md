# 对话框动态配置思考深度 — 功能实现说明

> 生成时间：2026-05-27  
> 涉及 commit 范围：本会话所有改动

---

## 一、功能概述

在聊天输入框左侧新增一个闪电图标按钮（⚡），用户可以**一键切换大模型的思考深度**（关闭 / 高 / 最大），无需进入模型设置页面。

### 三个层级

| 层级 | 值 | 描述 | 图标状态 |
|------|-----|------|---------|
| 关闭 | `close` | 禁用思考，常规生成（部分模型仍可能默认开启） | 灰色 `#999` 空心 |
| 高 | `high` | 较高的推理努力 | 黄色 `#faad14` 空心 |
| 最大 | `max` | 最大推理努力 | 橙色 `#fa8c16` 实心 |

### 数据流

```
前端 Dropdown 点击
  → PUT /models/active { thinking_level }
  → 后端持久化到 agent 配置 / active_model.json
  → 下次请求时 provider.build_thinking_params() 注入 generate_kwargs
  → 实际 API 调用携带 extra_body.thinking 等参数
```

---

## 二、Multi-Provider 兼容架构

### 设计目标

不同大模型提供商的思考（thinking/reasoning）API 各不相同，需要统一的抽象层：

| Provider | 开启 thinking | 关闭 thinking | 努力度控制 |
|----------|-------------|-------------|-----------|
| DeepSeek | `extra_body: {"thinking": {"type": "enabled"}}` + `reasoning_effort` | `extra_body: {"thinking": {"type": "disabled"}}` | `"high"` / `"max"` |
| MiMo (小米) | `extra_body: {"thinking": {"type": "enabled"}}` | `extra_body: {"thinking": {"type": "disabled"}}` | 不支持 |
| 其他 OpenAI 兼容 | `extra_body: {"thinking": {"type": "enabled"}}` | 不发送任何参数（安全） | 不支持 |

### 核心抽象

所有 Provider 共用以下能力声明：

```python
class Provider(ProviderInfo, ABC):
    thinking_level: str = "close"
```

每个 Provider 子类重写 `build_thinking_params()` 决定如何将 `close/high/max` 映射为具体 API 参数。

### `OpenAIProvider` 的扩展

```python
# 支持 reasoning_effort 区分的 provider（base_url 关键词匹配）
_EFFORT_PROVIDERS: set[str] = {"deepseek"}

# 支持显式 thinking 开关控制的 provider（close 时发送 disabled）
_THINKING_CONTROL_PROVIDERS: set[str] = {"deepseek", "mimo", "xiaomi"}
```

接入新模型只需在对应集合中加入 base_url 关键词即可。

---

## 三、改动文件清单

### 后端（8 个文件）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/qwenpaw/config/config.py` | 修改 | `ModelSlotConfig` 增加 `thinking_level: str = "close"` |
| `src/qwenpaw/app/routers/providers.py` | 修改 | `ModelSlotRequest` 增加 `thinking_level` 字段；`set_active_model` 路由传递该值；加日志 |
| `src/qwenpaw/providers/provider_manager.py` | 修改 | `activate_model()` 新增 `thinking_level` 参数；`get_active_chat_model()` 注入 thinking_level；加日志 |
| `src/qwenpaw/providers/provider.py` | 修改 | Provider 基类增加 `thinking_level` 属性和 `build_thinking_params()` 方法 |
| `src/qwenpaw/providers/openai_provider.py` | 修改 | 新增 `_EFFORT_PROVIDERS` / `_THINKING_CONTROL_PROVIDERS` 白名单；重写 `build_thinking_params()`；`get_chat_model_instance()` 注入参数；加调试日志 |
| `src/qwenpaw/agents/model_factory.py` | 修改 | agent 作用域加载模型时注入 thinking_level；加日志 |

### 前端（7 个文件）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `console/src/api/types/provider.ts` | 修改 | `ModelSlotConfig` / `ModelSlotRequest` 增加 `thinking_level?: "close"\|"high"\|"max"` |
| `console/src/pages/Chat/components/ThinkingLevelSelector/index.tsx` | **新建** | 闪电图标 Dropdown 三档切换组件 |
| `console/src/pages/Chat/index.tsx` | 修改 | 嵌入 ThinkingLevelSelector 到输入框 prefix 区域 |
| `console/src/pages/Chat/ModelSelector/index.tsx` | 修改 | 修复：右上角切换模型时保留当前 thinking_level |
| `console/src/locales/zh.json` | 修改 | 增加 4 条 thinking 相关翻译 |
| `console/src/locales/en.json` | 修改 | 同上 |
| `console/src/locales/ja.json` | 修改 | 同上 |
| `console/src/locales/ru.json` | 修改 | 同上 |

### 构建配置（1 个文件）

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `Makefile` | 修改 | `build-console` 增加自动同步到 `.venv` 安装包目录 |

---

## 四、调试日志

所有日志统一前缀 `[thinking]`，可通过以下方式查看：

```bash
# 实时跟踪
tail -f logs/app.log | grep "\[thinking\]"

# 或 grep 已产生的日志
grep "\[thinking\]" logs/app.log
```

### 日志点

| 位置 | 触发时机 | 输出内容示例 |
|------|---------|------------|
| `routers/providers.py` | PUT /models/active | `[thinking] set_active_model agent=agent-001 provider=mimo model=mimo-v2.5-pro thinking_level=high — scheduling hot reload` |
| `provider_manager.py` | 加载全局模型 | `[thinking] global model loaded: provider=mimo model=mimo-v2.5-pro thinking_level=high` |
| `model_factory.py` | 加载 agent 模型 | `[thinking] agent-scoped model loaded: provider=mimo model=mimo-v2.5-pro thinking_level=high` |
| `openai_provider.py` | 构建请求参数 | `[thinking] provider=mimo model=mimo-v2.5-pro thinking_level=high supports_effort=False extra_body={'thinking': {'type': 'enabled'}} reasoning_effort=None` |

---

## 五、持久化行为

### 存储路径

- **Agent 级别**：`<agent_workspace>/agent.json` → `active_model.thinking_level`
- **全局级别**：`$AGENTSCOPE_HOME/providers/active_model.json` → `thinking_level`

### 加载流程

1. 用户打开页面 → `ThinkingLevelSelector` 挂载
2. 调用 `GET /models/active?scope=effective&agent_id=xxx`
3. 后端返回包含 `thinking_level` 的 `ActiveModelsInfo`
4. 组件展示对应图标颜色状态
5. 切换 Agent → `selectedAgent` 变化 → 重新拉取该 Agent 的设置

每次重启后端后，前端重新拉取时自动恢复上次的设置。

---

## 六、已知问题 & 边界情况

1. **MiMo 关闭思考不生效（已修复）**  
   之前在 `close` 时对所有 provider 发送 `extra_body: disabled`，但 MiMo API 可能不响应。现已通过 `_THINKING_CONTROL_PROVIDERS` 白名单控制——只有 Known provider 才发 disable 指令，其余 provider 在 `close` 时完全不发 thinking 参数。

2. **切换模型后思考深度丢失（已修复）**  
   `ModelSelector` 之前调用 `setActiveLlm` 时没传 `thinking_level`，导致后端默认填充 `close`。现已保留当前思考深度随模型切换一起发送。

3. **Agent 级别的 thinking_level 切换模型时需注意 scope**  
   如果用户通过 Settings 页面的全局模型设置切换模型（`scope: "global"`），那部分代码暂未传递 `thinking_level`。Chat 页面右上角的模型选择器已修复。

---

## 七、未来接入新模型

### 仅有 thinking 开关（无 effort 区分）

```python
# 在 openai_provider.py 的 _THINKING_CONTROL_PROVIDERS 添加 base_url 关键词
_THINKING_CONTROL_PROVIDERS: set[str] = {
    "deepseek", "mimo", "xiaomi", "wenxin",  # ← 添加新关键词
}
```

### 同时支持 thinking 和 effort 等级

```python
# 在 openai_provider.py 的 _EFFORT_PROVIDERS 添加 base_url 关键词
_EFFORT_PROVIDERS: set[str] = {
    "deepseek", "qwq-plus",  # ← 具有区别 high/max 能力的模型
}
```

### 完全自定义的 Provider

重写 `build_thinking_params()` 方法，完全自定义参数映射：

```python
class MyCustomProvider(OpenAIProvider):
    def build_thinking_params(self) -> dict:
        if self.thinking_level == "close":
            return {}  # 不发送任何参数
        return {
            "my_custom_thinking_param": self.thinking_level,
            "extra_body": {"thinking": {"type": "enabled"}},
        }
```

---

## 八、回滚指引

如需回滚所有改动：

```bash
cd /Users/chenzhengcai/coding/clipaw

# 查看改动的文件列表
git diff --name-only HEAD

# 回滚全部
git checkout -- .

# 重新构建前端
make build-console
```
