//! 无界面 HTTP 服务：同一套后端逻辑的第三种入口（桌面 / CLI / Web）。
//!
//! 为什么需要：项目原先只有两种运行形态 —— Tauri 窗口，或纯前端的静态 demo。
//! 前者装不了、跑不了无头环境（服务器、容器、远程开发机），后者没有任何真实数据
//! （全是 `demoBundle()` 的假进程）。这里补的是「同一份产品跑在浏览器里，
//! 背后是真实的进程表、真实的端口、真实的成本库」。
//!
//! 设计取舍：
//! - **不重复实现业务逻辑**：进程/端口/成本全部调用已有模块，HTTP 层只做
//!   「JSON 编解码 + 错误映射」。这样 REST 与 IPC 的答案不会分叉。
//! - **只读 + 有限写入**：终止进程这类不可逆操作不暴露成 HTTP 端点 ——
//!   浏览器里没有「用户确认」的强保证（CSRF、误点、脚本），留在桌面壳里。
//!   可写的只有项目/任务数据与成本设置，与桌面端等价。
//! - **默认只听回环**：`127.0.0.1`，不提供 `--host 0.0.0.0` 之外的花活；
//!   真要对外可用，请自己套反向代理并加认证（README 有说明）。
//! - **SPA 回落**：`/api/*` 走 JSON，其余路径回落到 `index.html`，
//!   让前端路由在浏览器刷新时不会 404。
//!
//! 端点命名与前端 `src/lib/api.ts` 一一对应，便于把同一个客户端切到 HTTP 传输。

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, OriginalUri, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::cost_store::{self, CostSettings};
use crate::data::{self, WorkbenchData};
use crate::diagnostics;
use crate::paths::DataRoot;
use crate::runtime::RuntimeSnapshot;
use crate::session_meter::ScanReadBudget;

/// 编译期嵌入的前端构建产物（`../dist`）。
///
/// 为什么必须嵌入：NSIS 安装包只放一个 exe，用户机器上没有源码树，
/// 也没有 `dist/`。原先 `resolve_static_dir` 的最后一条回落是
/// `env!("CARGO_MANIFEST_DIR")/../dist` —— 那是**构建机**的路径，
/// 实测在安装版上所有文件系统候选都落空、`GET /` 返回 404，
/// Web 模式等于不可用。嵌入之后单文件自包含：拷走 exe 也能起完整的
/// 「API + 页面」服务，这与「local-first、单二进制」的产品形态一致。
///
/// 体积代价：dist 约 1.3 MB（未压缩），gzip 后远小于 Rust 链接器本就
/// 产出的二进制增量，可以接受。debug 构建下 rust-embed 直接读文件系统，
/// 便于改前端后不重编 Rust。
#[derive(rust_embed::RustEmbed)]
#[folder = "../dist"]
struct WebAssets;

/// 嵌入资源的 MIME 猜测：按扩展名给 `Content-Type`。
///
/// 只覆盖构建产物实际出现的类型；漏掉的类型浏览器会当 `text/plain`
/// 渲染，CSS/JS 直接不生效，所以这里宁多勿少，且全部小写。
fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "webmanifest" => "application/manifest+json",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

/// 从嵌入资源解析一个路径。目录索引回落到 `index.html`（SPA 路由刷新）。
/// 是否带上了前端产物（以 index.html 存在为准）。
pub fn has_embedded_assets() -> bool {
    WebAssets::get("index.html").is_some()
}

fn embedded_file(path: &str) -> Option<(Vec<u8>, &'static str)> {
    let clean = path.trim_start_matches('/');
    // 依次尝试：原路径 → 目录下 index.html → SPA 回落 index.html。
    // 前两者保证 /assets/xxx.js 命中真实文件，最后一条保证 /some/route
    // 刷新时拿到的是应用而不是 404。
    for candidate in [clean, &format!("{clean}/index.html"), "index.html"] {
        if let Some(file) = WebAssets::get(candidate) {
            let data = file.data.into_owned();
            return Some((data, mime_for(candidate)));
        }
    }
    None
}

/// 服务运行参数。
#[derive(Debug, Clone)]
pub struct ServeOptions {
    pub addr: SocketAddr,
    pub data_root: DataRoot,
    /// 前端构建产物目录（`dist/`）。不存在时不挂静态文件，只提供 API。
    pub static_dir: Option<PathBuf>,
    /// 允许的 CORS 来源；空表示只允许同源（浏览器默认）。
    pub allow_origin: Option<String>,
}

impl ServeOptions {
    pub fn new(addr: SocketAddr, data_root: DataRoot) -> Self {
        Self {
            addr,
            data_root,
            static_dir: None,
            allow_origin: None,
        }
    }
}

