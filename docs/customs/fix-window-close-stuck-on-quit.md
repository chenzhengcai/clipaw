# 修复 Windows 打包后点击"退出应用"窗口卡住无法关闭

## 问题场景

**平台**：Windows 打包版（Tauri 桌面应用）

**复现步骤**：

1. 运行打包后的 QwenPaw Desktop
2. 点击窗口关闭按钮（X / Alt+F4）
3. 弹出对话框，提示选择"最小化到托盘"或"退出应用"
4. 点击"退出应用"
5. 页面进入 loading 状态（Spin 转圈），窗口无法关闭，持续卡死

**预期行为**：点击"退出应用"后，应用在短暂 loading 后正常退出，窗口关闭。

**实际行为**：页面永久停留在 loading 状态，窗口无法关闭，需要通过任务管理器强制结束进程。

## 根因分析

退出流程中存在**双重 `backend::stop_and_wait` 调用**，且第二处使用了 `block_on` 同步阻塞 Tauri 事件循环，导致 IPC 通道冻结。

### 完整调用链路

```
用户点击"退出应用"
  ↓
前端 CloseWindowPrompt.tsx: handleAction("quit")
  ↓ setShuttingDown(true) → 显示 loading spinner
  ↓ await invoke("quit_app")          ← IPC 调用，等待 Rust 端返回
  ↓
Rust tray.rs: quit_app() → exit_app()
  ↓ show_main_window() + emit(SHUTDOWN_STARTED_EVENT)
  ↓ spawn 异步任务:
  │   ↓ backend::stop_and_wait()      ← 第一次调用（异步，不阻塞）
  │   ↓ app.exit(0)
  │       ↓
  │   触发 lib.rs: RunEvent::ExitRequested
  │       ↓
  │   tauri::async_runtime::block_on(backend::stop_and_wait())  ← 第二次调用（同步阻塞！）
  │       ↓ 阻塞 Tauri 事件循环，最长 60 秒
  │       ↓
  │   IPC 通道冻结 → invoke("quit_app") 的 Promise 永远不 resolve
  │       ↓
  │   前端永远卡在 await runCloseAction("quit") → loading spinner 永久转圈
```

### 三个关键问题

1. **双重 `stop_and_wait` 调用**：`exit_app`（tray.rs）中已 spawn 异步任务调用 `stop_and_wait`，`ExitRequested`（lib.rs）中又通过 `block_on` 再次调用。第二次调用时 `inner.stopping` 已为 true，走 `StopPlan::Wait` 分支等待同一个 `terminated` 信号，属于冗余操作。

2. **`block_on` 阻塞 Tauri 事件循环**：`ExitRequested` 回调中调用 `tauri::async_runtime::block_on(backend::stop_and_wait(...))`，这是同步阻塞调用。`stop_and_wait` 内部等待后端进程退出，最长 60 秒（`GRACEFUL_SHUTDOWN_EXIT_TIMEOUT`）。在此期间 Tauri 的 IPC 响应线程被冻结，前端的 `invoke("quit_app")` Promise 无法 resolve。

3. **前端 loading 状态无法退出**：`CloseWindowPrompt.tsx` 的 `handleAction` 中，`await runCloseAction(action)` 永远不返回，后续的 `setShuttingDown(false)` 和 `setSubmitting(null)` 永远不会执行，导致 Modal 永久显示 loading。

### 为什么只在 Windows 打包后出现

- macOS 上 `ExitRequested` 的处理路径不同：OS-initiated quit（`code.is_none()`）会被 `prevent_exit` 拦截并转为 close prompt，程序化 `app.exit(0)` 才走 `block_on` 路径
- 开发环境下后端进程关闭较快，`block_on` 阻塞时间短，IPC 冻结不明显
- 打包后 sidecar 进程关闭可能更慢（uvicorn 优雅关闭、SSE 长连接等），`block_on` 阻塞时间更长，IPC 冻结更明显

## 涉及文件

