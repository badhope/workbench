import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, SearchX, XCircle } from "lucide-react";
import { Badge, Btn, Empty, Td, Tr } from "../../ui";
import { formatBytes, fromNow, shortPath } from "../../lib/util";
import { useStore } from "../../lib/store";
import { localeFor, useLang, useT } from "../../lib/i18n";
import { statusKeyOf } from "../../lib/processStatus";
import type { ProcInfo } from "../../types";
import type { TreeRow } from "./tree";

/** 虚拟滚动估算尺寸：普通行固定，展开详情行内容高度不定，交由实测修正 */
const ROW_H = 37;
const DETAIL_H = 190;
const OVERSCAN = 12;

type Unit = { kind: "row"; row: TreeRow } | { kind: "detail"; p: ProcInfo };

/**
 * 进程表：虚拟滚动 + 行内展开 + 可选父子层级。
 *
 * 层级由 `tree.ts` 预先摊平成行序列（带 depth），表格只负责缩进渲染。
 * 扁平与树形共用同一套虚拟化与展开逻辑，避免「树形为缩进另写一份表格」
 * 之后两边的键盘行为各自漂移。
 */
export function ProcessTable({
  rows,
  aiPids,
  devPids,
  onClearFilter,
  canClear,
  focusPid,
  expandedNodes,
  onToggleNode,
}: {
  rows: TreeRow[];
  aiPids: Set<number>;
  devPids: Set<number>;
  onClearFilter: () => void;
  canClear: boolean;
  focusPid?: number | null;
  /** 树形视图里已展开的父节点 PID */
  expandedNodes?: Set<number>;
  onToggleNode?: (pid: number) => void;
}) {
  const t = useT();
  const [expandedPid, setExpandedPid] = useState<number | null>(null);

  // 把「进程行 + 其展开的详情行」摊平成一条可测量的单元序列：详情行高度随
  // 命令行长度变化，react-virtual 先按估算值排版，再对进入视口的单元实测修正。
  const units = useMemo(() => {
    const out: Unit[] = [];
    for (const row of rows) {
      out.push({ kind: "row", row });
      if (expandedPid === row.p.pid) out.push({ kind: "detail", p: row.p });
    }
    return out;
  }, [rows, expandedPid]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (units[i]?.kind === "detail" ? DETAIL_H : ROW_H),
    overscan: OVERSCAN,
  });

  // 展开/收起会改变「索引 ↔ 单元」的对应关系，实测高度缓存按索引存放，必须清掉
  useEffect(() => {
    virtualizer.measure();
  }, [expandedPid, virtualizer]);

  // 筛选条件变化后列表整体换血，回到顶部，避免停留在旧滚动位置看到空白区
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [rows]);

  // 从端口页 / 命令面板跳过来时滚到目标行：虚拟列表不滚过去就只是「数据变了」。
  useEffect(() => {
    if (!focusPid) return;
    const index = rows.findIndex((r) => r.p.pid === focusPid);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "center" });
  }, [focusPid, rows, virtualizer]);

  if (rows.length === 0) {
    return (
      <Empty
        icon={SearchX}
        action={
          canClear ? (
            <Btn className="!px-2 !py-0.5 !text-[11px]" onClick={onClearFilter}>
              {t("procs.clearFilter")}
            </Btn>
          ) : undefined
        }
      >
        {t("procs.noMatch")}
      </Empty>
    );
  }

  const toggle = (pid: number) => setExpandedPid((cur) => (cur === pid ? null : pid));
  const virtualRows = virtualizer.getVirtualItems();
  const padTop = virtualRows.length ? virtualRows[0].start : 0;
  const padBottom = virtualRows.length
    ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  return (
    <div ref={scrollRef} className="max-h-[60vh] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-line text-left text-xs text-dim">
            {headers(t).map((h, i) => (
              <th key={i} className="whitespace-nowrap bg-panel px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <Spacer height={padTop} />}
          {virtualRows.map((v) => {
            const unit = units[v.index];
            if (!unit) return null;
            if (unit.kind === "detail") {
              return (
                <ProcessDetail
                  key={`d-${unit.p.pid}`}
                  p={unit.p}
                  index={v.index}
                  measure={virtualizer.measureElement}
                />
              );
            }
            return (
              <ProcessRow
                key={unit.row.p.pid}
                row={unit.row}
                index={v.index}
                measure={virtualizer.measureElement}
                detailOpen={expandedPid === unit.row.p.pid}
                nodeOpen={
                  expandedNodes && unit.row.hasChildren
                    ? expandedNodes.has(unit.row.p.pid)
                    : undefined
                }
                onToggle={() => toggle(unit.row.p.pid)}
                onToggleNode={
                  unit.row.hasChildren && onToggleNode
                    ? () => onToggleNode(unit.row.p.pid)
                    : undefined
                }
                aiPids={aiPids}
                devPids={devPids}
                focused={focusPid === unit.row.p.pid}
              />
            );
          })}
          {padBottom > 0 && <Spacer height={padBottom} />}
        </tbody>
      </table>
    </div>
  );
}

/** 表头。空字符串是第一列（展开箭头）。 */
function headers(t: (key: string) => string): string[] {
  return [
    "",
    "PID",
    t("procs.colName"),
    "CPU",
    t("procs.colMemory"),
    t("procs.colStatus"),
    t("procs.colStarted"),
    t("procs.colPath"),
    t("procs.colAction"),
  ];
}

/** 虚拟滚动的上下占位行：保持滚动条总高度与实际内容一致。 */
function Spacer({ height }: { height: number }) {
  return (
    <tr aria-hidden="true" style={{ height }}>
      <td colSpan={9} className="p-0" />
    </tr>
  );
}

/** 展开的详情行：可执行路径、父 PID、启动时间、完整命令行、监听端口。 */
function ProcessDetail({
  p,
  index,
  measure,
}: {
  p: ProcInfo;
  index: number;
  measure: (el: Element | null) => void;
}) {
  const t = useT();
  const lang = useLang();
  return (
    <Tr data-index={index} ref={measure}>
      <Td colSpan={9} className="bg-panel/60 px-4 py-3">
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div>
            <span className="text-dim">{t("procs.detailExePath")}</span>
            <div className="mt-0.5 break-all font-mono text-[11px] text-text">
              {p.exe_path || "—"}
            </div>
          </div>
          <div>
            <span className="text-dim">{t("procs.detailParentPid")}</span>
            <div className="mt-0.5 font-mono text-text">
              {p.parent_pid ?? t("procs.detailNoParent")}
            </div>
          </div>
          <div>
            <span className="text-dim">{t("procs.detailStartTime")}</span>
            <div className="mt-0.5 text-text">
              {new Date(p.start_time * 1000).toLocaleString(localeFor(lang))}
            </div>
          </div>
          <div className="sm:col-span-3">
            <span className="text-dim">{t("procs.detailCmdLine")}</span>
            <code className="mt-0.5 block break-all rounded bg-bg px-2 py-1.5 font-mono text-[11px] text-dim">
              {p.cmd_line || "—"}
            </code>
          </div>
          <div className="sm:col-span-3">
            <span className="text-dim">{t("procs.detailPorts")}</span>
            <PortsOfPid pid={p.pid} />
          </div>
        </div>
      </Td>
    </Tr>
  );
}

/** 该进程正在监听的端口。端口页「看进程」的反向闭环就靠这块。 */
function PortsOfPid({ pid }: { pid: number }) {
  const t = useT();
  const ports = useStore((s) => s.ports);
  const mine = ports.filter((p) => p.pid === pid);
  if (mine.length === 0) {
    return <span className="ml-2 text-faint">{t("procs.noPorts")}</span>;
  }
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1">
      {mine.map((p) => (
        <Badge key={`${p.protocol}-${p.local_port}-${p.local_addr}`} tone="accent">
          {p.protocol === "UDP" ? "udp" : "tcp"}:{p.local_port}
        </Badge>
      ))}
    </span>
  );
}

/** 普通进程行。整行可点击/可回车展开，右侧是终止按钮。 */
function ProcessRow({
  row,
  index,
  measure,
  detailOpen,
  nodeOpen,
  onToggle,
  onToggleNode,
  aiPids,
  devPids,
  focused,
}: {
  row: TreeRow;
  index: number;
  measure: (el: Element | null) => void;
  detailOpen: boolean;
  /** 树形视图下的节点展开态；undefined = 扁平视图，没有子节点概念 */
  nodeOpen?: boolean;
  onToggle: () => void;
  onToggleNode?: () => void;
  aiPids: Set<number>;
  devPids: Set<number>;
  focused: boolean;
}) {
  const t = useT();
  const { p, depth } = row;
  const risky = aiPids.has(p.pid) || devPids.has(p.pid) || p.cpu > 50;

  return (
    <Tr
      data-index={index}
      ref={measure}
      className={focused ? "bg-accent/15" : detailOpen ? "bg-accentsoft/10" : ""}
      onClick={onToggle}
      // 表格行本身不可聚焦，键盘用户无法展开详情：补 role/tabIndex
      // 与 Enter/Space，和鼠标点击等价。
      role="button"
      tabIndex={0}
      aria-expanded={nodeOpen ?? detailOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <Td className="w-6">
        {onToggleNode ? (
          <button
            type="button"
            aria-label={p.name}
            aria-expanded={Boolean(nodeOpen)}
            onClick={(e) => {
              e.stopPropagation();
              onToggleNode();
            }}
            className="flex h-4 w-4 items-center justify-center"
          >
            <Chevron expanded={Boolean(nodeOpen)} dim={false} />
          </button>
        ) : (
          <Chevron expanded={detailOpen} dim={!row.hasChildren} />
        )}
      </Td>
      <Td mono className="text-dim">
        {p.pid}
      </Td>
      <Td className="font-medium max-w-[180px] truncate">
        <span
          className="flex items-center gap-1.5"
          style={depth > 0 ? { paddingLeft: Math.min(depth, 6) * 14 } : undefined}
        >
          {depth > 0 && (
            <span className="text-faint" aria-hidden="true">
              └
            </span>
          )}
          <span className="truncate">{p.name}</span>
          {aiPids.has(p.pid) && <Badge tone="warn">AI</Badge>}
          {devPids.has(p.pid) && <Badge tone="ok">DEV</Badge>}
        </span>
      </Td>
      <Td>
        <CpuCell cpu={p.cpu} />
      </Td>
      <Td>{formatBytes(p.memory)}</Td>
      <Td className="text-dim">{t(`procs.status.${statusKeyOf(p.status)}`)}</Td>
      <Td className="text-xs text-dim">{fromNow(p.start_time)}</Td>
      <Td className="max-w-[240px]">
        <div
          className="truncate font-mono text-[11px] text-dim"
          title={p.cmd_line || p.exe_path}
        >
          {p.cmd_line ? shortPath(p.cmd_line, 60) : shortPath(p.exe_path, 60)}
        </div>
      </Td>
      <Td>
        <Btn
          variant={risky ? "danger" : "ghost"}
          className="!px-2 !py-1 !text-xs"
          title={t("procs.killTitle")}
          onClick={(e) => {
            // 结束进程不该同时展开/收起详情行：按钮在可点击行内，
            // 不阻止冒泡时点「结束」会在弹窗背后把行折叠掉。
            e.stopPropagation();
            useStore.getState().setKillTarget(p);
          }}
        >
          <XCircle size={12} />
        </Btn>
      </Td>
    </Tr>
  );
}

/** 展开箭头。收起时右向、展开时下向且用强调色。 */
function Chevron({ expanded, dim }: { expanded: boolean; dim?: boolean }) {
  if (expanded) return <ChevronDown size={12} className="text-accent" />;
  return <ChevronRight size={12} className={dim ? "text-line" : "text-dim"} />;
}

/** CPU 读数 + 迷你条。阈值色分三档：>50 危险、>10 警告、其余强调色。 */
function CpuCell({ cpu }: { cpu: number }) {
  const tone = cpu > 50 ? "text-danger" : cpu > 10 ? "text-warn" : "";
  const bar = cpu > 50 ? "bg-danger" : cpu > 10 ? "bg-warn" : "bg-accent";
  return (
    <div className="flex items-center gap-2">
      <span className={`num w-11 text-right ${tone}`}>{cpu.toFixed(1)}%</span>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-panel2">
        <span
          className={`block h-full rounded-full ${bar}`}
          style={{ width: `${Math.min(100, cpu)}%` }}
        />
      </span>
    </div>
  );
}
