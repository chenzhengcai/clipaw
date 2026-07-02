# Token 消耗折线图圆滑曲线修复

## 问题

Settings → Token 消耗 页面中的两个折线图（Token 类型趋势图、模型趋势图）渲染为**直线段连接**，而非圆滑曲线。

## 根因

`@ant-design/plots` v2.6.8 进行了 API 迁移，旧版顶层属性 `smooth: true` 已**无内部映射**，被静默忽略。

该库的常量映射表 `@ant-design/plots/es/core/constants/index.js` 中只定义了 `shape` → `style.shape` 的映射，没有 `smooth` 的映射项：

```js
// 第 202 行 — 唯一与曲线形状相关的映射
shape: 'style.shape',  // shape: 'smooth' → style: { shape: 'smooth' }
```

正确写法是将曲线形状配置放在 `style` 对象内部：

```ts
// 错误（v1 API，v2 无映射，被忽略）
{ smooth: true }

// 正确（v2 API）
{ style: { shape: "smooth" } }
```

## 修复

### 修改文件

| 文件 | 修改内容 | 所在行 |
|------|---------|--------|
| `console/src/pages/Settings/TokenUsage/hooks/useTokenTypeConfig.ts` | `style` 对象中新增 `shape: "smooth"` | 第 93 行 |
| `console/src/pages/Settings/TokenUsage/hooks/useModelTrendConfig.ts` | `style` 对象中新增 `shape: "smooth"` | 第 79 行 |

### 修改前后对比

```ts
// 修改前
style: {
  lineWidth: 3,
  fillOpacity: 0,
},

// 修改后
style: {
  lineWidth: 3,
  fillOpacity: 0,
  shape: "smooth",  // ← 新增：启用圆滑曲线
},
```

> 注：原有的 `smooth: true` 顶层属性保留未删除，不影响功能也不起作用，仅作为历史标注。

### 影响的图表

| 图表 | 组件 | 数据字段 |
|------|------|---------|
| Token 类型趋势图 | `<TokenTypeChart>` → `<Line>` | `xField: "date"`, `yField: "value"`, `seriesField: "type"` |
| 模型趋势图 | `<ModelTrendChart>` → `<Line>` | `xField: "date"`, `yField: "value"`, `seriesField: "model"` |

### 页面呈现效果

- 折线图从**折线段**变为**贝塞尔圆滑曲线**
- 三条曲线（Prompt Tokens / Completion Tokens / Total Tokens）和模型趋势线均受到影响

## 上游更新冲突分析

| 文件 | 冲突概率 | 说明 |
|------|---------|------|
| `useTokenTypeConfig.ts` | **低** | 新增文件，上游无同名文件 |
| `useModelTrendConfig.ts` | **低** | 新增文件，上游无同名文件 |

> 这两个文件是 qwenmain-czc 分支新增的，不在上游代码中。
