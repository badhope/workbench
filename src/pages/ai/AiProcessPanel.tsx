import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { EChart } from "../../lib/echarts";
import { useStore } from "../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../../lib/i18n";
import {
  Badge,
  Btn,
  Card,
  Empty,
  SectionTitle,
  Spinner,
  StatCard,
  Table,
  Td,
  Tr,
} from "../../ui";
import { formatBytes, formatDuration, formatTime, fromNow } from "../../lib/util";
import { totalMessageCount } from "../../lib/aggregate";
import type { OpencodeSession, SessionDetail } from "../../types";

/** AI 进程 + 在线会话 + 本地会话文件统计。 */
export function AiProcessPanel() {
  const t = useT();
  const { ais, sessions, sessionFiles } = useStore(
    useShallow((s) => ({
      ais: s.ais,
      sessions: s.sessions,
      sessionFiles: s.sessionFiles,
    }))
  );
  const totalMessages = useMemo(() => totalMessageCount(sessionFiles), [sessionFiles]);

  const aiMemChart = useMemo(() => {
    const sorted = [...ais].sort((a, b) => b.memory - a.memory).slice(0, 8);
    const values = sorted.map((a) => Math.round(a.memory / 1024 / 1024));
    // 条形末端还要放 "NNN MB" 标签。若轴上限正好等于最大值，标签会压在
    // 最右一个刻度上（实测 180 MB 与刻度 180 重叠成一团）。留 30% 余量。
    const peak = Math.max(...values, 1);
    return {
      grid: { left: 90, right: 56, top: 8, bottom: 8 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: {
        type: "value",
        max: Math.ceil((peak * 1.3) / 10) * 10,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: sorted.map((a) =>
          a.name.length > 16 ? a.name.slice(0, 16) + "…" : a.name
        ),
        inverse: true,
        axisLabel: { fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          id: "ai-memory",
          type: "bar",
          data: values,
          barWidth: 14,
          label: { show: true, position: "right", fontSize: 10, formatter: "{c} MB" },
        },
      ],
    };
  }, [ais]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={Sparkles}
          label={t("ai.aiProcesses")}
          value={ais.length}
          tone="warn"
        />
        <StatCard
          icon={MessageSquare}
          label={t("ai.onlineSessions")}
          value={sessions.length}
          tone="accent"
        />
        <StatCard
          icon={Terminal}
          label={t("ai.localSessionFiles")}
          value={sessionFiles.length}
          tone="ok"
        />
        <StatCard
          icon={Hash}
          label={t("ai.totalMessages")}
          value={totalMessages || "—"}
          tone="text"
        />
      </div>

      <Card className="">
        <SectionTitle>{t("ai.aiMemTitle")}</SectionTitle>
        {ais.length > 0 ? (
          <EChart
            option={aiMemChart}
            style={{ height: Math.max(120, ais.length * 36) }}
            lazyUpdate
          />
        ) : (
          <Empty icon={Sparkles}>{t("ai.noAiProcesses")}</Empty>
        )}
      </Card>

      <Card className="">
        <SectionTitle>{t("ai.aiAgentProcesses", { count: ais.length })}</SectionTitle>
        {ais.length === 0 ? (
          <Empty>{t("ai.noAiAgents")}</Empty>
        ) : (
          <Table
            head={[
              t("ai.table.process"),
              t("ai.table.matchedKeyword"),
              t("ai.table.pid"),
              t("ai.table.memory"),
              t("ai.table.startedAt"),
              t("ai.table.commandLine"),
            ]}
          >
            {ais.map((a) => (
              <Tr key={a.pid}>
                <Td className="font-medium">
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={12} className="text-warn" />
                    {a.name}
                  </span>
                </Td>
                <Td>
                  <Badge tone="warn">{a.matched}</Badge>
                </Td>
                <Td mono className="text-dim">
                  {a.pid}
                </Td>
                <Td>{formatBytes(a.memory)}</Td>
                <Td className="text-xs text-dim">{fromNow(a.start_time)}</Td>
                <Td
                  className="max-w-[280px] truncate font-mono text-[11px] text-dim"
                  title={a.cmd_line}
                >
                  {a.cmd_line}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

export function OpencodeSessionsPanel() {
  const t = useT();
  const {
    sessions,
    opencodePort,
    sessionsErr,
    sessionDetail,
    sessionDetailLoading,
    loadSessionDetail,
    refreshAi,
  } = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      opencodePort: s.opencodePort,
      sessionsErr: s.sessionsErr,
      sessionDetail: s.sessionDetail,
      sessionDetailLoading: s.sessionDetailLoading,
      loadSessionDetail: s.loadSessionDetail,
      refreshAi: s.refreshAi,
    }))
  );
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const openSessionDetail = (port: number, id: string) => {
    if (expandedSession === id) {
      setExpandedSession(null);
      return;
    }
    setExpandedSession(id);
    loadSessionDetail(port, id);
  };

  return (
    <Card className="">
      <SectionTitle
        extra={
          <Btn onClick={refreshAi} className="!py-1 !text-xs">
            <RefreshCw size={12} /> {t("ai.refresh")}
          </Btn>
        }
      >
        {t("ai.opencodeSessions", { count: sessions.length })}
      </SectionTitle>
      {sessions.length === 0 ? (
        <div className="flex flex-col gap-2">
          <Empty>{t("ai.opencodeUnreachable")}</Empty>
          {sessionsErr && (
            <div className="rounded-[var(--radius-btn)] border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              {sessionsErr}
              <br />
              {t("ai.opencodeHintPrefix")}{" "}
              <span className="font-mono">opencode serve</span>
              {t("ai.opencodeHintSuffix")}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              expanded={expandedSession === s.id}
              loading={sessionDetailLoading}
              detail={sessionDetail}
              port={opencodePort}
              onOpen={openSessionDetail}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function MessageBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-dim">{label}</div>
      <div className="max-h-[100px] overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-btn)] border border-line bg-bg px-3 py-2 text-xs">
        {text}
      </div>
    </div>
  );
}

export function InfoChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-bg px-2.5 py-1.5">
      <Icon size={11} className="text-warn" />
      <span className="text-dim">{label}</span>
      <span className="font-mono font-medium text-text">{value}</span>
    </div>
  );
}

/** 一条在线会话：折叠时只有标题与时间，展开后拉取并显示详情。 */
function SessionRow({
  session: s,
  expanded,
  loading,
  detail,
  port,
  onOpen,
}: {
  session: OpencodeSession;
  expanded: boolean;
  loading: boolean;
  detail: SessionDetail | null;
  port: number;
  onOpen: (port: number, id: string) => void;
}) {
  const toolCounts = useMemo(
    () => countTools(detail?.tools_used ?? []),
    [detail?.tools_used]
  );
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel2 transition-all">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accentsoft/30"
        onClick={() => onOpen(port, s.id)}
      >
        <Chevron expanded={expanded} />
        <MessageSquare size={14} className="shrink-0 text-accent" />
        <span className="flex-1 truncate font-medium">{s.title}</span>
        <span className="hidden font-mono text-xs text-dim sm:block">
          {s.id.slice(0, 8)}
        </span>
        <span className="text-xs text-dim">{s.created ? formatTime(s.created) : ""}</span>
        {loading && expanded && <Spinner />}
      </button>

      {expanded && detail && detail.id === s.id && (
        <SessionDetailBody detail={detail} tools={toolCounts} />
      )}
    </div>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown size={14} className="shrink-0 text-accent" />
  ) : (
    <ChevronRight size={14} className="shrink-0 text-dim" />
  );
}

/** 展开的会话详情：错误提示、三个读数、首末消息、工具分布。 */
function SessionDetailBody({
  detail,
  tools,
}: {
  detail: SessionDetail;
  tools: [string, number][];
}) {
  const t = useT();
  return (
    <div className="space-y-3 border-t border-line bg-panel/50 px-4 py-4 text-sm">
      {detail.error && !detail.message_count && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {detail.error}
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-xs">
        <InfoChip
          icon={Hash}
          label={t("ai.messageCount")}
          value={String(detail.message_count)}
        />
        <InfoChip
          icon={Clock}
          label={t("ai.duration")}
          value={formatDuration(detail.duration_seconds)}
        />
        <InfoChip icon={Wrench} label={t("ai.toolsUsed")} value={String(tools.length)} />
      </div>
      {detail.first_message && (
        <MessageBlock label={t("ai.firstMessage")} text={detail.first_message} />
      )}
      {detail.last_message && detail.last_message !== detail.first_message && (
        <MessageBlock label={t("ai.lastMessage")} text={detail.last_message} />
      )}
      {tools.length > 0 && <ToolBadges tools={tools} />}
    </div>
  );
}

/** 工具使用次数徽章。 */
function ToolBadges({ tools }: { tools: [string, number][] }) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-dim">{t("ai.toolDistTitle")}</div>
      <div className="flex flex-wrap gap-1.5">
        {tools.map(([tool, count]) => (
          <Badge key={tool} tone="accent">
            {tool} <span className="ml-1 opacity-60">×{count}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** 工具名计数（保留首次出现顺序）。 */
function countTools(tools: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const tool of tools) m.set(tool, (m.get(tool) ?? 0) + 1);
  return [...m.entries()];
}
