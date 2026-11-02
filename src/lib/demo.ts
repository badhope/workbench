/**
 * 浏览器预览模式（非 Tauri）下的静态演示数据。
 *
 * 仅在 `window.__TAURI_INTERNALS__` 不存在时使用，让 UI 可以离线演示；
 * 桌面端永远走真实 IPC，不会读取这里。
 *
 * 设计约束：演示数据里的**可读文本**（项目名、任务标题、会话预览、日志）
 * 必须跟随界面语言。早先这些字符串是硬编码中文，导致英文 README 的截图
 * 里出现 "Windows 11 (演示)" 这种中英混排 —— 对外展示时非常刺眼。
 * 所以这里按语言分表，`demoBundle(lang)` 是唯一入口。
 *
 * 不可翻译的部分（进程名 `chrome.exe`、路径、模型 id）保持原样：
 * 它们本来就是机器的标识符，不是给人读的文案。
 */
import type {
  AiProcess,
  CostOverview,
  CostTrendRow,
  DevServer,
  DiskInfo,
  ModelBreakdownRow,
  PortEntry,
  ProcInfo,
  SessionFilePreview,
  SystemInfo,
  WorkbenchData,
} from "../types";

type DemoLang = "en" | "zh" | "ja";

const nowSec = () => Math.floor(Date.now() / 1000);

/** 每种语言需要本地化的可读文本。 */
interface DemoStrings {
  osName: string;
  projectShop: { name: string; note: string; tags: string[] };
  projectApi: { name: string; tags: string[] };
  taskLogin: string;
  taskLoad: string;
  taskUi: string;
  taskLoadTag: string;
  sessionFirst: string;
  sessionLast: string;
  logLines: string[];
  logFooter: string;
}

