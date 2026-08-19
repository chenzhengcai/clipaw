# Bugfix：文件附件发送后 AI 看不到附件内容

## 状态

- 确认存在：✅
- 根因类型：后端消息转换逻辑错误（DataBlock media_type 不被 formatter 支持）
- 影响版本：当前代码库（2026-07-22 核查）
- 修复状态：✅ 已修复

---

## 1. 用户问题描述

在 Console 聊天界面中发送带附件的消息时：

1. 上传了文件附件（如 PDF、Word、txt、CSV 等非图片/音频/视频类型文件）
2. 在输入框中输入问题并发送
3. AI 经常回复"没有看到你的附件"、"文件在哪里"等，完全不知道用户上传了文件
4. 图片附件正常工作，只有非媒体类型文件有问题

---

## 2. 现象描述

| 现象 | 说明 |
|------|------|
| 图片附件正常 | 图片（image/*）能被模型正确识别和处理 |
| 文件附件丢失 | 非媒体类型文件（PDF、Word、txt 等）在格式化时被静默丢弃 |
| 无错误提示 | 后端日志仅有 debug 级别的 "Unsupported media type" 警告，用户无感知 |
| AI 询问文件位置 | 模型完全看不到文件信息，只能询问用户文件在哪里 |

---

## 3. 根因分析

### 3.1 完整消息链路

```
前端上传文件
  → POST /console/upload
  → 后端返回 { url: "/absolute/path/to/media/xxx_file.pdf" }

前端发送消息
  → SDK RequestBuilder.buildFileContent(file)
  → 生成 { type: "file", file_url: "http://host/files/preview/xxx_file.pdf", ... }
  → POST 发给后端 console router

后端接收
  → _coerce_content_item 把 dict 转成 FileContent(file_url=..., filename=...)
  → build_agent_request_from_user_content 构建 AgentRequest

后端转换 (根因所在)
  → _request_input_to_msgs() 把 FileContent 转成 AgentScope Msg
  → FileContent 被转成 DataBlock(media_type="application/octet-stream")
  → file_url (HTTP URL) 经 _ensure_url_scheme 不变（非本地路径）

后端格式化 (丢弃发生处)
  → _fixup_media_list 处理 DataBlock：URL 不以 file:// 开头，不做处理
  → OpenAI formatter._format_openai_data_block 检查 media_type
  → "application/octet-stream" 不在 supported_input_media_types 中
  → 返回 None，整个 DataBlock 被丢弃
```

### 3.2 根因：`_request_input_to_msgs` 中 file 类型转换错误

`src/qwenpaw/runtime/message_convert.py` 的 `_request_input_to_msgs()` 函数在处理 `ctype == "file"` 时，将 `FileContent` 转成了：

```python
DataBlock(
    source=URLSource(
        url=url,
        media_type="application/octet-stream",  # ← 问题所在
    ),
    name=getattr(c, "file_name", None),
)
```

`media_type="application/octet-stream"` 不被任何 formatter 的 `supported_input_media_types` 支持：
- OpenAI formatter 只支持 `image/*`、`audio/*`
- Anthropic formatter 只支持 `image/*`、`audio/*`、`video/*`

formatter 在 `_format_openai_data_block` / `_format_anthropic_data_block` 中检查 media_type，不匹配时返回 `None`，整个 DataBlock 被静默丢弃。

### 3.3 对比：图片附件为何正常

图片附件在 `_request_input_to_msgs` 中走 `ctype in _MEDIA_TYPES` 分支，`media_type` 被设为 `image/jpeg`（fallback），formatter 支持 `image/*`，所以图片能正确发送给模型。

### 3.4 `_fixup_media_list` 的 file 分支形同虚设

`src/qwenpaw/agents/model_factory.py` 的 `_fixup_media_list()` 中有一段 `btype == "file"` 的处理逻辑（第 836-868 行），本意是把 file block 转成 `TextBlock`（内容为 `"File 'xxx' is available at: {path}"`）。但由于 `_request_input_to_msgs` 已经提前把 `FileContent` 转成了 `DataBlock`，这个分支**永远不会被触发**。

---

## 4. 改动点

### 4.1 `src/qwenpaw/runtime/message_convert.py`

#### 新增函数：`_file_url_to_local_path()`

从文件附件 URL 中提取本地文件系统路径，支持三种格式：

| 输入格式 | 提取结果 |
|---------|---------|
| `http(s)://host/files/preview/<path>` | `<path>`（去 query/fragment，URL decode） |
| `file:///path/to/file` | `/path/to/file` |
| `/absolute/path` 或 `C:\path` | 原样返回（URL decode） |

不可解析的 URL（如 `https://example.com/download?id=42`）返回 `None`。

#### 修改：`_request_input_to_msgs()` 的 `ctype == "file"` 分支

**修改前**（有问题的代码）：

```python
elif ctype == "file":
    url = getattr(c, "file_url", None) or getattr(c, "url", None)
    if url:
        url = _ensure_url_scheme(str(url))
        try:
            blocks.append(
                DataBlock(
                    source=URLSource(
                        url=url,
                        media_type="application/octet-stream",
                    ),
                    name=getattr(c, "file_name", None),
                ),
            )
        except Exception:
            logger.debug(...)
```

**修改后**：

```python
elif ctype == "file":
    url = getattr(c, "file_url", None) or getattr(c, "url", None)
    if url:
        local_path = _file_url_to_local_path(str(url))
        filename = (
            getattr(c, "file_name", None)
            or getattr(c, "filename", None)
            or (local_path.rsplit("/", 1)[-1]
                if local_path else "file")
        )
        if local_path:
            blocks.append(
                TextBlock(
                    type="text",
                    text=(
                        f"File '{filename}' is available at: "
                        f"{local_path}"
                    ),
                ),
            )
        else:
            blocks.append(
                TextBlock(
                    type="text",
                    text=f"File '{filename}'",
                ),
            )
```

**改动要点**：
- 将 `FileContent` 转成 `TextBlock` 而非 `DataBlock`，避免被 formatter 丢弃
- 使用 `_file_url_to_local_path()` 从 preview URL 中提取本地路径，让模型可通过 `file_io` 工具读取文件
- 同时兼容 `file_name` 和 `filename` 两种字段名（前端发送的是 `file_name`，后端 schema 用的是 `filename`）
- 路径不可解析时仍生成包含文件名的 TextBlock，确保模型至少知道文件存在

### 4.2 `tests/unit/runtime/test_message_convert.py`

新增 4 个测试用例：

| 测试函数 | 覆盖场景 |
|---------|---------|
| `test_file_attachment_preview_url_becomes_text_with_local_path` | HTTP preview URL → TextBlock 含本地路径 |
| `test_file_attachment_absolute_path_becomes_text_with_path` | 绝对路径 → TextBlock 含路径 |
| `test_file_attachment_file_scheme_becomes_text_with_path` | `file://` URL → TextBlock 含路径 |
| `test_file_attachment_unresolvable_url_becodes_text_with_filename_only` | 不可解析 URL → TextBlock 仅含文件名 |

---

## 5. 冲突处理指南

如果合并代码时遇到与本改动相关的冲突，参考以下原则处理：

### 5.1 `_request_input_to_msgs()` 的 `file` 分支冲突

如果有人修改了 `_request_input_to_msgs` 函数（如新增 content type 处理、重构分支结构），确保 `ctype == "file"` 分支**不使用 `DataBlock`**，而是转成 `TextBlock`。关键约束：

- **禁止**将 file 类型转为 `DataBlock(media_type="application/octet-stream")`，这会导致 formatter 丢弃
- **必须**使用 `_file_url_to_local_path()` 解析 URL 为本地路径
- **必须**同时检查 `file_name` 和 `filename` 两个字段

### 5.2 `_file_url_to_local_path()` 函数冲突

如果 `_ensure_url_scheme` 附近有新增函数导致位置冲突，`_file_url_to_local_path` 可以放在 `_ensure_url_scheme` 之后、`_request_input_to_msgs` 之前的任意位置。函数本身不依赖其他新增代码。

### 5.3 `_fixup_media_list()` 的 file 分支

`model_factory.py` 中 `_fixup_media_list` 的 `btype == "file"` 分支（第 836-868 行）在本修复后**仍然是 dead code**（因为 `_request_input_to_msgs` 不再产出 file 类型 block）。不要为了"激活"它而改回 `DataBlock` 转换。如果有人清理了这段 dead code，不需要恢复。

### 5.4 如果上游 SDK 改变了 file content 格式

SDK `RequestBuilder.buildFileContent()` 当前发送 `{ type: "file", file_url: ..., file_name: ... }`。如果 SDK 改为发送 `filename` 而非 `file_name`，修改后的代码已兼容（同时检查两个字段）。如果 SDK 发送了新的字段名（如 `file_id`），需要在 `filename` 变量的 fallback 链中添加。

---

## 6. 验证

```bash
source .venv/bin/activate
python -m pytest tests/unit/runtime/test_message_convert.py -v
```

预期结果：5 个测试全部通过。