| 文件 | 角色 |
|------|------|
| `console/src-tauri/src/lib.rs` | Tauri 应用入口，`ExitRequested` 事件处理 |
| `console/src-tauri/src/tray.rs` | 系统托盘、`quit_app` 命令、`exit_app` 退出逻辑 |
| `console/src-tauri/src/backend.rs` | Python sidecar 后端生命周期管理，`stop_and_wait` |
| `console/src/tauri/CloseWindowPrompt.tsx` | 前端"最小化/退出"对话框组件 |

## 修改方案

核心思路：在 `exit_app` 中记录"后端关闭已发起"标志位，`ExitRequested` 中检查该标志位，若已发起则跳过 `block_on(stop_and_wait)`，避免重复调用和事件循环阻塞。

### 改动 1：`console/src-tauri/src/tray.rs`

**新增 `shutdown_initiated` 原子标志位**：

```rust
// TrayState 结构体新增字段
pub(crate) struct TrayState {
    // ... 原有字段 ...
    /// Set to true once `exit_app` has started backend shutdown, so the
    /// `ExitRequested` handler knows not to call `block_on(stop_and_wait)`
    /// again — which would freeze the Tauri event loop and leave the frontend
    /// stuck in its loading spinner forever.
    shutdown_initiated: AtomicBool,
}
```

**`exit_app` 中设置标志位**：

```rust
fn exit_app(app: &tauri::AppHandle) {
    show_main_window(app);
    let _ = app.emit(SHUTDOWN_STARTED_EVENT, ());

    // 标记关闭已发起，防止 ExitRequested 中重复 block_on
    {
        let state = app.state::<TrayState>();
        state.shutdown_initiated.store(true, Ordering::SeqCst);
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = backend::stop_and_wait(&app).await {
            log::warn!("[backend] graceful shutdown did not complete: {err}");
        }
        app.exit(0);
    });
}
```

**新增公开查询函数**：

```rust
pub(crate) fn shutdown_initiated(app: &tauri::AppHandle) -> bool {
    app.state::<TrayState>()
        .shutdown_initiated
        .load(Ordering::SeqCst)
}
```

### 改动 2：`console/src-tauri/src/lib.rs`

**`ExitRequested` 中检查标志位，跳过重复调用**：

```rust
RunEvent::ExitRequested { api, code, .. } => {
    // ... macOS 处理 ...

    // 如果 exit_app 已在异步任务中处理后端关闭，则跳过 block_on，
    // 避免冻结 Tauri 事件循环导致前端 IPC 卡死
    if !tray::shutdown_initiated(app_handle) {
        if let Err(err) =
            tauri::async_runtime::block_on(backend::stop_and_wait(app_handle))
        {
            log::warn!("[backend] graceful shutdown did not complete: {err}");
        }
    }
    computer_use_runtime::stop(app_handle);
}
```

## 修复后的退出流程

```
用户点击"退出应用"
  ↓
前端: invoke("quit_app")
  ↓
Rust: exit_app()
  ↓ 设置 shutdown_initiated = true
  ↓ spawn 异步任务:
      ↓ stop_and_wait()  ← 唯一一次调用
      ↓ app.exit(0)
          ↓
      ExitRequested
          ↓ 检查 shutdown_initiated == true → 跳过 block_on
          ↓ computer_use_runtime::stop()
          ↓ 直接放行，事件循环不阻塞
              ↓
      IPC 通道正常 → invoke("quit_app") resolve
              ↓
      前端 loading 短暂显示后应用退出 ✓
```

## 验证建议

1. **编译验证**：在安装了 Rust 工具链的环境中执行 `cargo check` 和 `cargo build`
2. **打包测试**：打包 Windows 版本，点击关闭按钮 → 选择"退出应用"，确认窗口能正常关闭
3. **托盘退出测试**：右键托盘图标 → Quit，确认应用能正常退出
4. **最小化测试**：点击关闭按钮 → 选择"最小化到托盘"，确认窗口正常隐藏
5. **记住选择测试**：勾选"记住我的选择"后退出，再次打开关闭，确认自动执行记住的操作