const STRINGS: Record<DemoLang, DemoStrings> = {
  en: {
    osName: "Windows 11 (demo)",
    projectShop: { name: "Storefront rewrite", note: "Demo project", tags: ["frontend", "v2"] },
    projectApi: { name: "Data platform API", tags: ["backend"] },
    taskLogin: "Redesign the sign-in page (demo)",
    taskLoad: "Load-test the API (demo)",
    taskUi: "Upgrade the component library (demo)",
    taskLoadTag: "testing",
    sessionFirst: "Switch the sign-in page to the new design",
    sessionLast: "Done, tests pass",
    logLines: [
      "2026-10-24T10:12:01.442Z  INFO  workbench_lib: workbench v0.4.0 starting",
      "2026-10-24T10:12:01.451Z  INFO  workbench_lib: tray icon created (Windows)",
      "2026-10-24T10:12:01.470Z  INFO  workbench_lib: global shortcut CmdOrCtrl+Shift+W registered",
      "2026-10-24T10:12:02.118Z  INFO  workbench::commands: 2 valid project directories registered from data.json (2 total)",
      "2026-10-24T10:12:02.240Z  INFO  workbench::cost_store: cost ledger ready at cost.db (386 records)",
      "2026-10-24T10:12:02.905Z  WARN  workbench::ai: no opencode service on 127.0.0.1:4096, skipping live sessions",
      "2026-10-24T10:12:03.331Z  INFO  workbench::ports: 3 listening ports collected (netstat -ano)",
      "2026-10-24T10:12:03.336Z  INFO  workbench::devserver: 2 dev servers recognised (vite:5173, uvicorn:8000)",
      "2026-10-24T10:12:06.412Z  INFO  workbench::commands: requested termination of PID=9876",
      "2026-10-24T10:12:06.510Z  WARN  workbench::procs: process refused termination or already exited PID=9876",
      "2026-10-24T10:12:09.002Z  INFO  workbench::session_meter: scanned 12 session files, 3 new usage records",
      "2026-10-24T10:12:12.771Z  DEBUG workbench::ipc_guard: refused to open an unregistered path: C:\\Users\\me\\secrets",
      "2026-10-24T10:12:15.203Z  INFO  workbench::commands: self-check finished 9 ok / 3 warn / 0 fail",
    ],
    logFooter: "(the above is browser demo data; real logs are written by the desktop app only)",
  },
  zh: {
    osName: "Windows 11 (演示)",
    projectShop: { name: "商城前端重构", note: "演示项目", tags: ["前端", "v2"] },
    projectApi: { name: "数据中台 API", tags: ["后端"] },
    taskLogin: "登录页改版（演示）",
    taskLoad: "接口压测（演示）",
    taskUi: "组件库升级（演示）",
    taskLoadTag: "测试",
    sessionFirst: "帮我把登录页改成新设计稿",
    sessionLast: "已完成，测试通过",
    logLines: [
      "2026-10-24T10:12:01.442Z  INFO  workbench_lib: 工作台 v0.4.0 启动",
      "2026-10-24T10:12:01.451Z  INFO  workbench_lib: 托盘创建成功 (Windows)",
      "2026-10-24T10:12:01.470Z  INFO  workbench_lib: 全局快捷键 CmdOrCtrl+Shift+W 已注册",
      "2026-10-24T10:12:02.118Z  INFO  workbench::commands: 从 data.json 登记 2 个有效项目目录（共 2 个）",
      "2026-10-24T10:12:02.240Z  INFO  workbench::cost_store: 成本库已就绪 cost.db（386 条记录）",
      "2026-10-24T10:12:02.905Z  WARN  workbench::ai: opencode 服务未监听 127.0.0.1:4096，跳过在线会话",
      "2026-10-24T10:12:03.331Z  INFO  workbench::ports: 采集监听端口 3 条（netstat -ano）",
      "2026-10-24T10:12:03.336Z  INFO  workbench::devserver: 识别开发服务器 2 个（vite:5173, uvicorn:8000）",
      "2026-10-24T10:12:06.412Z  INFO  workbench::commands: 请求终止进程 PID=9876",
      "2026-10-24T10:12:06.510Z  WARN  workbench::procs: 进程拒绝终止或已退出 PID=9876",
      "2026-10-24T10:12:09.002Z  INFO  workbench::session_meter: 扫描会话文件 12 个，新增 3 条用量记录",
      "2026-10-24T10:12:12.771Z  DEBUG workbench::ipc_guard: 拒绝打开未登记的路径: C:\\Users\\me\\secrets",
      "2026-10-24T10:12:15.203Z  INFO  workbench::commands: 环境自检完成 9 ok / 3 warn / 0 fail",
    ],
    logFooter: "（以上为浏览器演示数据，真实日志仅在桌面端写入）",
  },
  ja: {
    osName: "Windows 11 (デモ)",
    projectShop: { name: "ストアフロント刷新", note: "デモプロジェクト", tags: ["フロントエンド", "v2"] },
    projectApi: { name: "データ基盤 API", tags: ["バックエンド"] },
    taskLogin: "ログイン画面の刷新（デモ）",
    taskLoad: "API 負荷試験（デモ）",
    taskUi: "コンポーネントライブラリ更新（デモ）",
    taskLoadTag: "テスト",
    sessionFirst: "ログイン画面を新しいデザインに変更してください",
    sessionLast: "完了しました。テストは通過しています",
    logLines: [
      "2026-10-24T10:12:01.442Z  INFO  workbench_lib: workbench v0.4.0 起動",
      "2026-10-24T10:12:01.451Z  INFO  workbench_lib: トレイアイコンを作成 (Windows)",
      "2026-10-24T10:12:01.470Z  INFO  workbench_lib: グローバルショートカット CmdOrCtrl+Shift+W を登録",
      "2026-10-24T10:12:02.118Z  INFO  workbench::commands: data.json から有効なプロジェクトディレクトリを 2 件登録（全 2 件）",
      "2026-10-24T10:12:02.240Z  INFO  workbench::cost_store: コスト台帳の準備完了 cost.db（386 件）",
      "2026-10-24T10:12:02.905Z  WARN  workbench::ai: opencode サービスが 127.0.0.1:4096 で待ち受けていません。オンラインセッションをスキップ",
      "2026-10-24T10:12:03.331Z  INFO  workbench::ports: 待ち受けポートを 3 件取得（netstat -ano）",
      "2026-10-24T10:12:03.336Z  INFO  workbench::devserver: 開発サーバーを 2 件認識（vite:5173, uvicorn:8000）",
      "2026-10-24T10:12:06.412Z  INFO  workbench::commands: PID=9876 の終了を要求",
      "2026-10-24T10:12:06.510Z  WARN  workbench::procs: プロセスが終了を拒否したか既に終了しています PID=9876",
      "2026-10-24T10:12:09.002Z  INFO  workbench::session_meter: セッションファイルを 12 件走査し、使用量レコードを 3 件追加",
      "2026-10-24T10:12:12.771Z  DEBUG workbench::ipc_guard: 未登録のパスを開くことを拒否: C:\\Users\\me\\secrets",
      "2026-10-24T10:12:15.203Z  INFO  workbench::commands: セルフチェック完了 9 ok / 3 warn / 0 fail",
    ],
    logFooter: "（以上はブラウザのデモデータです。実際のログはデスクトップ版のみが書き込みます）",
  },
};

