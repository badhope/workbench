# 工程结构与模块边界

> 适用版本：`0.9.x`。本文件是模块归属与依赖方向的唯一约定；新增目录前先改这里，再改代码。

## 1. 三入口与单一实现

```
┌────────────┐   ┌────────────┐   ┌────────────┐
│ Tauri 桌面  │   │ Web (`serve`)│  │ CLI        │
└─────┬──────┘   └─────┬──────┘   └─────┬──────┘
      │ IPC            │ HTTP           │ 直接调用
      └────────┬───────┴────────────────┘
               ▼
      Rust 领域层（procs / ports / devserver / cost_store / data / ai …）
               ▲
               │ 同一套函数
      commands.rs（薄 IPC 适配）   server.rs（薄 HTTP 适配）
```

**硬规则：业务逻辑只能有一份。** `commands.rs` 与 `server.rs` 只做参数解码、状态校验、错误映射；进程/端口/开发服务器/opencode 探测/成本查询全部调用 `runtime.rs`、`procs.rs`、`cost_store.rs`。

## 2. 前端目录与依赖方向

```
src/
├─ navigation.tsx        # 页面注册表：唯一允许知道所有 pages 的地方（仅动态 import）
├─ App.tsx               # 外壳 + 路由
├─ pages/                # 页面与页面内聚组件
│  ├─ today/             # 首页壳拆出的 Header/QuickCapture/Attention/Project/TaskList/Rails
│  ├─ servers/           # PortGrid / PortsCard / DevServerList
│  ├─ overview/widgets/  # 图表 / 列表 / 环仪瓦片三组，一眼能定位
│  └─ ai/                # AI 会话、成本、定价
├─ components/           # 跨页面可复用 UI（不含业务数据获取）
├─ lib/                  # 无 UI 的纯逻辑 / 传输 / 状态
│  ├─ api.ts             # 唯一 Tauri invoke / HTTP 客户端
│  ├─ store/             # Zustand 装配入口 + 四组 action + 持久化控制器
│  │  ├─ index.ts        # 初始态 / persist / 公开导出
│  │  ├─ types.ts        # UiState / RuntimeState / Store
│  │  ├─ helpers.ts      # 迁移、动效、快照补齐等纯函数
│  │  ├─ persistence.ts  # 防抖、在途队列、恢复/丢弃状态机
│  │  ├─ uiActions.ts    # 主题 / 布局 / 偏好
│  │  ├─ dataActions.ts  # 任务 / 项目 / 备份恢复
│  │  ├─ runtimeActions.ts # 进程 / 端口 / AI / 磁盘
│  │  └─ costActions.ts  # 成本计量
│  ├─ export.ts          # CSV 编码 + 下载 + 文件名时间戳
│  └─ importBackup.ts    # 外部备份校验
├─ ui.tsx                # 基础控件（Button / Card / Modal …）
└─ generated/            # ts-rs 生成，不手改
```

依赖方向：

- `pages → components / lib / ui`；
- `components → lib / ui`；
- `lib → lib`，**禁止** `lib` / `components` 反向 import `pages`；
- `navigation.tsx` 是唯一页面聚合点，且只能 `import()` 懒加载；
- 只有 `src/lib/api.ts` 可以 import `@tauri-apps/api/core`；窗口事件、WebView 缩放等非传输调用单独豁免并有注释。

门禁脚本会检查上述三条（反向依赖、绕过 navigation、Tauri core 泄漏）。

## 3. 已合并的重复点（防止回潮）

| 原先重复                                                                  | 现在唯一实现                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `commands.rs` 与 `runtime.rs` 各自维护端口 TTL、PID 索引、dev-server 组装 | `runtime::{cached_ports, pid_index, collect_dev_servers}`        |
| IPC / HTTP 各自写一遍 opencode 端口发现与逐个尝试                         | `runtime::probe_opencode`                                        |
| 7 个成本命令各自“加锁 + 解析 DataRoot + 查询”                             | `commands::run_cost`                                             |
| `Settings.tsx parseBackup` 圈复杂度 32                                    | `lib/importBackup.ts`（结构/版本/项目/任务分层）                 |
| `AppearancePanel` 与 `OnboardingOverlay` 各一份动效档位按钮               | `components/MotionSelector.tsx`                                  |
| TCP / UDP 端口卡片各写一遍 CSV、空态、网格                                | `pages/servers/PortsCard.tsx` + `PortGrid.tsx`                   |
| `processFilter.ts` 与 `processes/tree.ts` 各一份排序比较器                | `processFilter::compareProcs`                                    |
| Processes / Servers 各拼一遍导出文件名与时间戳                            | `lib/export::{downloadCsv, timestampForFilename}`                |
| `store.ts` 多处“清防抖 + 等队列 + 写 pending”                             | `drainPendingData()`                                             |
| `store.ts` 多处快照补空字段                                               | `mergeSnapshot()`                                                |
| `Tasks.tsx` 列表/看板各一份“今天/本周补到期日”                            | `defaultDueForScope()`                                           |
| 进程终止普通/提权两套身份校验                                             | `procs::{identity_matches, validate_termination_target}`         |
| 终止进程/提权/清空成本各自判 `isTauri()` 再抛错                           | `api::requireDesktop()`                                          |
| 三个入口分散 `invoke`（AppHeader / useAppRuntime / main）                 | 全部走 `lib/api.ts`，`ipcContract.test.ts` 强制单文件            |
| `components/lib/types` 反向 import `pages/registry`                       | 页面注册表上移到 `src/navigation.tsx`                            |
| 旧版 `load_data` IPC / `api.loadData`                                     | 删除，只保留带 generation 的 `load_data_versioned`；E2E 同步切换 |
| `existing_keys` 假增量扫描接口                                            | 删除；成本扫描明确为全量读，避免 mtime/size 误跳过               |
| 每 3 秒枚举磁盘挂载点                                                     | `disk_info_blocking` 加 30 秒缓存                                |
| 原子写只 fsync 文件                                                       | rename 后 Unix 下再 fsync 父目录                                 |
| 成本扫描无进度                                                            | `cost-scan-progress` 事件按文件上报，成本页显示 done/total       |

