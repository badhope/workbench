import { useEffect, useMemo, useState } from "react";
import { Cpu, Download, ListTree, MemoryStick, Rows3, Search } from "lucide-react";
import { EChart } from "../lib/echarts";
import { seriesColors } from "../lib/chartTheme";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { Btn, Card, ErrorState, SkeletonCard, Spinner, StatCard, inputCls } from "../ui";
import { formatBytes } from "../lib/util";
import { cpuHistogram, memoryHistogram } from "../lib/aggregate";
import { filterProcs, type ProcSortKey } from "./processFilter";
import { ProcessTable } from "./processes/ProcessTable";
import { buildForest, flattenTree, type TreeNode } from "./processes/tree";
import { useT } from "../lib/i18n";
import { downloadText, toCsv } from "../lib/export";
import type { Bucket } from "../lib/aggregate";
import type { ProcInfo } from "../types";
import type { EChartsCoreOption } from "echarts/core";

const SORTS: { key: ProcSortKey; labelKey: string }[] = [
  { key: "cpu", labelKey: "procs.sortCpu" },
  { key: "memory", labelKey: "procs.sortMemory" },
  { key: "pid", labelKey: "procs.sortPid" },
  { key: "name", labelKey: "procs.sortName" },
];

const CHIPS = [
  ["all", "procs.chipAll"],
  ["ai", "procs.chipAi"],
  ["dev", "procs.chipDev"],
] as const;

type Chip = "all" | "ai" | "dev";

