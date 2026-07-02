# Tauri 桌面端打包修改

## 概述

本文档记录对 Tauri 桌面端打包流程的三项修改：**macOS 麦克风权限修复**、**PyInstaller 构建脚本修复**、**GitHub Actions 发布流程精简**。

---

## 一、macOS 麦克风权限修复

### 问题

打包后的 macOS `.app` 无法访问麦克风。系统不会弹出权限授权对话框，WebView 中的 `getUserMedia()` 静默失败。

### 根因

macOS Hardened Runtime 要求 app 必须声明 **entitlement**（`com.apple.security.device.audio-input`）才能访问音频输入设备，同时需要 **Info.plist** 中的 `NSMicrophoneUsageDescription` 提供授权对话框的说明文字。

当前分支缺少以下三个配置（与 `purper-theme` 分支对比后确认被删除或移除）：

### 修改文件

#### 1. `console/src-tauri/entitlements.plist`（新增）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
</dict>
</plist>
```

- **作用**：授予 app **硬件级别的麦克风访问权限**（Hardened Runtime 强制要求）
- **无此文件时**：macOS 安全机制直接拒绝音频输入，不会触发任何提示

#### 2. `console/src-tauri/Info.plist`（新增）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSMicrophoneUsageDescription</key>
    <string>QwenPaw needs microphone access for voice input.</string>
</dict>
</plist>
```

- **作用**：定义系统弹出的权限对话框中的**说明文字**
- **无此文件时**：如果有 entitlement 但无描述，macOS 可能在 Console 中显示错误日志

#### 3. `console/src-tauri/tauri.conf.json`（修改）

在 `bundle` 对象中新增 `macOS` 配置块，引用上述两个 plist：

```json
"bundle": {
  "active": true,
  "targets": ["app", "nsis"],
  "macOS": {
    "infoPlist": "Info.plist",
    "entitlements": "entitlements.plist"
  },
  // ...
}
```

- **作用**：告诉 Tauri 打包时将这两个 plist 嵌入 `.app`

### 三者关系

```
Info.plist                        entitlements.plist
  │                                   │
  │ NSMicrophoneUsageDescription      │ com.apple.security.device.audio-input = true
  │ "为什么要麦克风"                    │ "允许用麦克风"
  │                                   │
  └──────────────┬────────────────────┘
                 │
         tauri.conf.json
         macOS.infoPlist + macOS.entitlements
                 │
                 ▼
          QwenPaw Desktop.app
```

> 缺一不可：缺 entitlement → 硬件拒绝；缺 Info.plist → 无授权提示文案。

---

## 二、PyInstaller 构建脚本修复

### 问题

执行 `scripts/pack-tauri/build_pyinstaller.sh` 时，在"Copying to Tauri binaries directory"步骤失败：

```
find: fts_read: No such file or directory
```

脚本使用 `set -e`，该错误导致整个构建流程中断，PyInstaller 虽然成功生成了产物（`dist/pyinstaller/qwenpaw-backend/`），但复制到 Tauri binaries 目录失败。

### 根因

脚本第 133 行原有的清理逻辑：

```bash
mkdir -p "${DEST}"
find "${DEST}" -mindepth 1 -exec rm -rf {} +
```

`find ... -exec rm -rf` 组合在目录中存在**破碎符号链接**或文件被并发删除时，`fts_read` 系统调用会失败。这在之前的构建残留目录中容易出现。

### 修复

将 `find` + `rm` 两步替换为一步 `rm -rf` + `mkdir -p`：

```bash
# 修复前
mkdir -p "${DEST}"
find "${DEST}" -mindepth 1 -exec rm -rf {} +

# 修复后
rm -rf "${DEST}"
mkdir -p "${DEST}"
```

`rm -rf` 不会遍历不存在的符号链接，因此不会有 `fts_read` 报错。

### 修改文件

| 文件 | 改动 | 行号 |
|------|------|------|
| `scripts/pack-tauri/build_pyinstaller.sh` | `find ... -exec rm -rf` → `rm -rf` | 第 131-133 行 |

---

## 三、GitHub Actions 发布流程精简

### 问题

旧的 `desktop-release.yml` 存在以下问题：

