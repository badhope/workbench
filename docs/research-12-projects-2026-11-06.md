# 12 个同类项目调研 → Workbench 可采纳改进

## 基线（本仓库核对）
端口页只渲染 TCP LISTENING（`Servers.tsx:59`），「打开」硬编码 `http://localhost:PORT`（`:234`）。CLI 仅 `ps/ports/diag/serve`，机器状态只读（`cli.rs:243`）。`/api` 已存在（`server.rs:111`），但 `ARCHITECTURE.md:307` 仍写「no HTTP API」。轮询 3s、隐藏即停（`store.ts:373`）；进程表 9 列固定、`aria-sort` 0 处；成本来源已分清 measured/estimated/zero_pricing（`cost_store.rs:89`）。

## 逐项目

### 1. Mission Center｜Linux 整机遥测，普通用户与运维
- Apps 页把子进程聚合为应用，同时保留 Processes 段；列可选 name/pid/cpu/mem/swap/disk/net/gpu。
- 每线程 CPU、GPU（NVTOP）、风扇、电池；systemd/OpenRC 服务可查看与控制。
- 46 个 `.po`；issue 高频是「启动慢」「显卡型号识别不到」。
- 更强：硬件深度、语言覆盖、服务控制。
- 不学：整机传感器/GPU 面板——会稀释「端口→进程→成本」，且数据源依赖平台驱动。

### 2. System Informer｜Windows 进程取证，高级用户
- 上下双窗格，下窗格切 handles/DLLs；可按 handle/DLL 反查进程。
- 网络列表带 Protocol/State 列，状态变化高亮（`netlist.c:135-148,253`）。
- Network Stack 为连接所属进程加载符号（`netstk.c:70`）；插件按能力分目录。
- 更强：句柄/DLL/调用栈、插件 API。
- 不学：内核驱动与提权句柄枚举——攻击面过大，现有「受保护名单在 Rust」已够。

### 3. btop++｜终端常驻监视器，开发者
- `pause_proc_list` + `keep_dead_proc_usage`：冻结列表但保留已退出进程最后读数（`config.cpp:155,364`）。
- `proc_tree_auto_collapse` 子进程≥N 自动折叠；`proc_follow_detailed` 详情跟随选中。
- 最多 9 套布局预设，`p` 循环；全鼠标 + 任意信号。
- 更强：常驻开销、布局预设、冻结对比。
- issue 高频：UTF-8 误报、GPU 不显示、启动卡死。
- 不学：TUI 模态菜单——GUI 照搬会出现两套交互。

### 4. Glances｜跨平台监控 + 自动化数据源
- 每插件三级阈值 careful/warning/critical（`glances.conf:174-179`，CPU 50/70/90）。
- REST `/api/5`、MCP `/mcp`、客户端/服务端；导出 20+ 后端。
- `--issue` 一键生成可粘贴 Markdown 诊断；容器（Docker/Podman/LXD）作插件。
- issue 高频：WebUI 白屏、Windows 加载卡住。
- 更强：API、导出、阈值可配。
- 不学：远端采集与外部时序库——违背「数据不出本机」；只留本地只读 API。

### 5. Stats｜macOS 菜单栏常驻
- 每指标一个菜单栏 widget，可单独开关；10 个模块目录（CPU/GPU/RAM/Disk/Net/Battery/Sensors/Bluetooth/Clock/Remote）。
- 弹窗迷你图 + 详情两级；README 明说 Sensors/Bluetooth 最贵，关掉最多省 50%。
- issue 高频：升级后崩溃、无传感器、休眠崩溃。
- 更强：常驻形态、逐模块成本披露。
- 不学：Remote 模块上传云端账号——与无账号冲突；也不必每模块都塞进菜单栏。

### 6. ccusage｜18 种编码 CLI 的 token/成本报表
- 六视图 `daily/weekly/monthly/session/blocks/statusline`。
- `--json`、`--sections daily,monthly,session`、`--by-agent` 可组合；`--since/--until/--last` 过滤。
- `--instances` 按项目聚合 + `--project` 过滤；`--offline` 缓存定价；`ccusage.json` 覆盖单价，优先级 CLI>local>user>defaults。
- 更强：源数量、时间过滤、JSON 契约。
- 不学：一次接 18 源——每源一套解析与测试，先把 Claude/Codex 做透。

### 7. Claude Code Usage Monitor｜Claude 5 小时额度预测
- `--statusline` 抓官方 `rate_limits`，过期回退本地估算。
- provenance 四档 official/local_estimate/experimental/unknown。
- `--once/--compact/--write-state` 共用带版本 snapshot 契约；`--view burn-rate`。
- `--data-paths`/`CLAUDE_CONFIG_DIR`/WSL 多目录，不跨账号合并。
- issue 高频：重置时间算错、token 不一致。
- 更强：额度预测、数字可信度标注。
- 不学：硬编码 pro/max5/max20 限额——额度会变，猜错比不显示更糟。

