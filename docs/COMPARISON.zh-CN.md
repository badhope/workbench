# 与同类工具对比

与 Workbench 常被一起比较的工具做一次诚实对照。下表的功能判断取自各项目
2026 年 10 月的官方文档与仓库，链接直接放在表头；Workbench 一列描述的是本仓库
的现状，不是计划。

## 功能矩阵

● 具备 · ◐ 部分/间接 · ○ 不具备

| | Workbench | [Mission Center](https://gitlab.com/mission-center-devs/mission-center) | [System Informer](https://systeminformer.com/) | [btop++](https://github.com/aristocratos/btop) | [Glances](https://github.com/nicolargo/glances) | [Stats](https://github.com/exelban/stats) | [ccusage](https://ccusage.com/) | [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |
|---|---|---|---|---|---|---|---|---|
| 进程表 | ● | ● | ● | ● | ● | ◐ | ○ | ○ |
| 进程树 | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| 端口 → 所属进程 | ● | ○ | ● | ○ | ◐ | ○ | ○ | ○ |
| 开发服务器识别 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 项目登记 + 任务看板 | ● | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| AI 会话成本账本 | ● | ○ | ○ | ○ | ○ | ○ | ● | ● |
| 预算告警 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| 提权结束进程 | ● | ○ | ● | ◐ | ◐ | ○ | ○ | ○ |
| 托盘 + 开机自启 | ● | ○ | ● | ○ | ○ | ● | ○ | ○ |
| 超出明暗两档的主题系统 | ● | ◐ | ◐ | ● | ◐ | ◐ | ○ | ○ |
| 三语及以上界面 | ● | ● | ○ | ○ | ○ | ● | ○ | ○ |
| 键盘命令面板 | ● | ○ | ○ | ◐ | ○ | ○ | ◐ | ○ |
| CSV 导出 | ● | ○ | ● | ◐ | ● | ○ | ● | ● |
| 浏览器/网页模式 | ●（本地实时） | ○ | ○ | ○ | ● | ● | ○ | ○ |
| 可脚本化 CLI | ● | ○ | ◐ | ◐ | ● | ○ | ● | ● |
| 插件/扩展 API | ○ | ○ | ● | ○ | ● | ○ | ◐ | ○ |
| 自动更新 | ○ | ○ | ● | ○ | ◐ | ● | ○ | ○ |
| 许可证 | MIT | GPL-3.0 | MIT | Apache-2.0 | LGPL-3.0 | MIT | MIT | MIT |

## 别人更强的地方

只说自己强没有意义，下面这些是对方确实做得更好的部分。

- **Mission Center** 的机器遥测比 Workbench 深：每线程 CPU、GPU（NVTOP）、风扇、
  传感器，以及把子进程聚合到应用下同时保留进程树的 Apps 页。经 Weblate 维护
  45 种语言，并被多个 Linux 发行版预装。Workbench 没有 GPU 与传感器页。
- **System Informer** 是 Windows 进程取证的事实标准：句柄、DLL、调用栈、服务、
  带「Go to Process」的 Network Stack，以及插件 API。Workbench 每个进程能看到
  的字段远少于它，也无法查看句柄。
- **btop++** 是更好的「常驻监视器」：体积极小、支持鼠标、可发信号、41 个主题文件。
  Workbench 是打开来用的应用，不是长期挂在终端面板里的 TUI。
- **Glances** 赢在自动化：有文档化的 REST API、MCP server、客户端/服务端模式和
  CSV/JSON 导出。Workbench 没有 API，也没有远程模式。
- **Stats** 是 macOS 菜单栏监视的代表：13 种菜单栏组件，并在说明里列出仅有的
  两个外部 API。Workbench 的 macOS 产物只在 CI 构建，且未签名。
- **ccusage** 用一条命令覆盖 18 种编码代理，`--instances` 可按项目聚合。
  Workbench 目前只读 Claude Code 与 Codex 的会话文件。
- **Claude Code Usage Monitor** 会预测 5 小时额度耗尽，并区分 `official` 与
  `local_estimate`。Workbench 会在账本行标注 measured / estimated / zero-pricing，
  但不做额度预测。

## Workbench 不同的地方

1. **一个窗口接起三层信息。** 监听端口能跳到占用它的进程，进程详情反过来列出它的
   全部端口，成本账本又能落到产生花费的会话文件。上面这些工具没有一个把机器状态
   和 AI 会话花费接在一起。
2. **它懂开发服务器。** Vite、Next、Nuxt、Django、uvicorn、Rails 等 30+ 框架从命令行
   识别，带置信度，并以「开发服务器」而不是裸端口呈现。
3. **安全是实现的，不是描述的。** 受保护进程名单在 Rust 里，结束前重新校验目标身份，
   UAC 提权按次授权、其它平台直接拒绝，环境自检报告它实际验证了什么。
4. **它承认自己做不到什么。** 没有代码签名、没有自动更新、没有插件 API、没有远程监控——
   这些写在 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md) 的缺口清单里，而不是藏起来。

## 怎么选

| 你的需求 | 选择 |
|---|---|
| Linux 硬件深度遥测 | Mission Center |
| Windows 进程取证 | System Informer |
| 终端里的常驻监视 | btop++ / Glances |
| macOS 菜单栏统计 | Stats |
| 跨多个 CLI 的代理花费 | ccusage |
| 只看 Claude 的额度预测 | Claude Code Usage Monitor |
| 端口 + 开发服务器 + AI 花费，一个桌面应用里看全 | Workbench |