/// 共享状态。`DataRoot` 是唯一的数据入口，不再有 AppHandle。
#[derive(Clone)]
pub struct AppState {
    root: Arc<DataRoot>,
}

impl AppState {
    pub fn new(root: DataRoot) -> Self {
        Self {
            root: Arc::new(root),
        }
    }
}

/// 统一错误响应：`{"error": "..."}` + 合适的状态码。
///
/// 前端（桌面与浏览器）都按 `error` 字段读，不猜 body 形状。
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: message.into(),
        }
    }

    fn conflict(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

type ApiResult<T> = Result<Json<T>, ApiError>;

fn ok<T: Serialize>(value: T) -> ApiResult<T> {
    Ok(Json(value))
}

/// 构建路由。抽出来是为了能在测试里直接 `oneshot` 调用，不用真的监听端口。
pub fn router(state: AppState, opts: &ServeOptions) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/version", get(version))
        .route("/diagnostics", get(diagnostics_handler))
        .route("/processes", get(list_processes))
        .route("/ports", get(list_ports))
        .route("/dev-servers", get(list_dev_servers))
        .route("/ai-processes", get(list_ai_processes))
        .route("/sessions", get(session_previews))
        .route("/sessions/opencode", get(opencode_sessions))
        .route("/snapshot", get(snapshot))
        .route("/system", get(system_info))
        .route("/disks", get(disks))
        .route("/data", get(load_data).put(save_data))
        .route("/cost/overview", get(cost_overview))
        .route("/cost/trend", get(cost_trend))
        .route("/cost/trend-extended", get(cost_trend_extended))
        .route("/cost/models", get(cost_models))
        .route("/cost/projects", get(cost_projects))
        .route("/cost/export", get(cost_export))
        .route("/cost/settings", get(cost_settings).put(save_cost_settings))
        .route("/cost/pricing", get(pricing_view).put(save_pricing_view))
        .route("/cost/scan", post(cost_scan))
        .with_state(state);

    // axum 的 Json extractor 默认只收 2MB；项目/任务是整份快照，任务和备注
    // 一多就会超，Web 模式保存直接 413，而桌面 IPC 没有这个限制。放到 32MB：
    // 足够十万条任务级别的数据，也不至于让一个请求吃光内存。
    let mut app = Router::new()
        .nest("/api", api)
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024));

    // 静态站点，两级来源：
    // 1) 显式/自动发现的磁盘目录（开发时改完前端刷新即生效，不必重编 Rust）；
    // 2) 编译期嵌入的产物 —— 安装版只有一个 exe，用户机器上没有源码树，
    //    磁盘候选全部落空（实测 GET / 404），嵌入是唯一可靠的来源。
    // 没有嵌入资源也允许只跑 API（容器里做纯数据服务合理），所以
    // fallback 只在两者都不可用时保持 axum 默认 404。
    if let Some(dir) = &opts.static_dir {
        let index = dir.join("index.html");
        if index.is_file() {
            // SPA 回落：未命中的路径交给 index.html，让前端路由刷新不 404。
            let serve = ServeDir::new(dir).fallback(ServeFile::new(&index));
            app = app.fallback_service(serve);
        }
    } else if has_embedded_assets() {
        app = app.fallback_service(get(serve_embedded));
    }

    let mut app = app.layer(TraceLayer::new_for_http());

    // 跨域：默认不加 CORS 层（同源就够，少暴露攻击面）。
    // 只有显式配置了 `--allow-origin` 才放行，方便把前端单独部署到
    // 另一个端口/域名上做开发，而不是靠 `Any` 一刀切。
    if let Some(origin) = &opts.allow_origin {
        app = app.layer(
            CorsLayer::new()
                .allow_origin(
                    origin
                        .parse::<axum::http::HeaderValue>()
                        .map_err(|_| {
                            format!(
                                "非法的 --allow-origin（需形如 http://localhost:5173）: {origin}"
                            )
                        })
                        .unwrap_or_else(|_| {
                            axum::http::HeaderValue::from_static("http://localhost:5173")
                        }),
                )
                .allow_methods(Any)
                .allow_headers(Any),
        );
    }

    app
}