function buildData(s: DemoStrings): WorkbenchData {
  return {
    projects: [
      {
        id: "demo-p1",
        name: s.projectShop.name,
        path: "C:\\proj\\shop-web",
        status: "active",
        tags: s.projectShop.tags,
        pinned: true,
        note: s.projectShop.note,
        created_at: nowSec() - 86400 * 7,
      },
      {
        id: "demo-p2",
        name: s.projectApi.name,
        path: "C:\\proj\\data-api",
        status: "paused",
        tags: s.projectApi.tags,
        pinned: false,
        note: "",
        created_at: nowSec() - 86400 * 30,
      },
    ],
    tasks: [
      {
        id: "demo-t1",
        title: s.taskLogin,
        status: "doing",
        priority: "high",
        due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        project_id: "demo-p1",
        tags: [],
        created_at: nowSec() - 3600,
        updated_at: nowSec(),
      },
      {
        id: "demo-t2",
        title: s.taskLoad,
        status: "todo",
        priority: "normal",
        due: null,
        project_id: "demo-p2",
        tags: [s.taskLoadTag],
        created_at: nowSec() - 7200,
        updated_at: nowSec() - 7200,
      },
      {
        id: "demo-t3",
        title: s.taskUi,
        status: "done",
        priority: "low",
        due: null,
        project_id: null,
        tags: [],
        created_at: nowSec() - 86400,
        updated_at: nowSec() - 3600,
      },
    ],
  };
}

/**
 * 进程、端口、磁盘这些是机器的客观标识，与语言无关，只构造一次。
 * 数据里刻意包含父子关系（explorer → node / python、chrome → renderer），
 * 否则进程树视图在首次打开时看起来是空的。
 */
export const demoProcs: ProcInfo[] = [
  {
    pid: 900,
    name: "explorer.exe",
    exe_path: "C:\\Windows\\explorer.exe",
    cmd_line: "C:\\Windows\\explorer.exe",
    argv: ["C:\\Windows\\explorer.exe"],
    cwd: "C:\\Windows",
    cpu: 0.6,
    memory: 112 * 1024 * 1024,
    parent_pid: null,
    status: "Run",
    start_time: nowSec() - 86400 * 2,
  },
  {
    pid: 3000,
    name: "chrome.exe",
    exe_path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    cmd_line: "chrome",
    argv: ["chrome"],
    cwd: "C:\\",
    cpu: 3.1,
    memory: 260 * 1024 * 1024,
    parent_pid: null,
    status: "Run",
    start_time: nowSec() - 86400,
  },
  {
    pid: 1234,
    name: "node.exe",
    exe_path: "C:\\nodejs\\node.exe",
    cmd_line: "node C:\\proj\\shop-web\\node_modules\\vite\\bin\\vite.js --port 5173",
    argv: [
      "node",
      "C:\\proj\\shop-web\\node_modules\\vite\\bin\\vite.js",
      "--port",
      "5173",
    ],
    cwd: "C:\\proj\\shop-web",
    cpu: 8.4,
    memory: 420 * 1024 * 1024,
    parent_pid: 900,
    status: "Run",
    start_time: nowSec() - 3600,
  },
  {
    pid: 2345,
    name: "claude.exe",
    exe_path: "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe",
    cmd_line: "claude",
    argv: ["claude"],
    cwd: "C:\\Users\\me",
    cpu: 2.1,
    memory: 180 * 1024 * 1024,
    parent_pid: null,
    status: "Run",
    start_time: nowSec() - 7200,
  },
  {
    pid: 3456,
    name: "chrome.exe",
    exe_path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    cmd_line: "chrome --type=renderer",
    argv: ["chrome", "--type=renderer"],
    cwd: "C:\\",
    cpu: 12.6,
    memory: 980 * 1024 * 1024,
    parent_pid: 3000,
    status: "Run",
    start_time: nowSec() - 86400,
  },
  {
    pid: 4567,
    name: "python.exe",
    exe_path: "C:\\Python312\\python.exe",
    cmd_line: "python -m uvicorn main:app --port 8000",
    argv: ["python", "-m", "uvicorn", "main:app", "--port", "8000"],
    cwd: "C:\\proj\\data-api",
    cpu: 1.2,
    memory: 96 * 1024 * 1024,
    parent_pid: 900,
    status: "Run",
    start_time: nowSec() - 1800,
  },
];

