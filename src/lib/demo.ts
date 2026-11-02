/**
 * 浏览器预览模式（非 Tauri）下的静态演示数据。
 * 仅在 window.__TAURI_INTERNALS__ 不存在时使用，让 UI 可以离线演示；
 * 桌面端永远走真实 IPC，不会读取这里。
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

const nowSec = () => Math.floor(Date.now() / 1000);

export const demoData: WorkbenchData = {
  projects: [
    {
      id: "demo-p1",
      name: "商城前端重构",
      path: "C:\\proj\\shop-web",
      status: "active",
      tags: ["前端", "v2"],
      pinned: true,
      note: "演示项目",
      created_at: nowSec() - 86400 * 7,
    },
    {
      id: "demo-p2",
      name: "数据中台 API",
      path: "C:\\proj\\data-api",
      status: "paused",
      tags: ["后端"],
      pinned: false,
      note: "",
      created_at: nowSec() - 86400 * 30,
    },
  ],
  tasks: [
    {
      id: "demo-t1",
      title: "登录页改版（演示）",
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
      title: "接口压测（演示）",
      status: "todo",
      priority: "normal",
      due: null,
      project_id: "demo-p2",
      tags: ["测试"],
      created_at: nowSec() - 7200,
      updated_at: nowSec() - 7200,
    },
    {
      id: "demo-t3",
      title: "组件库升级（演示）",
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

export const demoSessionFiles: SessionFilePreview[] = [
  {
    tool: "Claude Code",
    project: "-proj-shop-web",
    path: "C:\\Users\\me\\.claude\\projects\\-proj-shop-web\\demo.jsonl",
    modified: nowSec() - 600,
    size: 245_000,
    message_count: 42,
    first_line: "帮我把登录页改成新设计稿",
    last_line: "已完成，测试通过",
    human_preview: "已完成，测试通过",
  },
];

export const demoSysinfo: SystemInfo = {
  hostname: "DEMO-PC",
  os_name: "Windows 11 (演示)",
  cpu_cores: 16,
  total_memory: 32 * 1024 ** 3,
  uptime_seconds: 3600 * 26,
};

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

// ── 成本计量（演示）────────────────────────────────────────
// 数字均为构造值，不代表任何真实账户消费。

export const demoCostOverview: CostOverview = {
  today_cost: 1.284,
  today_input_tokens: 412_000,
  today_output_tokens: 96_500,
  today_cache_read_tokens: 1_820_000,
  today_cache_creation_tokens: 240_000,
  month_cost: 18.63,
  month_input_tokens: 5_640_000,
  month_output_tokens: 1_280_000,
  month_cache_read_tokens: 24_100_000,
  month_cache_creation_tokens: 3_150_000,
  total_cost: 47.91,
  total_input_tokens: 14_200_000,
  total_output_tokens: 3_460_000,
  total_cache_read_tokens: 61_500_000,
  total_cache_creation_tokens: 8_020_000,
  record_count: 386,
  measured_count: 352,
  estimated_count: 26,
  zero_pricing_count: 8,
  daily_budget: 5,
  monthly_budget: 50,
  alert_threshold_pct: 80,
  daily_pct: 25.68,
  monthly_pct: 37.26,
  budget_exceeded: false,
};

/**
 * 近 14 天趋势（构造值，形状贴近真实扫描结果）。
 * 日期按「今天往前推」动态生成：写死日期会让 demo 在几周后变成一屏过期数据，
 * 且必须保持后端契约的 YYYY-MM-DD 格式（趋势图取 slice(5) 显示 MM-DD）。
 */
const demoTrendCosts = [
  0.912, 1.176, 0.744, 1.462, 0.418, 0.271, 1.084, 1.328, 1.132, 1.504, 1.248, 1.006,
  1.268, 1.284,
];

const demoTrendTokens = [
  [320_000, 78_000, 1_100_000, 160_000],
  [410_000, 96_000, 1_540_000, 210_000],
  [268_000, 61_000, 980_000, 130_000],
  [512_000, 124_000, 2_050_000, 280_000],
  [148_000, 36_000, 520_000, 74_000],
  [96_000, 22_000, 340_000, 48_000],
  [382_000, 91_000, 1_420_000, 195_000],
  [466_000, 112_000, 1_780_000, 245_000],
  [398_000, 95_000, 1_460_000, 198_000],
  [524_000, 128_000, 2_140_000, 292_000],
  [442_000, 104_000, 1_690_000, 228_000],
  [356_000, 84_000, 1_320_000, 178_000],
  [448_000, 108_000, 1_720_000, 232_000],
  [412_000, 96_500, 1_820_000, 240_000],
];

const demoTrendCounts = [18, 22, 15, 27, 9, 6, 21, 25, 19, 28, 23, 17, 24, 20];

function isoDay(offsetFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetFromToday);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const demoCostTrend: CostTrendRow[] = demoTrendCosts.map((cost, i) => {
  const [input, output, cacheRead, cacheCreation] = demoTrendTokens[i];
  return {
    day: isoDay(i - demoTrendCosts.length + 1),
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    cost,
    record_count: demoTrendCounts[i],
  };
});

/**
 * 浏览器演示模式下的日志样例。
 *
 * 真实日志由 Rust 侧写入 app data 目录，浏览器里没有后端可读；
 * 输出一句「不可用」会让日志页在演示/截图里变成一整块空白，
 * 也让人误以为功能坏了。这里给一段形状真实的样例并明确标注是演示数据。
 */
export const demoLogs = [
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
  "（以上为浏览器演示数据，真实日志仅在桌面端写入）",
].join("\n");

/** 按模型分解（构造值）。 */
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
    input_tokens: 2_120_000,
    output_tokens: 640_000,
    cost: 12.86,
    record_count: 58,
  },
  {
    model: "claude-haiku-4-5",
    input_tokens: 3_040_000,
    output_tokens: 520_000,
    cost: 5.13,
    record_count: 96,
  },
  {
    model: "gpt-5-codex",
    input_tokens: 400_000,
    output_tokens: 120_000,
    cost: 1.5,
    record_count: 18,
  },
];
