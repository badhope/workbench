#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 崩溃可见：必须在任何可能 panic 的代码之前安装（含 Tauri 初始化）。
    workbench_lib::logging_setup::install_panic_hook();

    // CLI 优先：带子命令时只跑命令行、不创建窗口。
    // 不带参数（双击 / 从开始菜单启动）才进入桌面应用。
    if let Some(code) = workbench_lib::cli::try_run() {
        std::process::exit(code);
    }
    workbench_lib::run()
}