export const demoPorts: PortEntry[] = [
  {
    protocol: "TCP",
    local_addr: "0.0.0.0",
    local_port: 5173,
    remote_addr: "0.0.0.0",
    state: "LISTENING",
    pid: 1234,
  },
  {
    protocol: "TCP",
    local_addr: "0.0.0.0",
    local_port: 8000,
    remote_addr: "0.0.0.0",
    state: "LISTENING",
    pid: 4567,
  },
  {
    protocol: "TCP",
    local_addr: "127.0.0.1",
    local_port: 4096,
    remote_addr: "0.0.0.0",
    state: "LISTENING",
    pid: 2345,
  },
];

export const demoDevs: DevServer[] = [
  {
    port: 5173,
    protocol: "TCP",
    pid: 1234,
    process_name: "node.exe",
    framework: "Vite",
    project_dir: "C:\\proj\\shop-web",
    cmd_line: "node vite.js --port 5173",
    confidence: "high",
  },
  {
    port: 8000,
    protocol: "TCP",
    pid: 4567,
    process_name: "python.exe",
    framework: "uvicorn (FastAPI/Starlette)",
    project_dir: null,
    cmd_line: "python -m uvicorn main:app --port 8000",
    confidence: "high",
  },
];

export const demoAis: AiProcess[] = [
  {
    pid: 2345,
    name: "claude.exe",
    exe_path: "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.exe",
    cmd_line: "claude",
    matched: "claude",
    memory: 180 * 1024 * 1024,
    start_time: nowSec() - 7200,
  },
];

export const demoDisks: DiskInfo[] = [
  {
    label: "C",
    mount_point: "C:\\",
    total_bytes: 512 * 1024 ** 3,
    available_bytes: 180 * 1024 ** 3,
    used_bytes: 332 * 1024 ** 3,
    is_removable: false,
  },
  {
    label: "D",
    mount_point: "D:\\",
    total_bytes: 1024 * 1024 ** 3,
    available_bytes: 640 * 1024 ** 3,
    used_bytes: 384 * 1024 ** 3,
    is_removable: false,
  },
];

export const demoCostOverview: CostOverview = {
  today_cost: 1.28,
  today_input_tokens: 380_000,
  today_output_tokens: 96_000,
  today_cache_read_tokens: 26_000,
  today_cache_creation_tokens: 6_500,
  month_cost: 18.63,
  month_input_tokens: 5_120_000,
  month_output_tokens: 1_330_000,
  month_cache_read_tokens: 380_000,
  month_cache_creation_tokens: 90_000,
  total_cost: 47.91,
  total_input_tokens: 13_260_000,
  total_output_tokens: 3_420_000,
  total_cache_read_tokens: 810_000,
  total_cache_creation_tokens: 170_000,
  record_count: 386,
  measured_count: 352,
  estimated_count: 26,
  zero_pricing_count: 8,
  daily_budget: 5,
  monthly_budget: 50,
  alert_threshold_pct: 80,
  daily_pct: 25.6,
  monthly_pct: 37.26,
  budget_exceeded: false,
};

