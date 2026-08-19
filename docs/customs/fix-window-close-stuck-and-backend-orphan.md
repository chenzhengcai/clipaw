# 修复窗口退出卡死与 macOS 后端进程残留

## 问题场景

### 问题 1：Windows 退出卡死 5-6 分钟

**平台**：Windows 打包版（Tauri 桌面应用）

**复现步骤**：

1. 运行打包后的 QwenPaw Desktop
2. 点击窗口关闭按钮（X / Alt+F4）
3. 弹出对话框，选择"退出应用"
4. 页面进入 loading 状态（Spin 转圈），窗口无法关闭
5. 等待 5-6 分钟后才能关闭

**预期行为**：点击"退出应用"后，窗口立即关闭，后端在后台清理。

**实际行为**：页面停留在 loading 状态 5-6 分钟，窗口无法关闭。

### 问题 2：macOS 后端进程残留

**平台**：macOS（开发版与打包版）

**复现步骤**：

1. 运行 QwenPaw Desktop
2. 退出应用（关闭按钮 / 托盘 Quit / Cmd+Q）
3. 应用窗口关闭后，`qwenpaw-backend` 进程仍然存在于系统中
4. 多次退出后累积多个残留进程

**预期行为**：退出应用后，后端及其子进程全部终止。

**实际行为**：`qwenpaw-backend` 主进程及 browser worker 子进程残留为孤儿进程。

## 前置提交

提交 `45f1f2a8`（"fix。bug windows 关闭的时候可能卡死"）已修复了退出流程中**双重 `stop_and_wait` 调用**导致的事件循环冻结问题：通过 `shutdown_initiated` 原子标志避免 `ExitRequested` 中重复 `block_on(stop_and_wait)`。

该提交有意义但修复不完整，仍存在两个更深的根因（见下文）。

## 根因分析

### 根因 1：Windows 卡 5-6 分钟

`exit_app`（`tray.rs`）的退出时序有问题：

```
前端 invoke("quit_app")
  ↓
exit_app() -> spawn Tauri async 任务 {
    stop_and_wait()   ← 最多等 60s（GRACEFUL_SHUTDOWN_EXIT_TIMEOUT）
    app.exit(0)
}
```

`stop_and_wait` 的 `GRACEFUL_SHUTDOWN_EXIT_TIMEOUT = 60s`。在这 60 秒内：

- 前端的 `await invoke("quit_app")` Promise **一直 pending**，Modal 永久显示 loading 转圈
- 即使 `/api/desktop/shutdown` 端点成功（`server.should_exit = True`），后端 lifespan 的 `finally` 块里有大量清理工作
- **Windows sandbox ACL 清理**是主要耗时源：`_unelevated_shutdown_cleanup` 中每个孤儿 sandbox 有 60s deadline，每个 ACL 条目调用 `icacls`（`subprocess.run(timeout=30)`），串行执行，多个孤儿 sandbox 总耗时可达 5-6 分钟
- 60s 超时后 `force_kill` 再等 `FORCED_SHUTDOWN_EXIT_TIMEOUT = 5s`

关键问题：**`app.exit(0)` 在 `stop_and_wait` 完成后才调用**，在此之前窗口一直可见且卡在 loading。

### 根因 2：macOS 进程残留

- `tauri_plugin_shell` spawn 的 sidecar 是**独立进程**，Rust 端的 `child.kill()`（`force_kill`）只杀进程本身，**不杀子进程树**
- macOS 不链接父子进程生命周期：父进程退出后，子进程被 reparent 到 launchd（PID 1），继续运行
- 后端 uvicorn 会 spawn browser 子进程（Chrome/Playwright worker），这些是 sidecar 的直接子进程
- macOS release 构建中，computer-use helper 通过 `/usr/bin/open -n -W` 启动，完全脱离 Tauri 进程树（由 LaunchServices 管理）
- 当 graceful shutdown 端点未调用或后端 lifespan 卡住时，`force_kill` 只杀 uvicorn 主进程，子进程变孤儿
- 后端**没有信号处理器**（无 SIGTERM/SIGINT handler），完全依赖 HTTP shutdown 端点；HTTP 通道断开时只能靠 `force_kill`

## 涉及文件

