import type { LucideIcon } from "lucide-react";
import { Activity, Clock, Cpu, HardDrive, Inbox, Network, Server } from "lucide-react";
import { useStore } from "../../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { formatBytes, formatCpu, formatUptime } from "../../../lib/util";
import { useT } from "../../../lib/i18n";
import type { WidgetId } from "../../../lib/layout";
import type {
  AiProcess,
  DevServer,
  DiskInfo,
  PortEntry,
  ProcInfo,
  SessionFilePreview,
  Task,
} from "../../../types";

function headline(
  id: WidgetId,
  s: {
    procs: ProcInfo[];
    devs: DevServer[];
    ais: AiProcess[];
    disks: DiskInfo[];
    ports: PortEntry[];
    tasks: Task[];
    files: SessionFilePreview[];
    setView: (v: never) => void;
  },
  t: (k: string, v?: Record<string, string | number>) => string
): { label: string; value: string; note: string; icon: LucideIcon; go?: () => void } {
  const go = (v: string) => () => s.setView(v as never);
  switch (id) {
    case "resources": {
      const total = s.procs.reduce((a, p) => a + (p.cpu ?? 0), 0);
      return {
        label: t("overview.seriesCpuTotal"),
        value: `${formatCpu(total)}`,
        note: t("overview.hubProc"),
        icon: Activity,
      };
    }
    case "categories":
      return {
        label: t("overview.chartCategoryTitle"),
        value: String(s.procs.length),
        note: t("overview.hubProc"),
        icon: Cpu,
      };
    case "disks": {
      const worst = s.disks.reduce(
        (m, d) =>
          Math.max(m, d.total_bytes > 0 ? (d.used_bytes / d.total_bytes) * 100 : 0),
        0
      );
      return {
        label: t("overview.diskTitle"),
        value: `${Math.round(worst)}%`,
        note: `${s.disks.length}`,
        icon: HardDrive,
      };
    }
    case "ports":
      return {
        label: t("overview.portTitle"),
        value: String(s.ports.length),
        note: t("overview.totalListening"),
        icon: Network,
        go: go("servers"),
      };
    case "processes":
      return {
        label: t("overview.topCpuTitle"),
        value: String(s.procs.length),
        note: t("overview.hubProc"),
        icon: Cpu,
        go: go("processes"),
      };
    case "services":
      return {
        label: t("overview.runningServicesTitle"),
        value: String(s.devs.length + s.ais.length),
        note: t("overview.hubSrv"),
        icon: Server,
        go: go("servers"),
      };
    case "tasks": {
      const due = s.tasks.filter((x) => x.status !== "done").length;
      return {
        label: t("overview.recentTasks"),
        value: String(due),
        note: t("overview.goHandle"),
        icon: Activity,
        go: go("tasks"),
      };
    }
    case "sessions":
      return {
        label: t("overview.localSessions"),
        value: String(s.files.length),
        note: "jsonl",
        icon: Inbox,
      };
    default:
      return {
        label: t("overview.heroTitle"),
        value: "—",
        note: "",
        icon: Activity,
      };
  }
}

/**
 * 环仪布局用的「卫星瓦片」：只显示一个标题 + 一个主数字 + 一行注脚。
 *
 * 为什么不在环上放完整组件：完整组件最小可读宽度约 320px，
 * 8 个围一圈时每个只能分到 200px 左右，图表和表格会被压成不可读的窄条
 * （实测表格直接溢出）。环形布局的职责是「一眼看到全貌」，
 * 细节留给便当格/账本布局——所以这里刻意只取每组数据的一个 headline。
 */
export function OrbitTile({ id }: { id: WidgetId }) {
  const t = useT();
  const s = useStore(
    useShallow((st) => ({
      procs: st.procs,
      devs: st.devs,
      ais: st.ais,
      disks: st.disks,
      ports: st.ports,
      tasks: st.data.tasks,
      files: st.sessionFiles,
      setView: st.setView,
    }))
  );
  const h = headline(id, s, t);

  return (
    <button
      type="button"
      onClick={h.go}
      className="orbit-satellite group flex w-full items-center gap-2.5 border border-line/90 bg-panel px-3 py-2.5 text-left transition-colors hover:border-accent/45"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-accentsoft/70">
        <h.icon size={13} className="text-accent" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] text-dim">{h.label}</span>
        <span className="num block truncate text-[17px] font-semibold leading-tight text-text">
          {h.value}
        </span>
      </span>
      <span className="shrink-0 text-[9.5px] text-faint">{h.note}</span>
    </button>
  );
}

/** 顶部铭牌：主机 / 系统 / 核数 / 内存 / 运行时长。 */
export function Nameplate() {
  const t = useT();
  const { sysinfo, procs } = useStore(
    useShallow((s) => ({ sysinfo: s.sysinfo, procs: s.procs }))
  );
  if (!sysinfo) return null;
  const memUsed = procs.reduce((a, p) => a + (p.memory ?? 0), 0);
  const totalGb = sysinfo.total_memory / 1024 ** 3;
  const pct = totalGb > 0 ? Math.round((memUsed / 1024 ** 3 / totalGb) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-[var(--radius-btn)] border border-line/70 bg-panel/40 px-3.5 py-2 text-[11px] text-dim">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="font-medium text-text">{sysinfo.hostname}</span>
      </span>
      <span className="h-3 w-px bg-line" aria-hidden="true" />
      <span>{sysinfo.os_name}</span>
      <span className="h-3 w-px bg-line" aria-hidden="true" />
      <span className="flex items-center gap-1">
        <Cpu size={11} className="text-faint" />
        <span className="num text-text">{sysinfo.cpu_cores}</span>
        {t("overview.cpuCores")}
      </span>
      <span className="flex items-center gap-1">
        <HardDrive size={11} className="text-faint" />
        <span className="num text-text">{formatBytes(sysinfo.total_memory)}</span>
        {pct > 0 && (
          <span className="text-faint">{t("overview.memUsedPct", { pct })}</span>
        )}
      </span>
      <span className="flex items-center gap-1">
        <Clock size={11} className="text-faint" />
        {t("overview.uptime")}{" "}
        <span className="num text-text">{formatUptime(sysinfo.uptime_seconds)}</span>
      </span>
    </div>
  );
}