新增同类能力时，先查上表；能进已有模块就不开新文件。

## 4. 质量门禁

提交前必须全绿：

```bash
npm run check:modules      # 依赖方向 / Tauri core 泄漏 / Rust 重复采集
npx tsc --noEmit
npm run lint
npx vitest run
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --test export_bindings   # 有类型变更时必须跑，并提交 generated/
npm run version:check
npm run icons:check
npm run dup                        # jscpd 阈值 3%
```

工具链固定为 `rust-toolchain.toml` 的 `1.95.0`（与 `Cargo.toml` 的 `rust-version` 一致）；CI 与 release 同样使用 `dtolnay/rust-toolchain@1.95.0`。升级 MSRV 时三处同步改。

`vitest.config.mts` 固定 `pool: "vmThreads"`：默认 forks 每个测试文件重建一次 jsdom，全量实测约 1281s；vmThreads 仍按文件隔离，实测约 80s。不要为了“更稳”改回 forks，那只是把 20 分钟的反馈环重新引回来。

覆盖率口径：`npm run coverage` 只承诺 `src/lib/**`、`src/ui.tsx`、`src/ErrorBoundary.tsx` 的 90/85/90/90 阈值；`src/pages/**` 由 Playwright 结构回归与桌面 E2E 覆盖，不把页面塞进 lib 阈值里制造“全应用 90%”的误读。

重复率基线（`jscpd --min-tokens 30`）：改造前 38 处 / 315 行 / 1.35%；当前 8 处 / 82 行 / 0.28%（生产代码 0 处，剩余为测试文件的共享导入/断言样板）。`npm run dup` 的 3% 阈值是防止回潮的上限，不是目标值。

## 5. 变更流程

1. **先定归属**：改的是领域逻辑（Rust 模块）、传输（api.ts）、状态（store）、页面内聚组件，还是跨页 UI（components）。
2. **查重复表**：新逻辑是否已有唯一实现；没有则先抽到对应层，再改调用方。
3. **补测试**：纯函数单测优先；跨入口行为（IPC / HTTP）至少各一条契约测试。
4. **跑门禁**：上面的命令逐条跑；类型变更后重新生成 `src/generated/`。
5. **更新本文**：新增模块或改变依赖方向时，先改文档再合代码。

## 6. 体量债务已清零

原先四个超 800 行的文件已按职责拆开，门禁当前 **0 个体量警告**：

- `src/lib/store.ts` 1386 行 → `store/` 下 8 个模块，最大 `runtimeActions.ts` 279 行；持久化状态机单独封装为 `Persistence`，action 不再直接摸模块级变量。
- `src/pages/Today.tsx` 1070 行 → 页面壳 383 行 + `today/` 下 7 个内聚组件，最大 `Rails.tsx` 200 行。
- `src/pages/overview/widgets.tsx` 905 行 → `overview/widgets/` 下 `charts/lists/orbit/WidgetFrame`，最大 380 行。
- `src/lib/store.runtime.test.ts` 836 行 → `store.runtime.test.ts` 342 行 + `store.cost.test.ts` 349 行 + `store.persistence.test.ts` 93 行；API mock 与重置收敛到 `storeTestHarness.ts`。
- P2 收口：删除旧 `load_data`/`loadData` 与假增量接口；磁盘枚举 30 秒缓存；Unix 原子写补父目录 fsync；成本扫描按文件发 `cost-scan-progress`；定价搜索/单元格补 `aria-label`。

拆分只搬代码与收口状态边界，不改外部行为：拆后全量 **58 文件 / 613 项**仍全绿。新增模块若超过 800 行，先按职责拆，不要靠调高告警阈值。