| 文件 | 角色 |
|------|------|
| `console/src-tauri/src/tray.rs` | 系统托盘、`quit_app` 命令、`exit_app` 退出逻辑 |
| `console/src-tauri/src/backend.rs` | Python sidecar 后端生命周期管理，`force_kill_sidecar` |
| `console/src-tauri/src/lib.rs` | Tauri 应用入口，`ExitRequested` 事件处理 |

## 修改方案

核心思路：**先关窗口，后端兜底**。窗口立即隐藏（用户无感），后端清理在 detached OS 线程中有限时间内完成，超时则 force-kill 进程树。

### 改动 1：`console/src-tauri/src/tray.rs` — exit_app 重写

**目标**：用户点击"退出应用"后窗口立即消失，后端清理在后台完成。

**改动点**：

1. **`TrayState` 新增 `shutdown_thread` 字段**：`Mutex<Option<std::thread::JoinHandle<()>>>`，存储 detached 线程的 JoinHandle，供 `ExitRequested` handler join。

2. **`exit_app` 改为 spawn 独立 OS 线程**（非 Tauri async 任务）：
   - 线程内先用专用 tokio runtime（`tokio::runtime::Builder::new_current_thread().enable_all()`）执行 `stop_and_wait`，10s 超时（`SHUTDOWN_DETACH_TIMEOUT`）
   - 超时后调 `backend::force_kill_sidecar` 兜底杀进程
   - 线程完成清理后自己调 `app.exit(0)` 触发退出
   - 线程 spawn 失败则 inline force-kill + 立即 `app.exit(0)`

3. **主线程不调 `app.exit(0)`**，改为 `hide_main_window(app)` 立即隐藏窗口。原因：Tauri v2 的 `exit()` 最终调 `process::exit()`，会终止所有线程包括 detached 线程。

4. **新增 `join_shutdown_thread` 函数**：在 `ExitRequested` 中调用，用 `is_finished` + sleep poll（100ms 间隔，2x 超时 = 20s）等待线程完成。超时则 force-kill 并放行退出。

```rust
const SHUTDOWN_DETACH_TIMEOUT: Duration = Duration::from_secs(10);

fn exit_app(app: &tauri::AppHandle) {
    show_main_window(app);
    let _ = app.emit(SHUTDOWN_STARTED_EVENT, ());
    // ... 设置 shutdown_initiated = true ...
    let app_for_thread = app.clone();
    let spawn_result = std::thread::Builder::new()
        .name("qwenpaw-backend-shutdown".to_string())
        .spawn(move || {
            crate::computer_use_runtime::stop(&app_for_thread);
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all().build().unwrap();
            let result = runtime.block_on(async {
                tokio::time::timeout(
                    SHUTDOWN_DETACH_TIMEOUT,
                    backend::stop_and_wait(&app_for_thread),
                ).await
            });
            // ... match result，超时则 force_kill_sidecar ...
            app_for_thread.exit(0);  // 线程自己触发退出
        });
    // ... 存 JoinHandle 到 TrayState ...
    hide_main_window(app);  // 立即隐藏窗口
}
```

### 改动 2：`console/src-tauri/src/backend.rs` — macOS 进程树清理

**目标**：force-kill 时杀整个进程树，不留孤儿。

**改动点**：

1. **新增 `force_kill_sidecar` 公开函数**：
   - 先取 sidecar PID
   - macOS 上先调 `kill_process_tree_macos` 收集后代 + SIGTERM
   - 调 `state.force_kill()` 杀 root 进程
   - 调 `state.finish_stop()` 清理完整 BackendState（避免 `restart_backend` 卡在 `StopPlan::Wait`）
   - macOS 上 SIGKILL 残存的后代进程

2. **新增 `kill_process_tree_macos` 函数**（macOS only）：
   - 用 `pgrep -P <pid>` 递归收集所有后代 PID
   - `HashSet<u32>` 防止循环和重复
   - 对每个后代发 SIGTERM
   - 返回 `Vec<u32>` 供调用方后续 SIGKILL

**关键时序**：必须在杀 root **之前**收集后代，因为 macOS 上父进程退出后子进程被 reparent 到 launchd，`pgrep -P <root>` 会返回空。

```rust
pub(crate) fn force_kill_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    let pid = state.with_inner(|inner| inner.child.as_ref().map(|child| child.pid()));
    // macOS: 先收集后代 + SIGTERM
    #[cfg(target_os = "macos")]
    let descendants = pid.map(kill_process_tree_macos).unwrap_or_default();
    // 杀 root
    state.force_kill();
    state.finish_stop();  // 清理完整状态
    // macOS: SIGKILL 残存后代
    #[cfg(target_os = "macos")]
    for child_pid in &descendants { /* kill -KILL */ }
}
```

