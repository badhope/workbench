import { useMemo } from "react";
import { BarChart3, ExternalLink, ListTree, Network, Server } from "lucide-react";
import { EChart } from "../lib/echarts";
import { chartGapColor, horizontalBarOption, seriesColors } from "../lib/chartTheme";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../lib/i18n";
import { Btn, Card, Empty, ErrorState, SectionTitle, Skeleton, StatCard } from "../ui";
import { downloadText, toCsv } from "../lib/export";
import { urlForPort } from "../lib/openTarget";
import {
  frameworkDistribution,
  isPieWorthRendering,
  portDistribution,
} from "../lib/aggregate";
import { DevServerList } from "./servers/DevServerList";
import type { DevServer, PortEntry } from "../types";
import type { EChartsCoreOption } from "echarts/core";

export default function Servers() {
  const t = useT();
  const {
    devs,
    ports,
    procs,
    refreshRuntime,
    loading,
    runtimeError,
    theme,
    openTarget,
    setProcQuery,
    setFocusPid,
    setView,
  } = useStore(
    useShallow((s) => ({
      devs: s.devs,
      ports: s.ports,
      procs: s.procs,
      refreshRuntime: s.refreshRuntime,
      loading: s.loading,
      runtimeError: s.runtimeError,
      theme: s.theme,
      openTarget: s.openTarget,
      setProcQuery: s.setProcQuery,
      setFocusPid: s.setFocusPid,
      setView: s.setView,
    }))
  );

  /** 端口 → 进程的闭环：带着 PID 跳到进程页并高亮。 */
  const showProcess = (pid: number) => {
    setProcQuery(String(pid));
    setFocusPid(pid);
    setView("processes");
  };

  const listening = useMemo<PortEntry[]>(
    () =>
      ports
        .filter((p) => p.protocol === "TCP" && p.state === "LISTENING")
        .sort((a, b) => a.local_port - b.local_port),
    [ports]
  );

  const procByPid = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of procs) m.set(p.pid, p.name);
    return m;
  }, [procs]);

  const frameworkData = useMemo(() => frameworkDistribution(devs), [devs]);
  const heatmapData = useMemo(
    () =>
      portDistribution(listening, [
        t("servers.portRange.wellKnown"),
        t("servers.portRange.registered"),
        t("servers.portRange.dynamic"),
      ]),
    [listening, t]
  );
  const colors = useMemo(() => seriesColors(theme), [theme]);

  // 框架分布饼图
  const frameworkPieOption = useMemo(() => {
    return {
      tooltip: {
        trigger: "item",
        formatter: "{b}: {c} ({d}%)",
      },
      series: [
        {
          id: "framework-pie",
          type: "pie",
          radius: ["48%", "70%"],
          center: ["50%", "50%"],
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: "bold" },
          },
          labelLine: { show: false },
          itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
          data: frameworkData.map(([name, count], i) => ({
            name,
            value: count,
            itemStyle: { color: colors[i % colors.length] },
          })),
        },
      ],
    };
  }, [frameworkData, theme, colors]);

  // 端口分布条形图（与 Overview / Projects / AiSessions 共用同一构造器）
  const portBarOption = useMemo(
    () =>
      horizontalBarOption({
        labels: heatmapData.map((h) => h.label),
        values: heatmapData.map((h, i) => ({
          value: h.count,
          color: colors[i % colors.length],
        })),
        theme,
        left: 100,
        barWidth: 16,
        valueLabel: "{c}",
      }),
    [heatmapData, theme, colors]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── 摘要条 ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={Server}
          label={t("servers.stats.devServers")}
          value={devs.length}
          tone="ok"
        />
        <StatCard
          icon={Network}
          label={t("servers.stats.tcpListening")}
          value={listening.length}
          tone="accent"
        />
        <StatCard
          icon={BarChart3}
          label={t("servers.stats.frameworkKinds")}
          value={frameworkData.length}
          tone="warn"
        />
      </div>

      <Charts
        framework={frameworkData}
        frameworkOption={frameworkPieOption}
        heatmap={heatmapData}
        portOption={portBarOption}
        colors={colors}
      />

      <DevServersCard
        devs={devs}
        loading={loading}
        runtimeError={runtimeError}
        onRefresh={refreshRuntime}
      />

      {/* ── 全部监听端口 ── */}
      <Card className="">
        <SectionTitle
          extra={
            listening.length > 0 ? (
              <Btn
                className="!py-1 !text-xs"
                onClick={() => {
                  const rows: (string | number)[][] = [
                    ["protocol", "local_address", "port", "pid", "process", "state"],
                    ...listening.map((p) => [
                      p.protocol,
                      p.local_addr,
                      p.local_port,
                      p.pid,
                      procByPid.get(p.pid) ?? "",
                      p.state,
                    ]),
                  ];
                  const stamp = new Date()
                    .toISOString()
                    .slice(0, 19)
                    .replace(/[:T]/g, "-");
                  downloadText(`workbench-ports-${stamp}.csv`, toCsv(rows));
                }}
              >
                {t("servers.exportCsv")}
              </Btn>
            ) : undefined
          }
        >
          {t("servers.allTcpPorts", { count: listening.length })}
        </SectionTitle>
        {listening.length === 0 ? (
          <Empty>{t("servers.noTcpPorts")}</Empty>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listening.map((p) => (
              <div
                key={`${p.local_addr}-${p.local_port}-${p.pid}`}
                className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/50 bg-panel2 px-3 py-2 text-xs hover:border-accent/40 transition-colors"
              >
                <Network size={12} className="text-accent shrink-0" />
                <span className="font-mono font-semibold text-accent">
                  :{p.local_port}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-dim hover:text-accent"
                  onClick={() => showProcess(p.pid)}
                  title={t("servers.showProcess")}
                >
                  {procByPid.get(p.pid) ?? `PID ${p.pid}`}
                </button>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    className="text-dim hover:text-accent"
                    onClick={() => showProcess(p.pid)}
                    title={t("servers.showProcess")}
                    aria-label={t("servers.showProcess")}
                  >
                    <ListTree size={11} />
                  </button>
                  {/* 打开链接要按实际监听地址与协议推断：写死 localhost+
                      http 在 IPv6、HTTPS、UDP 端口上都会给出错误地址。
                      非 TCP 端口不提供该按钮——没有可打开的语义。 */}
                  {(() => {
                    const target = urlForPort(p.local_port, p.local_addr, p.protocol);
                    if (!target) return null;
                    return (
                      <button
                        type="button"
                        className="text-dim hover:text-accent"
                        onClick={() => openTarget(target.url)}
                        title={`${t("servers.open")} · ${target.url}`}
                        aria-label={`${t("servers.open")} ${target.url}`}
                      >
                        <ExternalLink size={11} />
                      </button>
                    );
                  })()}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 两张分布图：框架饼图 + 端口区间条形图。 */
function Charts({
  framework,
  frameworkOption,
  heatmap,
  portOption,
  colors,
}: {
  framework: [string, number][];
  frameworkOption: EChartsCoreOption;
  heatmap: { label: string; count: number }[];
  portOption: EChartsCoreOption;
  colors: string[];
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <SectionTitle>{t("servers.frameworkDist")}</SectionTitle>
        {framework.length === 0 ? (
          <Empty icon={Server}>{t("servers.frameworkEmpty")}</Empty>
        ) : (
          <FrameworkBars data={framework} option={frameworkOption} colors={colors} />
        )}
      </Card>
      <Card>
        <SectionTitle>{t("servers.portDist")}</SectionTitle>
        {heatmap.length === 0 ? (
          <Empty icon={Network}>{t("servers.portEmpty")}</Empty>
        ) : (
          <EChart option={portOption} style={{ height: 180 }} lazyUpdate />
        )}
      </Card>
    </div>
  );
}

/** 饼图 + 图例。单分类时不画饼图：一个满圆永远 100%，不传达信息。 */
function FrameworkBars({
  data,
  option,
  colors,
}: {
  data: [string, number][];
  option: EChartsCoreOption;
  colors: string[];
}) {
  return (
    <>
      {isPieWorthRendering(data) && (
        <EChart option={option} style={{ height: 180 }} lazyUpdate />
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {data.map(([name, count], i) => (
          <span key={name} className="flex items-center gap-1.5 text-[11px] text-dim">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: colors[i % colors.length] }}
            />
            {name} <span className="font-mono text-text">{count}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/** 开发服务器卡：空/加载/错误/列表四种状态。 */
function DevServersCard({
  devs,
  loading,
  runtimeError,
  onRefresh,
}: {
  devs: DevServer[];
  loading: boolean;
  runtimeError: string;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <Card>
      <SectionTitle
        extra={
          <Btn onClick={onRefresh} className="!py-1 !text-xs">
            {t("servers.refresh")}
          </Btn>
        }
      >
        {t("servers.devServersTitle", { count: devs.length })}
      </SectionTitle>
      {devs.length === 0 && loading && !runtimeError ? (
        <Skeleton lines={3} className="px-2 py-3" />
      ) : devs.length === 0 && runtimeError ? (
        <ErrorState onRetry={onRefresh} retryLabel={t("servers.emptyAction")}>
          {t("servers.loadFailed", { err: runtimeError })}
        </ErrorState>
      ) : devs.length === 0 ? (
        <Empty
          action={
            <Btn className="!px-2 !py-0.5 !text-[11px]" onClick={onRefresh}>
              {t("servers.emptyAction")}
            </Btn>
          }
        >
          {t("servers.noDevServers")}
        </Empty>
      ) : (
        <DevServerList devs={devs} />
      )}
    </Card>
  );
}
