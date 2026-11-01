import { useMemo, useState } from "react";
import { Clock, Copy, Hash, Terminal } from "lucide-react";
import { EChart } from "../../lib/echarts";
import { chartGapColor, seriesColors } from "../../lib/chartTheme";
import { useStore } from "../../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../../lib/i18n";
import {
  Badge,
  Btn,
  Card,
  Empty,
  ErrorState,
  Modal,
  SectionTitle,
  Table,
  Td,
  Tr,
} from "../../ui";
import { formatBytes, fromNow } from "../../lib/util";
import { isPieWorthRendering, toolDistribution } from "../../lib/aggregate";
import type { SessionFilePreview } from "../../types";
import { InfoChip } from "./AiProcessPanel";

/** 本地会话文件表 + 工具分布 + 文件预览弹窗。 */
export function SessionFilesPanel() {
  const t = useT();
  const { theme, sessionFiles, sessionFilesErr, refreshAi, setToast } = useStore(
    useShallow((s) => ({
      theme: s.theme,
      sessionFiles: s.sessionFiles,
      sessionFilesErr: s.sessionFilesErr,
      refreshAi: s.refreshAi,
      setToast: s.setToast,
    }))
  );
  const [previewFile, setPreviewFile] = useState<SessionFilePreview | null>(null);
  const colors = useMemo(() => seriesColors(theme), [theme]);
  const toolCounts = useMemo(() => toolDistribution(sessionFiles), [sessionFiles]);

  const sessionToolChart = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: t("ai.sessionToolTooltip") },
      series: [
        {
          id: "tool-pie",
          type: "pie",
          radius: ["42%", "64%"],
          label: { show: false },
          labelLine: { show: false },
          data: toolCounts.map(([name, value], i) => ({
            name,
            value,
            itemStyle: {
              color: colors[i % colors.length],
              borderColor: chartGapColor(theme),
              borderWidth: 2,
            },
          })),
        },
      ],
    }),
    [toolCounts, theme, t, colors]
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionTitle>
            {t("ai.localSessionRecords", { count: sessionFiles.length })}
          </SectionTitle>
          {sessionFilesErr ? (
            <ErrorState onRetry={() => void refreshAi()} retryLabel={t("ai.retry")}>
              {t("ai.sessionFilesFailed")}
            </ErrorState>
          ) : sessionFiles.length === 0 ? (
            <Empty>{t("ai.noLocalSessions")}</Empty>
          ) : (
            <Table
              head={[
                t("ai.table.tool"),
                t("ai.table.project"),
                t("ai.table.messageCount"),
                t("ai.table.modified"),
                t("ai.table.size"),
                t("ai.table.file"),
              ]}
            >
              {sessionFiles.map((f) => (
                // path 是天然唯一键（同一会话文件的路径不会重复）
                <Tr
                  key={f.path}
                  className="cursor-pointer hover:bg-accentsoft/20"
                  onClick={() => setPreviewFile(f)}
                  // 行本身不可聚焦：补键盘等价入口，否则无法用键盘看预览
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPreviewFile(f);
                    }
                  }}
                >
                  <Td>
                    <Badge tone={f.tool.includes("Claude") ? "accent" : "ok"}>
                      {f.tool}
                    </Badge>
                  </Td>
                  <Td className="max-w-[160px] truncate font-medium" title={f.project}>
                    {f.project || "—"}
                  </Td>
                  <Td>
                    <Badge tone={f.message_count > 0 ? "accent" : "dim"}>
                      {f.message_count > 0 ? f.message_count : "—"}
                    </Badge>
                  </Td>
                  <Td className="text-xs text-dim">{fromNow(f.modified)}</Td>
                  <Td className="text-xs text-dim">{formatBytes(f.size)}</Td>
                  <Td
                    className="max-w-[180px] truncate font-mono text-[11px] text-dim"
                    title={f.path}
                  >
                    {f.path.split(/[\\/]/).pop()}
                  </Td>
                </Tr>
              ))}
            </Table>
          )}
        </Card>

        <Card className="">
          <SectionTitle>{t("ai.toolDist")}</SectionTitle>
          {sessionFilesErr ? null : toolCounts.length > 0 ? (
            <>
              {isPieWorthRendering(toolCounts) && (
                <EChart option={sessionToolChart} style={{ height: 160 }} lazyUpdate />
              )}
              <div className="mt-2 space-y-1.5">
                {toolCounts.map(([tool, count], i) => (
                  <div key={tool} className="flex items-center gap-2 text-xs">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: colors[i % colors.length] }}
                    />
                    <span className="text-dim">{tool}</span>
                    <span className="ml-auto font-mono text-text">{count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty icon={Terminal}>{t("ai.noData")}</Empty>
          )}
        </Card>
      </div>

      <Modal
        open={!!previewFile}
        title={previewFile ? `${previewFile.tool} / ${previewFile.project}` : ""}
        onClose={() => setPreviewFile(null)}
        wide
      >
        {previewFile && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <InfoChip
                icon={Hash}
                label={t("ai.messageCount")}
                value={String(previewFile.message_count)}
              />
              <InfoChip
                icon={Clock}
                label={t("ai.modifiedTime")}
                value={fromNow(previewFile.modified)}
              />
              <InfoChip
                icon={Terminal}
                label={t("ai.size")}
                value={formatBytes(previewFile.size)}
              />
            </div>
            {previewFile.first_line && (
              <CopyBlock
                label={t("ai.firstLine")}
                text={previewFile.first_line}
                onCopied={() => setToast(t("ai.copied"))}
              />
            )}
            {previewFile.last_line &&
              previewFile.last_line !== previewFile.first_line && (
                <CopyBlock
                  label={t("ai.lastLine")}
                  text={previewFile.last_line}
                  onCopied={() => setToast(t("ai.copied"))}
                />
              )}
            <div className="break-all text-[11px] text-dim">
              {t("ai.fileLabel", { path: previewFile.path })}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function CopyBlock({
  label,
  text,
  onCopied,
}: {
  label: string;
  text: string;
  onCopied: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-dim">
        <span>{label}</span>
        <Btn
          className="!px-2 !py-0.5 !text-[10px]"
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(onCopied)
              .catch(() => {});
          }}
        >
          <Copy size={10} />
        </Btn>
      </div>
      <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded-[var(--radius-btn)] border border-line bg-bg p-3 text-[11px]">
        {text}
      </pre>
    </div>
  );
}