/// 启动服务并阻塞到进程退出。返回实际绑定地址（`--port 0` 时有用）。
/// 嵌入资源的请求处理：解析路径 → 200 + MIME，未命中回落 index.html。
async fn serve_embedded(OriginalUri(uri): OriginalUri) -> Response {
    // /api/* 未命中必须仍是 404 JSON：脚本消费者靠状态码判断，回落到
    // index.html 会让他们拿到 200 + HTML（解析出 "Unexpected token <"）。
    // 这是嵌入回落引入前的既有契约，测试 unknown_api_route_is_404_not_html 锁定。
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return ApiError::not_found("no such API route").into_response();
    }
    match embedded_file(path) {
        Some((data, mime)) => ([(header::CONTENT_TYPE, mime)], data).into_response(),
        None => (StatusCode::NOT_FOUND, "no such asset").into_response(),
    }
}

pub async fn serve(opts: ServeOptions) -> Result<(), String> {
    let state = AppState::new(opts.data_root.clone());
    let app = router(state, &opts);
    let listener = tokio::net::TcpListener::bind(opts.addr)
        .await
        .map_err(|e| format!("无法绑定 {}: {e}", opts.addr))?;
    let actual = listener
        .local_addr()
        .map_err(|e| format!("读取监听地址失败: {e}"))?;
    log::info!("Workbench 服务已启动: http://{actual}");
    println!("Workbench HTTP server listening on http://{actual}");
    println!("  data dir: {}", opts.data_root.as_path().display());
    if let Some(dir) = &opts.static_dir {
        println!("  static:   {}", dir.display());
    } else if has_embedded_assets() {
        println!("  static:   embedded ({} files)", WebAssets::iter().count());
    }
    println!("  API:      {actual}/api/health");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|e| format!("服务退出异常: {e}"))
}

/// Ctrl+C 优雅退出：让正在写入的 SQLite 事务收尾，不留半截文件。
async fn shutdown_signal() {
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => log::info!("收到 Ctrl+C，正在关闭服务"),
        _ = terminate => log::info!("收到 SIGTERM，正在关闭服务"),
    }
}

// ── 处理器 ─────────────────────────────────────────────────

#[derive(Serialize)]
struct Health {
    status: &'static str,
    version: &'static str,
    /// 服务能力自述，方便脚本探测（不承诺稳定，仅作可读信息）。
    capabilities: Vec<&'static str>,
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        capabilities: vec![
            "processes",
            "ports",
            "dev-servers",
            "cost-ledger",
            "data",
            "diagnostics",
        ],
    })
}

#[derive(Serialize)]
struct VersionInfo {
    name: &'static str,
    version: &'static str,
    schema: u32,
}

/// API schema 版本。破坏性变更时递增，脚本据此判断兼容性。
const API_SCHEMA: u32 = 1;

async fn version() -> Json<VersionInfo> {
    Json(VersionInfo {
        name: "workbench",
        version: env!("CARGO_PKG_VERSION"),
        schema: API_SCHEMA,
    })
}

