pub mod ai;
pub mod cli;
pub mod commands;
pub mod cost_store;
pub mod data;
pub mod devserver;
pub mod diagnostics;
pub mod ipc_guard;
pub mod json_store;
pub mod lock;
pub mod logging_setup;
pub mod paths;
pub mod ports;
pub mod pricing;
pub mod procs;
pub mod runtime;
pub mod server;
pub mod session_meter;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// 托盘是否创建成功。
///
/// 这个标志决定「关闭窗口」的语义：
/// - 有托盘 → 隐藏到托盘，用户能再点开（桌面应用的常见行为）
/// - 无托盘 → 必须真正退出，否则窗口再也调不出来，用户只能杀进程
///
/// Linux 上托盘依赖 StatusNotifier/AppIndicator，GNOME 默认、Wayland
/// 以及没装 appindicator 支持的环境里创建会失败，这不是边缘情况。
static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// 显示/隐藏主窗口（托盘点击、全局快捷键共用）。
fn toggle_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

/// 退出前让前端把 300ms 防抖中的编辑落盘。
///
/// 前端保存是防抖的，`app.exit(0)` 不等待 WebView 的异步请求，最后一批编辑
/// 会直接丢。调用约定：Rust 只发 `workbench://quit-requested` 事件，
/// 由前端 flush 完再调 `quit_app` 命令真正退出；超过 1 秒没回应则强制退出
/// （WebView 崩了也不能让用户关不掉窗口）。
fn request_graceful_quit(app: &AppHandle) {
    use tauri::Emitter;
    let app_handle = app.clone();
    if app.emit("workbench://quit-requested", ()).is_err() {
        app.exit(0);
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        log::warn!("退出前 flush 超时，强制退出");
        app_handle.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：双击两次图标只会有一个进程。
        // 没有它时两个实例各自持有进程内的数据锁，data.json 的
        // 「读-改-写」会互相覆盖（丢更新），全局快捷键也会抢同一个热键
        // （第二个实例注册失败）。
        // 注意：Linux 上该插件依赖 D-Bus 会话总线。没有会话总线时
        // （纯 Xvfb、部分容器）它会静默失效，两个实例都能起来 ——
        // 真实桌面环境总有会话总线，所以这是可接受的降级。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            log::info!("检测到第二个实例，聚焦已有窗口");
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 开机自启：注册项由各平台自己管理（Windows 是 HKCU Run，Linux 是
        // ~/.config/autostart 下的 .desktop，macOS 是 LaunchAgent）。
        // 「是否已启用」每次向操作系统查询，本地不存布尔 —— 用户可能在
        // 任务管理器 / 系统设置里手动关掉，只信本地标志会显示成错的。
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            logging_setup::init_logging(app.handle());
            log::info!("工作台 v{} 启动", app.package_info().version);

            // IPC 反向入参守卫：目录与端口白名单，随扫描/加载动态登记
            app.manage(ipc_guard::KnownDirs::default());
            app.manage(ipc_guard::AllowedPorts::default());

            // ── 全局快捷键 Ctrl+Shift+W 切换窗口可见性（被占用时降级为警告，不阻断启动）──
            if let Err(e) = app.handle().global_shortcut().on_shortcut(
                "CmdOrCtrl+Shift+W",
                move |handle, _, _| {
                    toggle_window(handle);
                },
            ) {
                log::warn!("全局快捷键 CmdOrCtrl+Shift+W 注册失败（窗口隐藏后需从托盘恢复）: {e}");
            }

            // ── 托盘：左键切换显示，菜单提供「退出」彻底结束进程 ──
            // 托盘文案在系统 UI 里长期可见，用双语标注而不是只写中文：
            // 界面主语言可在三语间切换，但托盘菜单在创建时就固定了，
            // 折中方案是让两种主要语言同时出现。
            // 菜单构建同样可能失败；失败时整块托盘降级，而不是 `?` 让启动崩掉。
            let menu_built =
                (|| -> Result<(MenuItem<tauri::Wry>, MenuItem<tauri::Wry>), String> {
                    let toggle = MenuItem::with_id(
                        app,
                        "toggle",
                        "显示 / 隐藏窗口 · Show / Hide",
                        true,
                        None::<&str>,
                    )
                    .map_err(|e| e.to_string())?;
                    let quit =
                        MenuItem::with_id(app, "quit", "退出工作台 · Quit", true, None::<&str>)
                            .map_err(|e| e.to_string())?;
                    Ok((toggle, quit))
                })();

            // 托盘创建失败不能阻断启动：很多 Linux 桌面（GNOME 默认、
            // Wayland 会话、未装 appindicator 的发行版）没有可用的托盘，
            // 而「因为没有托盘就启动不了」是非常糟糕的失败方式。
            //
            // WORKBENCH_NO_TRAY=1 可显式禁用托盘，用于：
            // 1) 在无托盘桌面上避免无谓的 D-Bus 探测
            // 2) 测试「无托盘时关闭即退出」的降级路径
            let tray_disabled = std::env::var("WORKBENCH_NO_TRAY")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            let tray_result = if tray_disabled {
                log::info!("WORKBENCH_NO_TRAY 已设置，跳过托盘创建");
                Err("已通过环境变量禁用".to_string())
            } else {
                (|| {
                    let (toggle_item, quit_item) = menu_built?;
                    let menu = Menu::with_items(app, &[&toggle_item, &quit_item])
                        .map_err(|e| e.to_string())?;
                    TrayIconBuilder::with_id("workbench-tray")
                        .tooltip("Workbench")
                        // 用 PNG 而不是 ico：Linux 的托盘实现只认位图，
                        // include_image 跨平台解析到 icons/32x32.png
                        .icon(tauri::include_image!("icons/32x32.png"))
                        .menu(&menu)
                        // Linux 上托盘菜单默认需要左键弹出（很多桌面环境没有右键习惯）
                        .show_menu_on_left_click(cfg!(target_os = "linux"))
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                toggle_window(tray.app_handle());
                            }
                        })
                        .on_menu_event(|app, event| match event.id.as_ref() {
                            "toggle" => toggle_window(app),
                            "quit" => {
                                log::info!("托盘菜单退出，先让前端 flush");
                                request_graceful_quit(app);
                            }
                            _ => {}
                        })
                        .build(app)
                        .map_err(|e| e.to_string())
                })()
            };

            match tray_result {
                Ok(_tray) => {
                    TRAY_AVAILABLE.store(true, Ordering::SeqCst);
                    log::info!("系统托盘已创建");
                }
                Err(e) => {
                    // 降级：没有托盘时关闭窗口就是退出，避免应用变成无法关闭的后台进程
                    log::warn!("系统托盘不可用（{e}）。关闭窗口将直接退出应用，而不是隐藏到托盘。");
                }
            }

            // ── 关闭窗口：有托盘则隐藏，无托盘则退出 ──
            // 注册必须在托盘创建之后：否则 TRAY_AVAILABLE 还是初值 false，
            // 「关闭即退出」会误作用于有托盘的桌面。

            if let Some(window) = app.get_webview_window("main") {
                let handle2 = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if TRAY_AVAILABLE.load(Ordering::SeqCst) {
                            if let Some(win) = handle2.get_webview_window("main") {
                                let _ = win.hide();
                            }
                            api.prevent_close();
                        } else {
                            // 没有托盘：正常退出，否则用户无法再唤回窗口
                            log::info!("无托盘可用，关闭窗口即退出");
                            request_graceful_quit(&handle2);
                            api.prevent_close();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::quit_app,
            commands::list_processes,
            commands::terminate_process,
            commands::terminate_process_elevated,
            commands::list_ports,
            commands::list_dev_servers,
            commands::list_ai_processes,
            commands::opencode_sessions,
            commands::opencode_session_detail,
            commands::recent_sessions_preview,
            commands::system_info,
            commands::disk_info,
            commands::git_branch,
            commands::open_known_path,
            commands::set_always_on_top,
            commands::open_mini_window,
            commands::show_main_window,
            commands::close_current_window,
            commands::load_data,
            commands::load_data_versioned,
            commands::save_data,
            commands::read_logs,
            commands::clear_logs,
            // ── 成本计量 ──
            commands::scan_session_costs,
            commands::get_cost_overview,
            commands::get_cost_trend,
            commands::get_cost_trend_extended,
            commands::get_model_breakdown,
            commands::get_project_breakdown,
            commands::get_cost_export,
            commands::get_cost_settings_cmd,
            commands::save_cost_settings_cmd,
            commands::clear_cost_records,
            commands::backup_data,
            commands::open_backup_dir,
            commands::list_backups,
            commands::restore_backup,
            commands::get_pricing,
            commands::save_pricing,
            commands::diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("运行工作台应用失败");
}