### 8. Process Explorer / Sysinternals｜Windows 取证 + TCPView 端点观察
- 上下双窗格；按 handle/DLL 全局搜索。
- TCPView 默认每秒刷新，新增绿/变化黄/消失红；`Options|Refresh Rate` 可调。
- `tcpvcon` 与 GUI 同能力。
- 更强：端点状态变化的视觉编码、GUI/CLI 对等。
- 不学：句柄/DLL 枚举与符号服务器——Workbench 不做调试器。

### 9. htop / bottom｜终端进程查看器
- htop：`/` 搜索、`\` 过滤、`t` 树、`.` 换排序、`k` 杀。
- bottom：`Ctrl+f` 搜索、`t/F5` 树、`d+d` 杀、`s/F6` 排序。
- `P` 切命令行、`%` 切百分比、`Tab` 合并同名、`z` 隐藏内核线程、`e` 放大单 widget、`f` 冻结。
- `?` 呼出全部快捷键。
- 更强：单键直达、快捷键自解释。
- 不学：纯键盘无鼠标——Workbench 应双优。

### 10. Portmaster / lsof UI（Sloth、PortsMonitor）｜按应用看/控连接
- Portmaster：作用域 Localhost/LAN/Internet/P2P/Inbound，按应用定规则。
- Sloth：按名称/访问模式/卷/类型/正则过滤，按进程名/文件数/PID/UID 排序，显示 socket 状态/协议/端口/版本。
- PortsMonitor：连接按应用分组、IPv4/IPv6+TCP/UDP 快捷过滤、新连接通知可排除应用。
- 列布局/配色/过滤配置可存，历史落 CSV。
- 更强：连接生命周期与按应用分组。
- 不学：包过滤/防火墙——需内核驱动，与只读观察冲突，还会和安全软件打架。

### 11. OrbStack / Docker Desktop｜容器运行时 + 图形管理
- `container.orb.local`、`service.project.orb.local` 自动域名；`@port` 指定端口。
- 用 `OrbStack-Server-Detection` 探针自动找 Web 端口，结果缓存到容器变更；失败用 `dev.orbstack.http-port` 钉住。
- Docker Desktop 列可显示/隐藏/重排并跨会话记忆；Compose 分组折叠。
- 端口一键浏览器打开；日志正则过滤、Exec、Stats。
- 更强：端口能否打开的判断、列配置持久化。
- 不学：自带容器运行时/K8s——范围爆炸；但应识别容器进程并归组。

### 12. Raycast / uTools｜启动器式工作台 + 插件生态
- Raycast manifest：commands 带 `mode`(view/no-view/menu-bar)、`arguments`(text/password/dropdown)、`preferences`。
- `interval` 后台刷新最小 10s；Action Panel 同一结果挂多动作；Aliases & Hotkeys、Quicklinks。
- uTools `plugin.json`：`features[].code/cmds`，功能指令≤5，匹配指令 regex/over/img/files/window。
- 动态 feature `getFeatures/setFeature`；`onPluginEnter/onScheduleTrigger`；中文自动拼音首字母。
- 更强：动作模型、匹配指令、扩展面。
- 不学：第三方插件市场与任意 Node 权限——供应链与提权风险；先用内置动作注册表。

## 可采纳改进清单

### 进程/端口视图
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 连接表补 UDP + ESTABLISHED + 远端地址，状态变化高亮 | 现只显示 TCP LISTENING；TCPView/PortsMonitor 证明「新出现/刚消失」才是排障信号 | 中 | 无 |
| 「打开」前探测 HTTP，失败回退复制 URL，支持 IPv6 | 现硬编码 `http://localhost:PORT`，非 HTTP 服务全错 | 低 | 无 |
| 端口固定 + 新端口通知，可按应用排除 | PortsMonitor 核心用法，防「端口被谁抢」 | 低-中 | 无 |
| 表头点击排序、列显示/隐藏/重排持久化 | Docker Desktop 与 Mission Center 都视列配置为基础能力 | 低 | 无 |
| 快照冻结对比，保留已退出进程读数 | btop 的抓峰值用法 | 低 | 无 |

### AI 会话与成本
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 预算与 `alert_threshold` 画成趋势图阈值线 | Glances 三级阈值比单一告警可读 | 低 | 无 |
| 5 小时 block 配速与预计耗尽，标 `local_estimate` | Claude Monitor 最大价值点 | 中 | 无 |
| `cost_source` 升级为徽标，按来源过滤，cache read/creation 分开趋势 | 数据已有，只差呈现 | 低 | 无 |
| 支持 `CLAUDE_CONFIG_DIR`/`CODEX_HOME`/额外目录/WSL | ccusage 与 Claude Monitor 都这么做；现只扫固定 home（`ai.rs:759`） | 中 | 无 |