1. **构建了不需要的包**：包含 `build-windows` 和 `build-macos` 两个 legacy conda-pack 构建 job
2. **上传延迟**：所有 4 个 job（legacy win/mac + tauri win/mac）必须全部完成，再由 `upload-release` 聚合 job 统一上传到 GitHub Release
3. **逻辑冗余**：包含 OSS 上传逻辑（上传到阿里云 OSS）

### 修改

参照 `purper-theme` 分支的方案，完全重写 workflow：

| 维度 | 旧 | 新 |
|------|-----|-----|
| 构建 job | 4 个（legacy × 2 + tauri × 2） | 2 个（仅 tauri × 2） |
| 上传时机 | 聚合等待所有 job 完成 | **每个 job 构建完立即上传** |
| 上传方式 | `upload-artifact` → `download-artifact` → `softprops` | 直接在 job 内 `softprops/action-gh-release@v1` |
| OSS 上传 | 有 `upload-oss` job | 无 |
| 手动触发参数 | `upload_to_oss` (boolean) | `release_tag` (string) |
| permissions | `contents: read` | `contents: write` |

### 核心设计：逐平台独立上传

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHub Release                               │
│                                                                     │
│   ┌─────────────────────┐      ┌─────────────────────┐             │
│   │ build-tauri-windows  │      │  build-tauri-macos   │             │
│   │                     │      │                      │             │
│   │ 1. Build            │      │ 1. Build             │             │
│   │ 2. Stage installer  │      │ 2. Create ZIP        │             │
│   │ 3. Upload ──────────┼──▶   │ 3. Upload ───────────┼──▶          │
│   │    (立即)            │      │    (立即)             │             │
│   └─────────────────────┘      └─────────────────────┘             │
│                                                                     │
│   Windows 构建完成 30min → 立即上传 .exe                             │
│   macOS 构建完成 45min → 立即上传 .zip                               │
│   互不等待                                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键代码

每个 Tauri job 末尾的 upload step：

```yaml
- name: Upload to GitHub Release
  if: steps.tag.outputs.tag != ''
  uses: softprops/action-gh-release@v1
  with:
    tag_name: ${{ steps.tag.outputs.tag }}
    files: dist/QwenPaw-*-macOS.zip  # macOS 产物
```

- `if: steps.tag.outputs.tag != ''`：有 tag 时才上传（release 触发或手动指定 `release_tag`）
- `softprops/action-gh-release@v1`：直接上传到已有 Release，不等待其他 job
- 产物命名：`dist/QwenPaw-Setup-{version}.exe` / `dist/QwenPaw-*-macOS.zip`

### 触发方式

```yaml
on:
  release:
    types: [published]     # GitHub Release 发布时自动触发
  workflow_dispatch:
    inputs:
      release_tag:         # 手动触发时指定已有 Release 的 tag
        description: 'Upload to an existing GitHub Release (tag name, e.g. v1.1.9b1)'
        required: false
        type: string
```

### 修改文件

| 文件 | 改动 | 
|------|------|
| `.github/workflows/desktop-release.yml` | 完全重写，从 612 行精简到 169 行 |

---

## 四、上游更新冲突分析

| 文件 | 冲突概率 | 说明 |
|------|---------|------|
| `entitlements.plist` | **无** | 新增文件，上游不存在 |
| `Info.plist` | **无** | 新增文件，上游不存在 |
| `tauri.conf.json` macOS 配置 | **低** | 上游可能新增 macOS 配置块；合并时保留我们的 `infoPlist` + `entitlements` 引用 |
| `build_pyinstaller.sh` | **低** | 上游不会修改此分支独有的构建脚本 |
| `desktop-release.yml` | **中** | 上游可能重构 CI；合并策略：保留 Tauri-only + per-platform upload 设计 |

---

## 五、构建命令速查

```bash
# macOS 完整打包（包含 PyInstaller + Tauri 捆绑）
bash scripts/pack-tauri/build_macos_pyinstaller.sh

# 单独 PyInstaller 打包（已修复 find 问题）
bash scripts/pack-tauri/build_pyinstaller.sh

# 单独 Tauri 构建（需要先确保 binaries 目录有后端产物）
cd console && npm exec -- tauri build --bundles app
```

产物路径：
- `.app` → `console/src-tauri/target/release/bundle/macos/QwenPaw Desktop.app`
- `.zip` → `dist/QwenPaw-Tauri-{version}-macOS.zip`
