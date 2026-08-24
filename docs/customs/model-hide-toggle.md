# 模型隐藏/显示切换

> 在模型管理列表为所有模型(含内置)新增眼睛图标按钮,支持隐藏/显示切换。隐藏后的模型在聊天页选模型时不展示、不可选。

| 属性 | 值 |
|------|-----|
| 创建日期 | 2026-08-24 |
| 触发需求 | 内置模型过时占位,用户希望隐藏或删除 |
| 上游状态 | 上游已有 `setModelVisibility` API 和 `hidden_model_ids` 持久化,但前端未对内置模型暴露隐藏入口 |
| 冲突风险 | 中 — 改动集中在 `RemoteModelManageModal.tsx` 和 `modelSelectorModels.ts`,上游若改这两个文件需逐行核对 |

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `console/src/pages/Settings/Models/components/modals/RemoteModelManageModal.tsx` | 修改 | 加眼睛图标按钮 + 隐藏视觉标记 + 处理函数 |
| `console/src/pages/Chat/ModelSelector/modelSelectorModels.ts` | 修改 | `buildEligibleProviders` 过滤 hidden 模型 |
| `console/src/locales/zh.json` | 修改 | 加 3 个国际化 key |
| `console/src/locales/en.json` | 修改 | 加 3 个国际化 key |

## 后端能力(已具备,无需改动)

| 能力 | 位置 | 说明 |
|------|------|------|
| visibility API | `PUT /{provider_id}/models/{model_id}/visibility` | `providers.py:632-650` |
| 持久化 | `provider_manager_persistence.py:1136` | `_restore_builtin_provider` 恢复 `hidden_model_ids` |
| 列表过滤 | `provider.py:727-733` | `discovery_candidates()` 已过滤 hidden |
| configured_models 过滤 | `provider.py:698-713` | `configured_models()` 只过滤 `removed_model_ids`,不过滤 `hidden_model_ids` |

> ⚠️ 注意:`configured_models()` 只过滤 removed 不过滤 hidden。本次改动在**前端** `buildEligibleProviders` 补了 hidden 过滤,确保聊天页不展示。后端 `configured_models` 的 hidden 过滤可作为后续加固项。

## 前端改动详情

### RemoteModelManageModal.tsx

#### 1. import 新增图标
```diff
  Database,
+ Eye,
+ EyeOff,
  FlaskConical,
```

#### 2. 新增处理函数(267 行后)
```typescript
const handleToggleModelVisibility = async (
  modelId: string,
  modelName: string,
  hidden: boolean,
) => {
  try {
    await api.setModelVisibility(provider.id, modelId, hidden);
    message.success(
      t(hidden ? "models.modelHidden" : "models.modelVisible", {
        name: modelName,
        defaultValue: hidden ? `已隐藏模型 {{name}}` : `已显示模型 {{name}}`,
      }),
    );
    await onSaved();
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : t("models.visibilityFailed");
    message.error(errMsg);
  }
};
```

#### 3. 模型列表项渲染(675 行起)
```diff
+ const isHidden = (provider.hidden_model_ids ?? []).includes(m.id);
+ const hiddenTextStyle = isHidden
+   ? { opacity: 0.45, fontStyle: "italic" as const }
+   : undefined;

  <span className={styles.modelListItemName} style={hiddenTextStyle}>{m.name}</span>
  <span className={styles.modelListItemId} style={hiddenTextStyle}>{m.id}</span>
```

#### 4. "已隐藏"标签(Tag 区域后)
```jsx
{isHidden && (
  <Tag style={{
    fontSize: 11, marginRight: 4,
    color: isDark ? "rgba(255,255,255,0.45)" : "#999",
    background: "transparent",
    border: isDark ? "1px solid rgba(255,255,255,0.15)" : "1px solid #d9d9d9",
  }}>
    <EyeOff size={14} style={{ marginRight: 4, verticalAlign: "-3px" }} />
    {t("models.hidden", "已隐藏")}
  </Tag>
)}
```

#### 5. 眼睛图标按钮(删除按钮前,所有模型都显示)
```jsx
<Tooltip title={t(isHidden ? "models.restoreModel" : "models.hideModel")}>
  <Button
    type="text" size="small"
    className={styles.modelListActionButton}
    aria-label={t(isHidden ? "models.restoreModel" : "models.hideModel")}
    icon={isHidden ? <EyeOff size={18} /> : <Eye size={18} />}
    onClick={() => handleToggleModelVisibility(m.id, m.name, !isHidden)}
    style={isHidden ? { opacity: 0.45 } : darkBtnStyle}
  />
</Tooltip>
```

### modelSelectorModels.ts

`buildEligibleProviders` 过滤 hidden 模型:
```diff
  .map((provider) => {
+   const hidden = new Set(provider.hidden_model_ids ?? []);
    return {
      id: provider.id,
      name: provider.name,
-     models: [...(provider.models ?? []), ...(provider.extra_models ?? [])],
+     models: [...(provider.models ?? []), ...(provider.extra_models ?? [])]
+       .filter((model) => !hidden.has(model.id)),
      is_free_tier: provider.is_free_tier,
      ...
    };
- });
+   };
+ });
```

## 国际化 key

| key | 中文 | English |
|-----|------|---------|
| `models.hideModel` | 隐藏模型 | Hide model |
| `models.restoreModel` | 恢复模型 | Restore model |
| `models.visibilityFailed` | 更新模型可见性失败 | Failed to update model visibility |
| `models.modelHidden` ✨ | 已隐藏模型 {{name}} | Hidden model {{name}} |
| `models.modelVisible` ✨ | 已显示模型 {{name}} | Restored model {{name}} |
| `models.hidden` ✨ | 已隐藏 | Hidden |

> ✨ = 本次新增;其余已存在于上游。

## 用户操作流程

```
Settings → Models → 选 Provider → 管理模型
  ↓
每个模型行右侧显示 👁️ 眼睛图标
  ↓
点击 👁️ → 调 visibility API → 模型变灰+斜体+"已隐藏"Tag
  ↓
聊天页 ModelSelector → buildEligibleProviders 过滤 → 该模型不展示、不可选
  ↓
想恢复 → 模型管理页点 👁️‍🗨️ → 恢复正常 → 聊天页可选
```

## 上游合并策略

1. **RemoteModelManageModal.tsx**:上游若改此文件,逐行核对 5 个改动点(import/处理函数/isHidden/Tag/按钮),手动合并
2. **modelSelectorModels.ts**:上游若改 `buildEligibleProviders`,保留 hidden 过滤逻辑
3. **国际化文件**:上游若加新 key 到 models 命名空间,确认不与 `modelHidden`/`modelVisible`/`hidden` 冲突

## 已知限制

- 隐藏状态仅控制 UI 展示,后端 `configured_models()` 仍返回 hidden 模型(只过滤 removed)。若未来有后端消费 `configured_models` 的场景,需在后端也加 hidden 过滤
- 隐藏操作无确认弹窗(与删除不同),误触可立即恢复