/**
 * 14 天趋势。数值是构造的，但形状是真实的：工作日高、周末回落，
 * 让趋势图在演示时看起来像真的在跑业务，而不是一条直线。
 */
const demoTrendCosts = [
  1.12, 1.35, 0.98, 1.52, 1.44, 0.62, 0.41, 1.28, 1.31, 1.05, 1.47, 1.52, 1.18, 1.24,
];
const demoTrendInput = [
  330_000, 402_000, 305_000, 474_000, 448_000, 188_000, 119_000, 399_000, 410_000,
  316_000, 462_000, 480_000, 367_000, 388_000,
];
const demoTrendOutput = [
  90_000, 110_000, 83_000, 130_000, 123_000, 52_000, 33_000, 109_000, 112_000,
  86_000, 126_000, 131_000, 101_000, 106_000,
];
const demoTrendCounts = [18, 22, 15, 27, 9, 6, 21, 25, 19, 28, 23, 17, 24, 20];

function isoDay(offsetFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetFromToday);
  return d.toISOString().slice(0, 10);
}

export const demoCostTrend: CostTrendRow[] = demoTrendCosts.map((cost, i) => ({
  day: isoDay(demoTrendCosts.length - 1 - i),
  input_tokens: demoTrendInput[i],
  output_tokens: demoTrendOutput[i],
  cache_read_tokens: Math.round(demoTrendInput[i] * 0.06),
  cache_creation_tokens: Math.round(demoTrendInput[i] * 0.015),
  cost,
  record_count: demoTrendCounts[i],
}));

export const demoCostModelBreakdown: ModelBreakdownRow[] = [
  {
    model: "claude-sonnet-4-5",
    input_tokens: 8_640_000,
    output_tokens: 2_180_000,
    cost: 28.42,
    record_count: 214,
  },
  {
    model: "claude-opus-4-1",
    input_tokens: 1_920_000,
    output_tokens: 840_000,
    cost: 12.86,
    record_count: 96,
  },
  {
    model: "claude-haiku-4-5",
    input_tokens: 3_120_000,
    output_tokens: 440_000,
    cost: 5.13,
    record_count: 58,
  },
  {
    model: "gpt-5-codex",
    input_tokens: 420_000,
    output_tokens: 100_000,
    cost: 1.5,
    record_count: 18,
  },
];


/**
 * 演示数据的唯一入口：按界面语言返回一整套一致的样例。
 *
 * 为什么不是一堆独立的 `demoXxx` 常量：语言是横切的，散着导出就得在
 * 每个调用点重复 `demoXxx[lang]`，漏一处就又是混排。
 */
export function demoBundle(lang: DemoLang) {
  const s = STRINGS[lang] ?? STRINGS.en;
  return {
    data: buildData(s),
    procs: demoProcs,
    ports: demoPorts,
    devs: demoDevs,
    ais: demoAis,
    sessionFiles: [
      {
        tool: "Claude Code",
        project: "-proj-shop-web",
        path: "C:\\Users\\me\\.claude\\projects\\-proj-shop-web\\demo.jsonl",
        modified: nowSec() - 600,
        size: 245_000,
        message_count: 42,
        first_line: s.sessionFirst,
        last_line: s.sessionLast,
        human_preview: s.sessionLast,
      },
    ] satisfies SessionFilePreview[],
    sysinfo: {
      hostname: "DEMO-PC",
      os_name: s.osName,
      cpu_cores: 16,
      total_memory: 32 * 1024 ** 3,
      uptime_seconds: 3600 * 26,
    } satisfies SystemInfo,
    disks: demoDisks,
    costOverview: demoCostOverview,
    costTrend: demoCostTrend,
    costModelBreakdown: demoCostModelBreakdown,
    logs: [...s.logLines, s.logFooter].join("\n"),
  };
}
