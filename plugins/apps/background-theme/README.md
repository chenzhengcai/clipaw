# Background Theme (背景设置)

QwenPaw Console 插件:用图片或动态视频替换软件背景。

## 功能

- **全局背景**:整个软件底面(侧边栏、头部、内容区)可被一张图片或一段循环播放的视频替换。
- **聊天对话背景**:单独为聊天对话区域设置图片/视频底面,与全局背景独立搭配。
- **背景库(历史管理)**:上传过的背景统一保存;在两个位置中点击即可选择/替换;支持删除。
- **效果调节**:每个位置支持 显示方式(铺满/完整显示/拉伸)、遮罩浓度(保证文字可读)、背景模糊。
- **图片与视频**:支持 jpg / png / gif / webp / avif 图片与 mp4 / webm / mov 视频(≤ 200 MB)。视频自动静音循环播放。

## 安装

```bash
# 从源码目录安装
qwenpaw plugin install /path/to/clipaw/plugins/apps/background-theme
# 或通过 Console -> 设置 -> Plugin Manager 从本地路径安装
```

安装后刷新 Console 页面,左侧「设置」组下会出现「背景设置」菜单。

## 使用

1. 打开 设置 → 背景设置。
2. 在「全局背景」或「聊天对话背景」卡片中点击「上传图片 / 视频」,上传后立即应用到对应位置。
3. 在下方「历史背景」库中点击任意缩略图即可切换;两个位置可使用同一个背景。
4. 调节遮罩/模糊/显示方式,设置实时生效并保存。
5. 「清除背景」恢复默认外观。

## 架构

```
background-theme/
├── plugin.json    # manifest (type: general)
├── plugin.py      # 后端: REST API (挂载在 /api/background-theme)
└── ui/index.js    # 前端: 菜单 + 路由 + 背景运行时 + 设置页
```

### 后端 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/background-theme/config` | 读取两个位置的当前背景配置 |
| PUT | `/api/background-theme/config` | 设置/清除某个位置 (`slot=global|chat`) |
| GET | `/api/background-theme/library` | 列出背景库文件 |
| POST | `/api/background-theme/library` | 上传图片/视频 (multipart `file`) |
| DELETE | `/api/background-theme/library/{name}` | 删除文件(引用它的位置自动清除) |

- 上传文件保存在 `<插件目录>/data/library/`,配置保存在 `<插件目录>/data/config.json`。
- 媒体文件通过公共插件静态路由 `/api/frontend_plugin/background-theme/files/data/library/<name>` 提供,`FileResponse` 原生支持 Range 请求,视频可流式播放。

### 前端

- 通过 `window.QwenPaw.menu.add` 在设置组 (`core.settings-group`) 下注册「背景设置」菜单项(order 95),通过 `window.QwenPaw.route.add` 注册 `/background-settings` 路由。
- **全局背景**:向 `body` 注入一个 `position: fixed; z-index: -1` 的媒体层,并给 `html/body` 加 `qwp-bg-global-on` class,配合注入的 CSS 将 layout/header/sider/page-content 背景置透明。
- **聊天背景**:通过 `MutationObserver` 监听聊天主区域 (CSS module 哈希类 `[class*="__chatMainArea__"]`) 的挂载,插入绝对定位媒体层并给该区域加 `qwp-chat-bg-on` class;注入的 CSS 会把聊天内部的不透明表面(消息列表/输入区/欢迎卡等,含暗色与紫色主题变体)置透明,且仅作用于带媒体层的聊天区域,因此**只设置聊天背景(不设全局背景)也能独立生效**;清除时完全移除,不残留 DOM。
- **「全部聊天」历史面板**:右侧展开的嵌入式面板 (`__embeddedPanel__`) 及其内部表面(标题栏/粘性分组头/上下渐变/会话卡片)在全局背景开启时同样置透明,会话卡片保留 hover/active 半透明反馈(含紫色主题的 active 紫色高亮),背景图片可透过面板完整展示。
- **侧边栏智能体选择器**:顶部粘性容器 (`agentSelectorContainer`) 采用与其他侧栏卡片一致的毛玻璃效果(半透明 + 模糊,滚动内容仍被遮挡),其内部的白色选择卡 (`agentSelectorWrapper`) 置透明融入毛玻璃;选择器下拉弹层保持不透明以保证可读性。
- 配置变更通过 `qwp-bg-config-changed` 自定义事件通知运行时即时重新应用。
