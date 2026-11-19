import { useMemo } from "react";
import { Activity, Cpu, HardDrive, Network } from "lucide-react";
import { EChart } from "../../../lib/echarts";
import {
  chartGapColor,
  chartLineColor,
  chartTheme,
  horizontalBarOption,
  seriesColors,
} from "../../../lib/chartTheme";
import { useStore } from "../../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { Empty } from "../../../ui";
import { escapeHtml, formatBytes } from "../../../lib/util";
import { localeFor, useLang, useT } from "../../../lib/i18n";
import { useBreakpoint } from "../../../lib/useBreakpoint";
import { categorizeProcesses, portDistribution } from "../../../lib/aggregate";
import { WidgetFrame } from "./WidgetFrame";

export function ResourceWidget() {
  const t = useT();
  const lang = useLang();
  const bp = useBreakpoint();
  const { history, procs, sysinfo, theme } = useStore(
    useShallow((s) => ({
      history: s.history,
      procs: s.procs,
      sysinfo: s.sysinfo,
      theme: s.theme,
    }))
  );
  // CPU 用强调色、内存用主题的 warn 色：两者在色相上足够远（青 vs 琥珀），
  // 又都来自主题自身，切到 Paper / Jade 时不会突然出现一抹陌生的紫。
  const cpuColor = useMemo(() => chartTheme(theme).accent, [theme]);
  const memColor = useMemo(() => chartTheme(theme).warn, [theme]);

  const memTotal = procs.reduce((a, p) => a + (p.memory ?? 0), 0);
  const memTotalGb = sysinfo ? sysinfo.total_memory / 1024 ** 3 : 0;

  const option = useMemo(() => {
    const times = history.map((h) =>
      new Date(h.t).toLocaleTimeString(localeFor(lang), { hour12: false }).slice(3)
    );
    const narrow = bp === "compact";
    const area = (color: string) => ({
      color: {
        type: "linear",
        x: 0,
        y: 0,
        x2: 0,
        y2: 1,
        colorStops: [
          { offset: 0, color: color + "40" },
          { offset: 1, color: color + "05" },
        ],
      },
    });
    return {
      grid: { left: 42, right: narrow ? 36 : 48, top: narrow ? 46 : 22, bottom: 22 },
      tooltip: { trigger: "axis" },
      legend: {
        top: narrow ? 20 : -2,
        left: "center",
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 4,
        textStyle: { fontSize: narrow ? 9 : 10 },
      },
      xAxis: { type: "category", data: times, axisLabel: { fontSize: 10 } },
      yAxis: [
        {
          type: "value",
          name: "CPU%",
          nameTextStyle: { fontSize: narrow ? 9 : 10 },
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { type: "dashed" } },
        },
        {
          type: "value",
          name: "GB",
          nameTextStyle: { fontSize: narrow ? 9 : 10 },
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          id: "cpu",
          name: t("overview.seriesCpuTotal"),
          type: "line",
          smooth: true,
          showSymbol: false,
          data: history.map((h) => h.cpu),
          lineStyle: { color: cpuColor, width: 2 },
          itemStyle: { color: cpuColor },
          areaStyle: area(cpuColor),
        },
        {
          id: "memory",
          name: t("overview.seriesMemory"),
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: history.map((h) => h.memGb),
          lineStyle: { color: memColor, width: 2 },
          itemStyle: { color: memColor },
          areaStyle: area(memColor),
        },
      ],
    };
  }, [history, t, lang, bp, cpuColor, memColor]);

  return (
    <WidgetFrame title={t("overview.chartResourceTitle", { count: history.length })}>
      {history.length > 1 ? (
        <div className="flex h-full min-h-[180px] flex-col">
          <div className="min-h-0 flex-1">
            <EChart
              option={option}
              style={{ height: "100%", minHeight: 170 }}
              lazyUpdate
            />
          </div>
          <p className="mt-1 line-clamp-2 text-[10.5px] text-faint">
            {t("overview.chartNote1")}
            {memTotalGb > 0 &&
              t("overview.chartNoteTotal", { gb: memTotalGb.toFixed(1) })}
            {t("overview.chartNoteSumPrefix")}
            {formatBytes(memTotal)}
            {t("overview.chartNotePeriod")}
          </p>
        </div>
      ) : (
        <Empty icon={Activity}>{t("overview.samplingEmpty")}</Empty>
      )}
    </WidgetFrame>
  );
}