### 改动 3：`console/src-tauri/src/lib.rs` — ExitRequested handler

**目标**：避免重复清理，同时确保 detached 线程完成后才放行进程退出。

**改动点**：

- `shutdown_initiated == true` 时：调 `tray::join_shutdown_thread` join 线程（窗口已隐藏，用户不感知）
- `shutdown_initiated == false` 时：保持原有逻辑（`block_on(stop_and_wait)` + `computer_use_runtime::stop`），并将 `computer_use_runtime::stop` 移入此分支（避免在 `shutdown_initiated` 路径重复调用，因其内部 `thread.join()` 会阻塞事件循环）

## 修复后的退出流程

```
用户点击"退出应用"
  ↓
前端: invoke("quit_app")
  ↓
Rust: exit_app()
  ↓ 设置 shutdown_initiated = true
  ↓ spawn OS 线程:
  │   ↓ computer_use_runtime::stop()        ← 停止 Computer Use helper
  │   ↓ stop_and_wait()（10s 超时）          ← 优雅关闭后端
  │   ↓ 超时? force_kill_sidecar()           ← 兜底杀进程树
  │   ↓ app.exit(0)                          ← 线程自己触发退出
  │       ↓
  │   ExitRequested:
  │       ↓ shutdown_initiated == true
  │       ↓ join_shutdown_thread()           ← join 线程（已接近完成）
  │       ↓ 放行进程退出
  │
  ↓ hide_main_window()                       ← 窗口立即隐藏（用户无感）
  ↓ invoke("quit_app") resolve               ← 前端 Promise 立即返回
```

## 验证

1. **编译验证**：`cargo check --manifest-path console/src-tauri/Cargo.toml` 通过，无 error 无 warning
2. **代码审查**：经过 3 轮 review（2 轮 blocking 问题修复 + 1 轮交付级审查），确认：
   - 无 UI 闪烁（`show_main_window` -> `emit` -> `hide_main_window` 微秒级完成）
   - 无死锁（线程完成清理后才调 `app.exit(0)`，join 时 `is_finished()` 已为 true）
   - spawn 失败路径安全（`shutdown_thread` 为 None，join 跳过）
   - `finish_stop` 安全（child 已 take，finish_stop 的 take 是 no-op；不影响 events::watch 任务的独立 Sender clone）
   - 无 double-free / use-after-free
   - `restart_backend` 不受影响（直接调 `stop_and_wait`，不走 detached 线程路径）
3. **打包测试**（待用户执行）：
   - Windows：点击关闭按钮 -> 选择"退出应用"，确认窗口立即消失
   - macOS：退出后检查 `ps aux | grep qwenpaw-backend` 确认无残留
   - 托盘 Quit：右键托盘 -> Quit，确认正常退出
   - 最小化到托盘：确认窗口正常隐藏

## 已知限制

1. **`computer_use_runtime::stop` 的无界 `child.wait()`**：如果 Computer Use helper 卡住，可能消耗 join 超时预算（20s）。已有 `backend_guard.reconcile_singleton_backend` 在下次启动时清理孤儿，可接受。

2. **macOS computer-use helper（`/usr/bin/open -n -W` 启动）**：由 LaunchServices 管理，脱离 Tauri 进程树，`pgrep -P` 可能找不到它。依赖 `computer_use_runtime::stop` 单独 kill。

3. **Windows browser worker 子进程**：Windows 上 `force_kill` 只杀 sidecar 主进程。browser worker 由后端 lifespan finally 块清理；如果 lifespan 被中断，依赖 `backend_guard` 下次启动时清理。

## 风险评估

| 风险 | 严重程度 | 是否新引入 | 缓解措施 |
|------|---------|-----------|---------|
| lifespan 清理被中断 | 中 | 否（force_kill 已有同风险） | backend_guard 下次启动清理孤儿 |
| macOS 进程树误杀 | 低 | 是 | 只杀 sidecar 的直接后代，不验证 cmdline（后代都是 uvicorn spawn 的） |
| restart_backend 影响 | 低 | 否 | 不修改 stop_and_wait，restart_backend 走原有路径 |
| 前端 loading 残留 | 极低 | 否 | 窗口立即隐藏，用户不可见 |
