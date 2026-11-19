import { useMemo } from "react";
import { Activity, Cpu, Inbox, Server, Sparkles } from "lucide-react";
import { useStore } from "../../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { Badge, Card, Empty, Skeleton, StatCard, Table, Td, Tr } from "../../../ui";
import { dueLabel, formatBytes, formatCpu, shortPath } from "../../../lib/util";
import { useT } from "../../../lib/i18n";
import { WidgetFrame } from "./WidgetFrame";

export function KpiWidget() {
  const t = useT();
  const { procs, devs, ais, data, loading } = useStore(
    useShallow((s) => ({
      procs: s.procs,
      devs: s.devs,
      ais: s.ais,
      data: s.data,
      loading: s.loading,
    }))
  );
  const cpuTotal = procs.reduce((a, p) => a + (p.cpu ?? 0), 0);
  const doing = data.tasks.filter((x) => x.status === "doing").length;

  // 首次采样还没回来：显示骨架，避免四个 0 一闪而过
  if (procs.length === 0 && loading) {
    return (
      <div className="grid h-full grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="px-4 py-3.5">
            <Skeleton lines={2} />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        icon={Cpu}
        label={t("overview.statRunningProcs")}
        value={procs.length}
        hint={t("overview.statCpuTotal", { cpu: formatCpu(cpuTotal) })}
        tone="accent"
      />
      <StatCard
        icon={Server}
        label={t("overview.statDevServers")}
        value={devs.length}
        hint={
          devs.map((d) => `${d.framework}:${d.port}`).join(" / ") || t("overview.none")
        }
        tone="ok"
      />
      <StatCard
        icon={Sparkles}
        label={t("overview.statAiAgents")}
        value={ais.length}
        hint={ais.map((a) => a.name).join(" / ") || t("overview.none")}
        tone="warn"
      />
      <StatCard
        icon={Activity}
        label={t("overview.statDoingTasks")}
        value={doing}
        hint={t("overview.statTotalTasks", { count: data.tasks.length })}
        tone="text"
      />
    </div>
  );
}

export function TopProcessWidget() {
  const t = useT();
  const { procs, setView } = useStore(
    useShallow((s) => ({ procs: s.procs, setView: s.setView }))
  );
  const top = useMemo(
    () => [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 6),
    [procs]
  );

  return (
    <WidgetFrame
      title={t("overview.topCpuTitle")}
      extra={
        <button
          className="text-[11px] text-accent hover:underline"
          onClick={() => setView("processes")}
        >
          {t("overview.viewAll")}
        </button>
      }
    >
      <Table head={["PID", t("overview.colProcess"), "CPU", t("overview.memory")]}>
        {top.map((p) => (
          <Tr key={p.pid}>
            <Td mono className="text-dim">
              {p.pid}
            </Td>
            <Td className="max-w-[150px] truncate font-medium" title={p.cmd_line}>
              {p.name}
            </Td>
            <Td className="num text-accent">{formatCpu(p.cpu)}</Td>
            <Td className="num">{formatBytes(p.memory)}</Td>
          </Tr>
        ))}
        {top.length === 0 && (
          <Tr>
            <Td className="text-dim">{t("overview.noData")}</Td>
          </Tr>
        )}
      </Table>
    </WidgetFrame>
  );
}

export function ServicesWidget() {
  const t = useT();
  const { devs, ais, setView } = useStore(
    useShallow((s) => ({ devs: s.devs, ais: s.ais, setView: s.setView }))
  );

  return (
    <WidgetFrame
      title={t("overview.runningServicesTitle")}
      extra={
        <button
          className="text-[11px] text-accent hover:underline"
          onClick={() => setView("ai")}
        >
          {t("overview.viewSessions")}
        </button>
      }
    >
      {devs.length === 0 && ais.length === 0 && (
        <Empty
          icon={Server}
          action={
            <button
              className="text-[11px] text-accent hover:underline"
              onClick={() => setView("servers")}
            >
              {t("overview.noServicesAction")}
            </button>
          }
        >
          {t("overview.noServices")}
        </Empty>
      )}
      <ul className="flex flex-col gap-1.5">
        {devs.map((d) => (
          <li
            key={d.port}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/60 bg-panel2/60 px-2.5 py-1.5 text-[12px]"
          >
            <Server size={12} className="text-ok" />
            <span className="truncate font-medium">{d.framework}</span>
            <Badge tone="ok">:{d.port}</Badge>
            <span
              className="ml-auto truncate text-[10.5px] text-faint"
              title={shortPath(d.project_dir ?? "", 80)}
            >
              {d.project_dir ? shortPath(d.project_dir, 32) : `PID ${d.pid}`}
            </span>
          </li>
        ))}
        {ais.map((a) => (
          <li
            key={a.pid}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/60 bg-panel2/60 px-2.5 py-1.5 text-[12px]"
          >
            <Sparkles size={12} className="text-warn" />
            <span className="truncate font-medium">{a.name}</span>
            <Badge tone="warn">{a.matched}</Badge>
            <span className="num ml-auto text-[10.5px] text-faint">
              {a.pid} · {formatBytes(a.memory)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}

export function TasksWidget() {
  const t = useT();
  const { tasks, setView } = useStore(
    useShallow((s) => ({ tasks: s.data.tasks, setView: s.setView }))
  );
  const upcoming = useMemo(
    () =>
      tasks
        .filter((x) => x.due && x.status !== "done")
        .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
        .slice(0, 5),
    [tasks]
  );

  return (
    <WidgetFrame
      title={t("overview.recentTasks")}
      extra={
        <button
          className="text-[11px] text-accent hover:underline"
          onClick={() => setView("tasks")}
        >
          {t("overview.goHandle")}
        </button>
      }
    >
      {upcoming.length === 0 ? (
        <Empty icon={Activity}>{t("overview.noUpcomingTasks")}</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {upcoming.map((task) => {
            const due = dueLabel(task.due);
            return (
              <li
                key={task.id}
                className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/60 bg-panel2/60 px-2.5 py-1.5 text-[12px]"
              >
                <Badge tone={due.tone}>{due.text}</Badge>
                <span className="truncate">{task.title}</span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetFrame>
  );
}

export function SessionsWidget() {
  const t = useT();
  const { files } = useStore(useShallow((s) => ({ files: s.sessionFiles })));

  return (
    <WidgetFrame title={t("overview.localSessions")}>
      {files.length === 0 ? (
        <Empty icon={Inbox}>{t("overview.noSessionFiles")}</Empty>
      ) : (
        <ul className="flex max-h-[180px] flex-col gap-1 overflow-y-auto">
          {files.slice(0, 8).map((s) => (
            <li
              key={s.path}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-panel2"
            >
              <Badge tone={s.tool.includes("Claude") ? "accent" : "ok"}>{s.tool}</Badge>
              <span className="truncate text-dim" title={s.path}>
                {s.project}
              </span>
              <span className="num ml-auto text-faint">{formatBytes(s.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}