export function CategoryWidget() {
  const t = useT();
  const { procs, theme } = useStore(
    useShallow((s) => ({ procs: s.procs, theme: s.theme }))
  );
  const categories = useMemo(
    () =>
      categorizeProcesses(procs, {
        browser: t("overview.cat.browser"),
        dev: t("overview.cat.dev"),
        ai: t("overview.cat.ai"),
        system: t("overview.cat.system"),
        other: t("overview.cat.other"),
      }),
    [procs, t]
  );

  const option = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: t("overview.pieTooltip") },
      series: [
        {
          id: "proc-category",
          type: "pie",
          radius: ["52%", "76%"],
          center: ["50%", "50%"],
          padAngle: 3,
          itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: "bold" },
            itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,0.4)" },
          },
          data: categories.map((c) => ({
            name: c.name,
            value: c.count,
            itemStyle: { color: c.color },
          })),
        },
      ],
    }),
    [categories, theme, t]
  );

  return (
    <WidgetFrame title={t("overview.chartCategoryTitle")}>
      {categories.length > 0 ? (
        <div className="flex h-full min-h-[160px] flex-col">
          <div className="min-h-0 flex-1">
            <EChart
              option={option}
              style={{ height: "100%", minHeight: 140 }}
              lazyUpdate
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {categories.map((c) => (
              <span
                key={c.name}
                className="flex items-center gap-1.5 text-[10.5px] text-dim"
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: c.color }}
                />
                {c.name} <span className="num text-text">{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <Empty icon={Cpu}>{t("overview.noProcessData")}</Empty>
      )}
    </WidgetFrame>
  );
}

export function DiskWidget() {
  const t = useT();
  const { disks, theme } = useStore(
    useShallow((s) => ({ disks: s.disks, theme: s.theme }))
  );
  const colors = useMemo(() => seriesColors(theme), [theme]);

  const series = useMemo(
    () =>
      disks.map((d, i) => ({
        value: d.total_bytes > 0 ? Math.round((d.used_bytes / d.total_bytes) * 100) : 0,
        name: d.label || d.mount_point,
        total: d.total_bytes,
        used: d.used_bytes,
        mount: d.mount_point,
        itemStyle: { color: colors[i % colors.length] },
      })),
    [disks, colors]
  );

  const option = useMemo(
    () => ({
      tooltip: {
        trigger: "item",
        formatter: (p: {
          data: { name: string; total: number; used: number; mount: string };
        }) => {
          const d = p.data;
          // 名称/挂载点来自本机磁盘卷标（外部可控字符串），必须转义后再拼 HTML
          return `<b>${escapeHtml(d.name)}</b><br/>${escapeHtml(
            t("overview.diskTooltip", {
              used: formatBytes(d.used),
              total: formatBytes(d.total),
              mount: d.mount,
            })
          )}`;
        },
      },
      series: series.length
        ? [
            {
              id: "disk",
              type: "pie",
              radius: ["52%", "72%"],
              center: ["50%", "50%"],
              padAngle: 3,
              itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
              label: { show: false },
              labelLine: { show: false },
              data: series,
            },
          ]
        : [
            {
              id: "disk-empty",
              type: "pie",
              radius: ["52%", "72%"],
              center: ["50%", "50%"],
              silent: true,
              data: [
                {
                  value: 1,
                  name: t("overview.noDiskData"),
                  itemStyle: { color: chartLineColor(theme) },
                },
              ],
              label: { show: false },
            },
          ],
    }),
    [series, theme, t]
  );

  return (
    <WidgetFrame title={t("overview.diskTitle")}>
      {disks.length > 0 ? (
        <div className="flex h-full flex-col">
          <EChart option={option} style={{ height: 150 }} lazyUpdate />
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {disks.map((d, i) => {
              const pct =
                d.total_bytes > 0 ? Math.round((d.used_bytes / d.total_bytes) * 100) : 0;
              const danger = pct >= 90;
              return (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded border border-line/40 px-2 py-1 text-[11px]"
                >
                  <HardDrive
                    size={11}
                    className={danger ? "text-danger" : "text-accent"}
                  />
                  <span className="truncate font-medium" title={d.mount_point}>
                    {d.label || d.mount_point}
                  </span>
                  <span className="num ml-auto text-faint">
                    {formatBytes(d.used_bytes)}
                  </span>
                  <span className={`num ${danger ? "text-danger" : "text-ok"}`}>
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <Empty icon={HardDrive}>{t("overview.diskLoading")}</Empty>
      )}
    </WidgetFrame>
  );
}

export function PortWidget() {
  const t = useT();
  const { ports, devs, theme } = useStore(
    useShallow((s) => ({ ports: s.ports, devs: s.devs, theme: s.theme }))
  );
  const ranges = useMemo(
    () =>
      portDistribution(ports, [
        t("servers.portRange.wellKnown"),
        t("servers.portRange.registered"),
        t("servers.portRange.dynamic"),
      ]),
    [ports, t]
  );
  const option = useMemo(
    () =>
      horizontalBarOption({
        labels: ranges.map((p) => p.label),
        values: ranges.map((p) => ({ value: p.count })),
        theme,
        fontSize: 10,
      }),
    [ranges, theme]
  );

  return (
    <WidgetFrame title={t("overview.portTitle")}>
      {ranges.some((p) => p.count > 0) ? (
        <div className="flex h-full flex-col">
          <EChart option={option} style={{ height: 150 }} lazyUpdate />
          <div className="mt-2 flex gap-5 text-[11px] text-dim">
            <span>
              {t("overview.totalListening")}{" "}
              <span className="num text-text">{ports.length}</span>
            </span>
            <span>
              {t("overview.knownServices")}{" "}
              <span className="num text-text">{devs.length}</span>
            </span>
          </div>
        </div>
      ) : (
        <Empty icon={Network}>{t("overview.noPorts")}</Empty>
      )}
    </WidgetFrame>
  );
}