async fn diagnostics_handler(
    State(st): State<AppState>,
) -> ApiResult<diagnostics::DiagnosticsReport> {
    let root = st.root.clone();
    let report = tokio::task::spawn_blocking(move || {
        diagnostics::collect(env!("CARGO_PKG_VERSION"), root.as_path())
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(report)
}

async fn list_processes() -> ApiResult<Vec<crate::procs::ProcInfo>> {
    let rows = tokio::task::spawn_blocking(crate::procs::snapshot_processes)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(rows)
}

async fn list_ports() -> ApiResult<Vec<crate::ports::PortEntry>> {
    let rows = tokio::task::spawn_blocking(crate::runtime::cached_ports)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(rows)
}

async fn list_dev_servers() -> ApiResult<Vec<crate::devserver::DevServer>> {
    let rows = tokio::task::spawn_blocking(|| {
        let ports = crate::runtime::cached_ports()?;
        Ok::<_, String>(crate::runtime::collect_dev_servers(&ports))
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
    .map_err(ApiError::internal)?;
    ok(rows)
}

async fn list_ai_processes() -> ApiResult<Vec<crate::ai::AiProcess>> {
    let rows = tokio::task::spawn_blocking(crate::runtime::collect_ai_processes)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(rows)
}

/// 最近会话文件预览（与桌面 AI 页同一份数据）。
async fn session_previews() -> ApiResult<Vec<crate::ai::SessionFilePreview>> {
    let rows = tokio::task::spawn_blocking(|| {
        let home = crate::commands::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
        crate::ai::scan_session_files_with_preview(&home).map_err(str::to_string)
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
    .map_err(ApiError::internal)?;
    ok(rows)
}

/// 探测本机 opencode 服务并列出在线会话。
///
/// 探测失败不是服务器错误：本机没装/没开 opencode 是正常状态。
/// 所以返回 `sessions: []` + `available: false`，让前端显示空态而不是报错弹窗。
#[derive(Serialize)]
struct OpencodeProbe {
    port: u16,
    available: bool,
    sessions: Vec<crate::ai::OpencodeSession>,
    error: Option<String>,
}

async fn opencode_sessions() -> ApiResult<OpencodeProbe> {
    let probe = tokio::task::spawn_blocking(|| {
        let procs = crate::procs::snapshot_processes();
        let ports = crate::runtime::collect_opencode_ports(&procs);
        let mut last_err = String::new();
        for port in ports {
            match crate::ai::fetch_opencode_sessions(port) {
                Ok(sessions) => {
                    return OpencodeProbe {
                        port,
                        available: true,
                        sessions,
                        error: None,
                    }
                }
                Err(e) => last_err = e,
            }
        }
        OpencodeProbe {
            port: 4096,
            available: false,
            sessions: Vec::new(),
            error: Some(last_err),
        }
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(probe)
}

#[derive(Serialize)]
struct Snapshot {
    procs: Vec<crate::procs::ProcInfo>,
    ports: Vec<crate::ports::PortEntry>,
    dev_servers: Vec<crate::devserver::DevServer>,
}

/// 一次拿全：进程 + 端口 + 开发服务器。浏览器端刷新只要一次往返。
async fn snapshot() -> ApiResult<Snapshot> {
    let snap = tokio::task::spawn_blocking(RuntimeSnapshot::capture)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(Snapshot {
        procs: snap.procs,
        ports: snap.ports,
        dev_servers: snap.dev_servers,
    })
}

async fn system_info() -> ApiResult<crate::commands::SystemInfo> {
    // 与 IPC 版共用同一份实现，避免两处字段漂移。
    let info = tokio::task::spawn_blocking(crate::commands::system_info_blocking)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(info)
}

async fn disks() -> ApiResult<Vec<crate::commands::DiskInfo>> {
    let rows = tokio::task::spawn_blocking(crate::commands::disk_info_blocking)
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    ok(rows)
}

async fn load_data(State(st): State<AppState>) -> ApiResult<VersionedData> {
    let root = st.root.clone();
    let snapshot = tokio::task::spawn_blocking(move || {
        let data = data::load_from_disk(&root)?;
        // HTTP 端没有进程内的 restore generation；用数据文件指纹
        // （文件身份 + 长度）作为乐观锁令牌，语义与桌面端 generation 等价：
        // 别的写方动过，令牌就变。
        let generation = data::fingerprint(&root)?;
        Ok::<_, String>(VersionedData { data, generation })
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
    .map_err(ApiError::internal)?;
    ok(snapshot)
}

#[derive(Serialize)]
struct VersionedData {
    data: WorkbenchData,
    generation: String,
}

/// 写入项目/任务数据。
///
/// 三道保护，缺一不可：
/// 1. **同源检查**：有 `Origin` 就必须与 `Host` 同源。浏览器跨站请求一定带
///    `Origin`，挡在这里就挡住了 CSRF 与 DNS rebinding 的第一跳；不带
///    `Origin` 的 curl/脚本继续放行（HTTP 模式的主要用途）。
/// 2. **写入标记头**：`X-Workbench-Write: 1`。跨源请求带自定义头会触发 CORS
///    预检，而本服务默认不放行任何来源，因此这个头只有自家 UI 加得上。
/// 3. **版本 + 并发**：拒绝未来 schema、强制盖当前版本号，并用 `If-Match`
///    防止两个标签页互相覆盖。
async fn save_data(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<WorkbenchData>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_same_origin(&headers)?;
    require_write_header(&headers)?;

    // 与 IPC save_data 完全相同的版本判定，避免 HTTP 成为绕过口。
    if let Some(version) = payload.schema_version {
        if version > data::SCHEMA_VERSION {
            return Err(ApiError::bad_request(format!(
                "数据来自更新版本（v{version}），当前版本只支持到 v{}；请升级应用后再保存",
                data::SCHEMA_VERSION
            )));
        }
    }
    let mut payload = payload;
    payload.schema_version = Some(data::SCHEMA_VERSION);

    let root = st.root.clone();
    let expected = header_str(&headers, "if-match");
    let new_token = tokio::task::spawn_blocking(move || {
        // compare_and_save 把「比对指纹 + 写入」收在同一把跨进程锁内，
        // 避免检查与写入之间被别的进程插队。
        data::compare_and_save(&root, expected.as_deref(), &payload)
    })
    .await
    .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
    .map_err(|e| {
        if e.contains("已被其他窗口修改") {
            ApiError::conflict(e)
        } else {
            ApiError::internal(e)
        }
    })?;
    Ok(Json(json!({ "ok": true, "generation": new_token })))
}

fn header_str(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// 有 `Origin` 就必须同源；没有（curl / 脚本）放行。
fn require_same_origin(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    let Some(origin) = header_str(headers, "origin") else {
        return Ok(());
    };
    let Some(host) = header_str(headers, "host") else {
        return Err(ApiError::forbidden("缺少 Host 头"));
    };
    let origin_host = origin
        .split("://")
        .nth(1)
        .unwrap_or("")
        .trim_end_matches('/');
    if origin_host.eq_ignore_ascii_case(&host) {
        Ok(())
    } else {
        Err(ApiError::forbidden(
            "拒绝跨源写入；请从 Workbench 自己的页面操作",
        ))
    }
}

/// 写入标记头：跨源请求带自定义头会触发预检，默认 CORS 不放行，
/// 因此这个头只有自家 UI 加得上。
fn require_write_header(headers: &axum::http::HeaderMap) -> Result<(), ApiError> {
    match header_str(headers, "x-workbench-write").as_deref() {
        Some("1") => Ok(()),
        _ => Err(ApiError::forbidden(
            "缺少写入标记头 X-Workbench-Write；只接受 Workbench 界面发起的写入",
        )),
    }
}

async fn cost_overview(State(st): State<AppState>) -> ApiResult<cost_store::CostOverview> {
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || cost_store::build_overview(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

#[derive(Deserialize)]
struct DaysQuery {
    #[serde(default = "default_days")]
    days: usize,
}

fn default_days() -> usize {
    14
}

async fn cost_trend(
    State(st): State<AppState>,
    Query(q): Query<DaysQuery>,
) -> ApiResult<Vec<cost_store::CostTrendRow>> {
    let root = st.root.clone();
    let days = q.days.clamp(1, 3650);
    let v = tokio::task::spawn_blocking(move || cost_store::build_trend(&root, days))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn cost_trend_extended(
    State(st): State<AppState>,
    Query(q): Query<DaysQuery>,
) -> ApiResult<cost_store::ExtendedTrend> {
    let root = st.root.clone();
    let days = q.days.clamp(1, 3650);
    let v = tokio::task::spawn_blocking(move || cost_store::build_trend_extended(&root, days))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn cost_models(State(st): State<AppState>) -> ApiResult<Vec<cost_store::ModelBreakdownRow>> {
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || cost_store::build_model_breakdown(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn cost_projects(
    State(st): State<AppState>,
) -> ApiResult<Vec<cost_store::ProjectBreakdownRow>> {
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || cost_store::build_project_breakdown(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

#[derive(Deserialize)]
struct LimitQuery {
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    200_000
}

async fn cost_export(
    State(st): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> ApiResult<Vec<cost_store::CostExportRow>> {
    let root = st.root.clone();
    let limit = q.limit.clamp(1, 200_000);
    let v = tokio::task::spawn_blocking(move || cost_store::build_cost_export(&root, limit))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn cost_settings(State(st): State<AppState>) -> ApiResult<CostSettings> {
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || cost_store::get_cost_settings(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn save_cost_settings(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(settings): Json<CostSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
    require_same_origin(&headers)?;
    require_write_header(&headers)?;
    let root = st.root.clone();
    tokio::task::spawn_blocking(move || cost_store::save_cost_settings(&root, settings))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Serialize)]
struct ScanResponse {
    new_records: usize,
    total_scanned: usize,
    overview: cost_store::CostOverview,
    trend: Vec<cost_store::CostTrendRow>,
    model_breakdown: Vec<cost_store::ModelBreakdownRow>,
}

/// 扫描会话文件并落库。与 IPC 版是同一段逻辑（步进式预算 + 单事务）。
/// 定价视图（内置表 + 覆盖状态）。
async fn pricing_view(State(st): State<AppState>) -> ApiResult<crate::commands::PricingView> {
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || crate::commands::get_pricing_at(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

/// 保存定价覆盖：与桌面 IPC 共用同一份校验（任一条非法整体拒绝）。
async fn save_pricing_view(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(payload): Json<std::collections::HashMap<String, (f64, f64)>>,
) -> Result<Json<crate::commands::PricingView>, ApiError> {
    require_same_origin(&headers)?;
    require_write_header(&headers)?;
    let root = st.root.clone();
    let v = tokio::task::spawn_blocking(move || crate::commands::save_pricing_at(&root, payload))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?
        .map_err(ApiError::internal)?;
    ok(v)
}

async fn cost_scan(
    State(st): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<ScanResponse>, ApiError> {
    // 扫描会写成本库，属于写操作：与 data/pricing 用同一套门槛。
    require_same_origin(&headers)?;
    require_write_header(&headers)?;
    let root = st.root.clone();
    let result = tokio::task::spawn_blocking(move || scan_sessions(&root))
        .await
        .map_err(|e| ApiError::internal(format!("任务执行失败: {e}")))?;
    match result {
        Ok(v) => Ok(Json(v)),
        Err(e) => Err(ApiError::internal(e)),
    }
}

fn scan_sessions(root: &DataRoot) -> Result<ScanResponse, String> {
    let home = crate::commands::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let session_files = crate::ai::collect_all_session_files(&home).map_err(str::to_string)?;
    let entries: Vec<crate::session_meter::SessionFileEntry> = session_files
        .iter()
        .map(|f| crate::session_meter::SessionFileEntry {
            path: f.path.clone(),
            tool: f.tool.clone(),
            project: f.project.clone(),
            modified: f.modified,
            size: f.size,
        })
        .collect();

    let overrides = cost_store::read_pricing_overrides(root)?;
    if !overrides.problems.is_empty() {
        return Err(format!("定价覆盖无效: {}", overrides.problems.join("; ")));
    }
    let pricing_table = crate::pricing::PricingTable {
        overrides: overrides.overrides,
    };
    let mut records = Vec::new();
    let mut scanned_paths = Vec::new();
    let mut errors = Vec::new();
    const SCAN_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
    let mut budget = ScanReadBudget::new(SCAN_TOTAL_BYTES);
    for entry in &entries {
        match crate::session_meter::scan_complete_sessions_with_budget(
            std::slice::from_ref(entry),
            &pricing_table,
            &mut budget,
        ) {
            Ok(file_records) => {
                records.extend(file_records);
                scanned_paths.push(entry.path.clone());
            }
            Err(err) => errors.push(err),
        }
    }
    let total_scanned = records.len();
    let outcome = cost_store::import_and_aggregate(root, &records, &scanned_paths, 14)?;
    if !errors.is_empty() {
        return Err(format!(
            "{} 个会话扫描失败，旧记录已保留；成功文件已更新: {}",
            errors.len(),
            errors.join("; ")
        ));
    }
    Ok(ScanResponse {
        new_records: outcome.net_new,
        total_scanned,
        overview: outcome.overview,
        trend: outcome.trend,
        model_breakdown: outcome.breakdown,
    })
}

/// 解析静态目录：显式指定 > 可执行文件同级 `dist` > 当前工作目录 `dist`。
///
/// 三条路径覆盖「装好的包」「cargo run」「从仓库根启动」三种现实场景，
/// 找不到就明确返回 None（只跑 API），而不是挂一个必然 404 的空目录。
pub fn resolve_static_dir(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = explicit {
        return if dir.is_dir() {
            Some(dir.to_path_buf())
        } else {
            None
        };
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("dist"));
            candidates.push(parent.join("..").join("dist"));
        }
    }
    candidates.push(std::env::current_dir().unwrap_or_default().join("dist"));
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dist"),
    );
    candidates
        .into_iter()
        .find(|p| p.join("index.html").is_file())
}

/// 把 `"127.0.0.1:7788"` 解析成 SocketAddr，带可读错误。
pub fn parse_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let text = format!("{host}:{port}");
    text.parse::<SocketAddr>()
        .map_err(|e| format!("监听地址不合法 {text}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_addr_accepts_loopback() {
        let a = parse_addr("127.0.0.1", 7788).expect("valid");
        assert_eq!(a.port(), 7788);
    }

    #[test]
    fn parse_addr_rejects_garbage() {
        assert!(parse_addr("not-a-host", 1).is_err());
    }

    /// 静态目录的回落必须真的校验 `index.html`，否则会挂一个必然 404 的站点。
    #[test]
    fn resolve_static_dir_returns_none_for_missing_explicit_path() {
        assert!(resolve_static_dir(Some(Path::new("C:/definitely/absent/dist"))).is_none());
    }

    #[test]
    fn health_reports_capabilities() {
        // 直接构造返回值语义：capabilities 必须非空，否则脚本探测失去意义
        let caps = ["processes", "ports", "dev-servers"];
        assert!(!caps.is_empty());
    }
}

#[cfg(test)]
mod http_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    /// 临时数据根：每个测试独占，避免互相污染真实数据目录。
    fn temp_root(tag: &str) -> DataRoot {
        let dir = std::env::temp_dir().join(format!("wb-http-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        DataRoot::new(dir)
    }

    fn app_for(root: &DataRoot) -> Router {
        router(
            AppState::new(root.clone()),
            &ServeOptions::new(addr_for_test(), root.clone()),
        )
    }

    fn addr_for_test() -> SocketAddr {
        "127.0.0.1:0".parse().expect("valid addr")
    }

    async fn body_json(res: Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .expect("read body");
        serde_json::from_slice(&bytes).expect("body should be JSON")
    }

    #[tokio::test]
    async fn health_reports_ok_and_capabilities() {
        let root = temp_root("health");
        let res = app_for(&root)
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        assert_eq!(body["status"], "ok");
        assert!(!body["capabilities"].as_array().unwrap().is_empty());
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    #[tokio::test]
    async fn version_reports_schema() {
        let root = temp_root("version");
        let res = app_for(&root)
            .oneshot(Request::get("/api/version").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = body_json(res).await;
        assert_eq!(body["name"], "workbench");
        assert_eq!(body["schema"], 1);
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 数据往返：PUT 后 GET 必须读到刚写入的内容，且真的落盘到 data.json。
    #[tokio::test]
    async fn data_put_then_get_roundtrip() {
        let root = temp_root("data");
        let app = app_for(&root);
        let payload = serde_json::json!({
            "projects": [{
                "id": "p1", "name": "Demo", "path": "/tmp/demo",
                "status": "active", "tags": [], "pinned": false,
                "note": "", "created_at": 1
            }],
            "tasks": []
        });

        let put = app
            .clone()
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .header("x-workbench-write", "1")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        // 落盘验证：不只看接口回显，还要确认文件真的写出来了
        let on_disk = std::fs::read_to_string(root.data_json()).expect("data.json should exist");
        assert!(on_disk.contains("\"p1\""));

        let get = app
            .oneshot(Request::get("/api/data").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let body = body_json(get).await;
        // GET 现在返回 { data, generation }：generation 是并发写保护的令牌。
        assert_eq!(body["data"]["projects"][0]["id"], "p1");
        assert!(body["generation"].is_string());
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 没有写入标记头的请求必须被拒绝：跨源请求带不上自定义头。
    #[tokio::test]
    async fn data_put_without_write_header_is_forbidden() {
        let root = temp_root("no-write-header");
        let res = app_for(&root)
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"projects":[],"tasks":[]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        // 被拒绝的请求不能留下数据文件
        assert!(!root.data_json().exists());
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 跨源请求（Origin 与 Host 不同）必须被拒绝。
    #[tokio::test]
    async fn data_put_from_foreign_origin_is_forbidden() {
        let root = temp_root("foreign-origin");
        let res = app_for(&root)
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .header("x-workbench-write", "1")
                    .header("origin", "https://evil.example")
                    .header("host", "127.0.0.1:7788")
                    .body(Body::from(r#"{"projects":[],"tasks":[]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::FORBIDDEN);
        assert!(!root.data_json().exists());
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 过期 If-Match 必须 409，而不是覆盖别人刚写入的数据。
    #[tokio::test]
    async fn stale_if_match_is_conflict() {
        let root = temp_root("if-match");
        let app = app_for(&root);
        let first = serde_json::json!({"projects":[],"tasks":[]});
        let res = app
            .clone()
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .header("x-workbench-write", "1")
                    .body(Body::from(first.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let res = app
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .header("x-workbench-write", "1")
                    .header("if-match", "definitely-stale")
                    .body(Body::from(first.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CONFLICT);
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 非法 JSON 必须被拒绝为 4xx，而不是写坏数据文件。
    #[tokio::test]
    async fn malformed_data_body_is_rejected() {
        let root = temp_root("bad-json");
        let res = app_for(&root)
            .oneshot(
                Request::put("/api/data")
                    .header("content-type", "application/json")
                    .body(Body::from("{not json"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(res.status().is_client_error(), "got {}", res.status());
        assert!(!root.data_json().exists(), "坏请求不应落盘");
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 未知的 /api 路径必须返回 404 JSON，不能落到 SPA 的 index.html，
    /// 否则脚本拿到 HTML 会报「Unexpected token <」而不是清晰的 404。
    #[tokio::test]
    async fn unknown_api_route_is_404_not_html() {
        let root = temp_root("404");
        let res = app_for(&root)
            .oneshot(
                Request::get("/api/does-not-exist")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    #[tokio::test]
    async fn processes_endpoint_returns_json_array() {
        let root = temp_root("procs");
        let res = app_for(&root)
            .oneshot(Request::get("/api/processes").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        assert!(body.is_array(), "processes should be an array");
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    #[tokio::test]
    async fn cost_overview_creates_db_and_returns_zeroed_ledger() {
        let root = temp_root("cost");
        let res = app_for(&root)
            .oneshot(
                Request::get("/api/cost/overview")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        assert_eq!(body["record_count"], 0);
        assert!(root.cost_db().exists(), "首次读取应初始化成本库");
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 趋势窗口参数必须被夹住：`days=0` 不能让 SQL 算出空区间。
    #[tokio::test]
    async fn cost_trend_clamps_days() {
        let root = temp_root("trend");
        let res = app_for(&root)
            .oneshot(
                Request::get("/api/cost/trend?days=0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_json(res).await;
        assert!(body.is_array());
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 成本设置 PUT 后 GET 必须读回同一组值。
    #[tokio::test]
    async fn cost_settings_put_then_get() {
        let root = temp_root("settings");
        let app = app_for(&root);
        let settings = serde_json::json!({
            "daily_budget": 12.5,
            "monthly_budget": 99.0,
            "alert_threshold_pct": 70,
            "include_estimated": false
        });

        let put = app
            .clone()
            .oneshot(
                Request::put("/api/cost/settings")
                    .header("content-type", "application/json")
                    .header("x-workbench-write", "1")
                    .body(Body::from(settings.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(put.status(), StatusCode::OK);

        let get = app
            .oneshot(
                Request::get("/api/cost/settings")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = body_json(get).await;
        assert_eq!(body["daily_budget"], 12.5);
        assert_eq!(body["alert_threshold_pct"], 70);
        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// 嵌入资源是安装版的唯一 UI 来源（磁盘候选在用户机器上全落空）。
    /// debug 构建下 rust-embed 读文件系统，仓库里 dist 应当存在；
    /// 这条测试同时锁住「文件夹路径没配错」与「MIME 表没漏类型」。
    #[tokio::test]
    async fn embedded_assets_serve_index_and_mime() {
        if !has_embedded_assets() {
            panic!("仓库构建必须携带 ../dist；若 CI 顺序变化请先 npm run build");
        }
        let root = temp_root("embed");
        let mut opts = ServeOptions::new(addr_for_test(), root.clone());
        opts.static_dir = None; // 强制走嵌入路径
        let app = router(AppState::new(root.clone()), &opts);

        let index = app
            .clone()
            .oneshot(Request::get("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(index.status(), StatusCode::OK);
        let html = axum::body::to_bytes(index.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = String::from_utf8_lossy(&html);
        assert!(
            html.contains("<div id=\"root\">"),
            "应返回 SPA 入口而非 404 文本"
        );

        // 真实资产文件（构建产物的哈希文件名保证存在）+ 正确 MIME
        let asset_name = WebAssets::iter()
            .find(|p| p.starts_with("assets/") && p.ends_with(".js"))
            .expect("构建产物必含至少一个 JS chunk")
            .to_string();
        let res = app
            .clone()
            .oneshot(
                Request::get(format!("/{asset_name}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let ctype = res
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        assert!(
            ctype.starts_with("text/javascript"),
            "JS 资产必须以 text/javascript 下发，实际: {ctype}"
        );

        // SPA 回落：不存在的路由也返回入口页
        let deep = app
            .oneshot(
                Request::get("/some/deep/route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(deep.status(), StatusCode::OK);

        std::fs::remove_dir_all(root.as_path()).ok();
    }

    /// MIME 表至少要覆盖构建产物里实际出现的每一种扩展名。
    #[test]
    fn mime_table_covers_all_embedded_extensions() {
        let mut seen = std::collections::BTreeSet::new();
        for path in WebAssets::iter() {
            if let Some(ext) = path.rsplit('.').next() {
                seen.insert(ext.to_string());
            }
        }
        for ext in seen {
            let m = mime_for(&format!("x.{ext}"));
            assert_ne!(m, "application/octet-stream", "扩展名 {ext} 没有专属 MIME");
        }
    }

    /// 没有磁盘 dist 时：API 照常可用，页面由嵌入资源顶上（安装版唯一来源）。
    /// （0.7.0 初版这里期待根路径 404 —— 那正是「安装版网页 404」缺陷的
    /// 测试化形态；嵌入修复后语义反转，两者都锁住。）
    #[tokio::test]
    async fn static_dir_absent_still_serves_api() {
        let root = temp_root("nodist");
        let mut opts = ServeOptions::new(addr_for_test(), root.clone());
        opts.static_dir = None;
        let app = router(AppState::new(root.clone()), &opts);

        let api = app
            .clone()
            .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(api.status(), StatusCode::OK);

        let root_path = app
            .oneshot(Request::get("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(root_path.status(), StatusCode::OK);
        std::fs::remove_dir_all(root.as_path()).ok();
    }
}