export default function Processes() {
  const t = useT();
  const {
    procs,
    devs,
    ais,
    loading,
    runtimeError,
    refreshRuntime,
    theme,
    procView,
    setProcView,
    procQuery,
    setProcQuery,
    focusPid,
    setFocusPid,
    setToast,
  } = useStore(
    useShallow((s) => ({
      procs: s.procs,
      devs: s.devs,
      ais: s.ais,
      loading: s.loading,
      runtimeError: s.runtimeError,
      refreshRuntime: s.refreshRuntime,
      theme: s.theme,
      procView: s.procView,
      setProcView: s.setProcView,
      procQuery: s.procQuery,
      setProcQuery: s.setProcQuery,
      focusPid: s.focusPid,
      setFocusPid: s.setFocusPid,
      setToast: s.setToast,
    }))
  );
  const [sort, setSort] = useState<ProcSortKey>("cpu");
  const [chip, setChip] = useState<Chip>("all");
  // null = 用户还没动过：树形默认展开根节点这一层（全收起像「进程只剩几个」，
  // 全展开又会让上千行一次铺满）。用户点过一次之后就用他自己的集合。
  const [expanded, setExpanded] = useState<Set<number> | null>(null);

  // 跳转高亮只亮一次：用户开始操作后清掉，否则那一行会一直像被选中。
  useEffect(() => {
    if (focusPid === null) return;
    const id = setTimeout(() => setFocusPid(null), 4000);
    return () => clearTimeout(id);
  }, [focusPid, setFocusPid]);

  const aiPids = useMemo(() => new Set(ais.map((a) => a.pid)), [ais]);
  const devPids = useMemo(() => new Set(devs.map((d) => d.pid)), [devs]);
  const filteredProcs = useMemo(
    () => filterProcs(procs, { query: procQuery, chip, sort, aiPids, devPids }),
    [procs, procQuery, chip, sort, aiPids, devPids]
  );

  // 树形视图要展示完整父子关系：筛掉父节点会让子节点全变成孤儿，
  // 所以层级始终基于全量快照构建，只对渲染行做筛选后的可达集合裁剪。
  const forest = useMemo(
    () => (procView === "tree" ? buildForest(procs, sort) : []),
    [procView, procs, sort]
  );
  const rows = useMemo(() => {
    if (procView === "flat") {
      return filteredProcs.map((p) => ({ p, depth: 0, hasChildren: false }));
    }
    const effectiveExpanded = expanded ?? new Set(forest.map((n) => n.p.pid));
    return treeRowsFor(
      forest,
      effectiveExpanded,
      new Set(filteredProcs.map((p) => p.pid))
    );
  }, [procView, filteredProcs, forest, expanded]);

  const colors = useMemo(() => seriesColors(theme), [theme]);
  const cpuChart = useMemo(() => histogram(cpuHistogram(procs), colors), [procs, colors]);
  const memChart = useMemo(
    () => histogram(memoryHistogram(procs), colors),
    [procs, colors]
  );

  const exportRows = () => {
    const header = [
      "pid",
      "name",
      "cpu_pct",
      "memory_bytes",
      "status",
      "parent_pid",
      "start_time",
      "exe_path",
      "cmd_line",
    ];
    const body = filteredProcs.map((p) => [
      p.pid,
      p.name,
      p.cpu.toFixed(1),
      p.memory,
      p.status,
      p.parent_pid ?? "",
      new Date(p.start_time * 1000).toISOString(),
      p.exe_path,
      p.cmd_line,
    ]);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadText(`workbench-processes-${stamp}.csv`, toCsv([header, ...body]));
    setToast(t("procs.exported", { count: body.length }));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 首次加载：进程表还没数据时给骨架，而不是四张 0 卡 + 空图表 */}
      {procs.length === 0 && loading && !runtimeError && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SkeletonCard rows={2} />
          <SkeletonCard rows={2} />
          <SkeletonCard rows={2} />
          <SkeletonCard rows={2} />
        </div>
      )}

      {/* 采集失败：内联可重试，而不是只弹一个几秒后消失的 toast */}
      {runtimeError && procs.length === 0 && (
        <ErrorState
          onRetry={() => void refreshRuntime()}
          retryLabel={t("app.refreshNow")}
        >
          {t("procs.loadFailed", { err: runtimeError })}
        </ErrorState>
      )}

      <Summary procs={procs} />
      <Distribution cpu={cpuChart} mem={memChart} />

      <Card className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[160px] flex-1 sm:min-w-[220px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim"
          />
          <input
            className={`${inputCls} pl-8`}
            aria-label={t("procs.searchPlaceholder")}
            placeholder={t("procs.searchPlaceholder")}
            value={procQuery}
            onChange={(e) => setProcQuery(e.target.value)}
          />
        </div>
        <ChipFilter chip={chip} onPick={setChip} />
        <SortSelect sort={sort} onPick={setSort} />
        <ViewToggle view={procView} onPick={setProcView} />
        <span className="text-xs text-dim">
          {loading ? (
            <Spinner />
          ) : (
            t("procs.procCount", { shown: filteredProcs.length, total: procs.length })
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Btn
            onClick={exportRows}
            className="!py-1 !text-xs"
            title={t("procs.exportCsv")}
          >
            <Download size={12} /> {t("procs.exportCsv")}
          </Btn>
          <Btn onClick={refreshRuntime} className="!py-1 !text-xs">
            {t("procs.refresh")}
          </Btn>
        </div>
      </Card>

      <Card>
        <ProcessTable
          rows={rows}
          aiPids={aiPids}
          devPids={devPids}
          canClear={Boolean(procQuery) || chip !== "all"}
          onClearFilter={() => {
            setProcQuery("");
            setChip("all");
          }}
          focusPid={focusPid}
          expandedNodes={
            procView === "tree"
              ? (expanded ?? new Set(forest.map((n) => n.p.pid)))
              : undefined
          }
          onToggleNode={(pid) =>
            setExpanded((cur) => {
              const base = cur ?? new Set(forest.map((n) => n.p.pid));
              const next = new Set(base);
              if (next.has(pid)) next.delete(pid);
              else next.add(pid);
              return next;
            })
          }
        />
      </Card>
      <p className="px-1 text-[11px] text-dim">
        {procView === "tree" ? t("procs.treeHint") : t("procs.tableHint")}
      </p>
      {procView === "tree" && (
        <span className="sr-only" aria-live="polite">
          {t("procs.procCount", { shown: rows.length, total: procs.length })}
        </span>
      )}
    </div>
  );
}

/**
 * 树形行 + 筛选裁剪。
 *
 * 有筛选词时保留三类节点：命中节点、它的祖先（否则子进程失去缩进语境）、
 * 它的整棵子树（搜 `node` 时用户想看到它拉起的子进程）。筛选期间强制展开，
 * 否则命中的节点可能藏在折叠的父节点里，看起来像「搜不到」。
 */
function treeRowsFor(forest: TreeNode[], expanded: Set<number>, hits: Set<number>) {
  if (hits.size === 0) return flattenTree(forest, expanded);
  const keep = new Set<number>();
  const path: TreeNode[] = [];

  const markSubtree = (node: TreeNode) => {
    keep.add(node.p.pid);
    for (const child of node.children) markSubtree(child);
  };

  const walk = (node: TreeNode) => {
    path.push(node);
    if (hits.has(node.p.pid)) {
      for (const ancestor of path) keep.add(ancestor.p.pid);
      markSubtree(node);
    }
    for (const child of node.children) walk(child);
    path.pop();
  };

  for (const root of forest) walk(root);

  const allExpanded = new Set<number>(keep);
  return flattenTree(forest, allExpanded).filter((r) => keep.has(r.p.pid));
}

/** 四张统计卡：总数、CPU 合计、内存合计、高 CPU 进程数。 */
function Summary({ procs }: { procs: ProcInfo[] }) {
  const t = useT();
  const cpu = procs.reduce((a, p) => a + (p.cpu ?? 0), 0);
  const mem = procs.reduce((a, p) => a + (p.memory ?? 0), 0);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={Cpu}
        label={t("procs.statTotal")}
        value={procs.length}
        tone="accent"
      />
      <StatCard
        icon={Cpu}
        label={t("procs.sortCpu")}
        value={`${cpu.toFixed(0)}%`}
        tone="warn"
      />
      <StatCard
        icon={MemoryStick}
        label={t("procs.statMemoryTotal")}
        value={formatBytes(mem)}
        tone="ok"
      />
      <StatCard
        icon={Search}
        label={t("procs.statHighCpu")}
        value={procs.filter((p) => p.cpu > 10).length}
        tone="danger"
      />
    </div>
  );
}