### CLI 与脚本化
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| `workbench cost --json --since --until --by-project`、`watch`(NDJSON)、`diag --markdown` | 成本是核心资产，CLI 却完全没有 | 中 | 无 |
| JSON 加 `schema_version`/`generated_at`，补 bash/zsh/fish 补全 | 脚本消费需要稳定契约 | 低 | 无 |

### 数据可视化
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 趋势图时间窗缩放/框选与重置 | bottom 的时间轴缩放让长区间可读 | 中 | 无 |
| 单点/空态不画趋势线；阈值线用语义色 | 减少误导 | 低 | 无 |

### 键盘与命令面板
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 命令面板升级为动作面板，每条挂 2–4 动作，`Tab` 展开 | Raycast Action Panel 的核心 | 中 | 无 |
| `?` 快捷键总表；全局快捷键可配 | 现仅硬编码 CmdOrCtrl+Shift+W（`lib.rs:84`） | 低 | 无 |
| 中文拼音首字母匹配 | uTools 的本地做法 | 低-中 | 无 |

### 性能与资源占用
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 按页面订阅采集，非当前页只留摘要 | 3s 一轮四命令全量快照不适合常驻 | 中 | 无 |
| 设置页披露每模块采集耗时并可逐项关闭 | Stats 的诚实披露 | 低 | 无 |
| 端口采集改原生 API（`GetExtendedTcpTable`/netlink），netstat 兜底 | 去掉子进程开销 | 高 | 无 |

### 可访问性
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 表格补 `scope`/`caption`/`aria-sort`；面板补 `aria-activedescendant` | 现 0 处 `aria-sort`，listbox 无 activedescendant | 低 | 无 |
| 端口卡片收敛为单一可聚焦元素 + 内联动作菜单；补 `forced-colors` 回退 | 现一卡多按钮、Tab 序碎 | 低 | 无 |

### 国际化
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| `Intl.PluralRules` 处理英文单复数；日期/数字/字节全量走 locale | 字典无复数键，仅 2 处 `toLocaleString` | 低 | 无 |
| 托盘跟随语言；词典可导出/导入 JSON 供社区翻译 | `ARCHITECTURE.md:305` 自认托盘写死双语 | 低-中 | 无 |

### 错误诊断与可观测性
| 改进点 | 为什么值得做 | 成本 | 冲突 |
|---|---|---|---|
| 每页显示数据来源、采集耗时、上次成功时间；回退路径明示 | Glances `--issue` 的可解释性 | 低 | 无 |
| 端口 PID 归属失败分因（权限/已退出/解析） | 现只显示 PID 0 | 低 | 无 |
| ~~修 `ARCHITECTURE.md:307` 与 `server.rs:111` 的矛盾~~ **已于 0.7.0 修复**（三语架构文档同步更正） | 文档漂移损害「可核实」信誉 | 低 | 无 |

明确不做：远端多机监控、整机传感器/GPU 面板、内核包过滤、插件市场、一次接 18 源——分别违背本地优先、稀释三链定位、驱动攻击面、供应链风险、维护成本。

## 建议顺序
先做 HTTP 探测、端口固定、成本徽标、列配置、可访问性与 i18n；再做连接表、`cost` CLI、动作面板；最后原生端口采集与按页订阅。

## 核实方式与边界

本文的每条功能判断都来自各项目 2026-10 至 2026-11 的官方文档、README 或源码，
不是凭印象归纳：

- GitHub 项目用 API 取 README 与源码文件（raw 域名在部分网络下不通，走 API 绕开）；
- Mission Center 是 GitLab 仓库，同样用 GitLab API 取源码；
- 「issue 高频抱怨」取自各仓库按评论数排序的已关闭或开启 issue，不是随机抽查。

**未取到 / 未核实**：

- OrbStack 的 `orbctl` 完整命令清单未取到：文中只写了能核实的本地域名规则、
  Web 端口探针与配置键，更细的 CLI 语法一律标为未核实。
- Portmaster 的 UI 截图页未取到：文中只写了作用域模型与「按应用定规则」这一
  可从文档证实的部分，界面细节不做描述。
- uTools 的 `plugin.json` 字段来自官网编译后的文档页（原始 `.html` 路径已 404）。

这份调研的用途是「值得学什么」，不是「对方一定长这样」。落地任何一条之前，
应当回到对应项目的仓库核对当前实现。