/** CPU / 内存分布直方图。 */
function Distribution({ cpu, mem }: { cpu: EChartsCoreOption; mem: EChartsCoreOption }) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Cpu size={14} className="text-warn" /> {t("procs.cpuDistTitle")}
        </h3>
        <EChart option={cpu} style={{ height: 170 }} lazyUpdate />
      </Card>
      <Card>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <MemoryStick size={14} className="text-ok" /> {t("procs.memDistTitle")}
        </h3>
        <EChart option={mem} style={{ height: 170 }} lazyUpdate />
      </Card>
    </div>
  );
}

/** 筛选胶囊：全部 / AI / 开发服务器。 */
function ChipFilter({ chip, onPick }: { chip: Chip; onPick: (c: Chip) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5">
      {CHIPS.map(([key, labelKey]) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          className={`rounded-[var(--radius-btn)] border px-2.5 py-1 text-xs transition-colors ${
            chip === key
              ? "border-accent/50 bg-accentsoft text-accent"
              : "border-line bg-panel2 text-dim hover:text-text"
          }`}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

/** 排序下拉。 */
function SortSelect({
  sort,
  onPick,
}: {
  sort: ProcSortKey;
  onPick: (s: ProcSortKey) => void;
}) {
  const t = useT();
  return (
    <label className="flex items-center gap-1.5 text-xs text-dim">
      {t("procs.sortLabel")}
      <select
        className="rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1 text-xs text-text outline-none"
        value={sort}
        onChange={(e) => onPick(e.target.value as ProcSortKey)}
      >
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {t(s.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 扁平 / 树形切换。 */
function ViewToggle({
  view,
  onPick,
}: {
  view: "flat" | "tree";
  onPick: (v: "flat" | "tree") => void;
}) {
  const t = useT();
  const items = [
    { id: "flat" as const, icon: Rows3, label: t("procs.viewFlat") },
    { id: "tree" as const, icon: ListTree, label: t("procs.viewTree") },
  ];
  return (
    <div
      className="flex items-center gap-0.5 rounded-[var(--radius-btn)] border border-line bg-panel2 p-0.5"
      role="group"
      aria-label={t("procs.viewLabel")}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-proc-view={it.id}
          aria-pressed={view === it.id}
          onClick={() => onPick(it.id)}
          className={`flex items-center gap-1 rounded-[calc(var(--radius-btn)-2px)] px-2 py-1 text-xs transition-colors ${
            view === it.id ? "bg-accentsoft text-accent" : "text-dim hover:text-text"
          }`}
        >
          <it.icon size={12} /> {it.label}
        </button>
      ))}
    </div>
  );
}

/** 直方图选项：0 值不显示标签（标签会贴在轴上像散落字符）。 */
function histogram(bins: Bucket[], palette: string[]) {
  // 柱顶的数值标签也要占高度。轴上限若正好等于最大值，标签会压在最高那条
  // 刻度上（实测 max=4 时柱顶的 "4" 与 Y 轴刻度 "4" 重叠）。留一格余量。
  const peak = Math.max(...bins.map((b) => b.count), 1);
  return {
    grid: { left: 36, right: 16, top: 20, bottom: 24 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: bins.map((b) => b.label),
      axisLabel: { fontSize: 9 },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      max: peak + 1,
      axisLabel: { fontSize: 9 },
      // 柱顶已经有精确数值标签，再画水平网格线会让虚线直接穿过那几位数字
      // （实测 "4" 被网格线划成两半）。这里关掉网格线，读数以标签为准。
      splitLine: { show: false },
    },
    series: [
      {
        id: "histogram",
        type: "bar",
        data: bins.map((b, i) => ({
          value: b.count,
          itemStyle: {
            color: palette[i % palette.length],
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barWidth: "60%",
        label: {
          show: true,
          position: "top",
          fontSize: 10,
          formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : ""),
        },
      },
    ],
  };
}
