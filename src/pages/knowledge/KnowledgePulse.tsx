import { useMemo } from "react";
import { seriesColors } from "../../lib/chartTheme";
import { useLang, useT, localeFor } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import type { KnowledgeHit, KnowledgeStatus } from "../../types";
import { DistributionBar, StatStrip } from "../../components/live/StatStrip";

/**
 * 知识库脉搏：来源、索引量、当前命中和标签分布。
 * 标签直接从 hits 聚合，不新增第二套知识元数据。
 */
export function KnowledgePulse({
  status,
  hits,
}: {
  status: KnowledgeStatus;
  hits: KnowledgeHit[];
}) {
  const t = useT();
  const lang = useLang();
  const theme = useStore((s) => s.theme);
  const colors = seriesColors(theme);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const hit of hits) {
      for (const tag of hit.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [hits]);

  const lastIndexed = status.last_indexed_at
    ? new Date(status.last_indexed_at * 1000).toLocaleString(localeFor(lang))
    : t("knowledge.never");

  return (
    <section className="rounded-[var(--radius-card)] border border-line/80 bg-panel/80 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10.5px] font-medium tracking-[0.05em] text-faint">
            {t("knowledge.pulseTitle")}
          </div>
          <div className="mt-0.5 text-[11px] text-dim">{t("knowledge.pulseSub")}</div>
        </div>
        <span className="text-[9.5px] text-faint">
          {t("knowledge.lastIndexed")} · {lastIndexed}
        </span>
      </div>

      <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <StatStrip
          items={[
            {
              key: "sources",
              label: t("knowledge.metricSources"),
              value: status.sources.length,
              tone: "accent",
            },
            {
              key: "notes",
              label: t("knowledge.metricNotes"),
              value: status.doc_count,
              tone: "ok",
            },
            {
              key: "hits",
              label: t("knowledge.metricHits"),
              value: hits.length,
              tone: "warn",
            },
            {
              key: "tags",
              label: t("knowledge.metricTags"),
              value: tags.length,
              tone: "dim",
            },
          ]}
        />
        <div className="min-w-0">
          <div className="mb-1.5 text-[9.5px] text-faint">{t("knowledge.tagDist")}</div>
          <DistributionBar
            emptyLabel={t("knowledge.noTags")}
            segments={tags.map((tag, index) => ({
              key: tag.label,
              label: tag.label,
              count: tag.count,
              color: colors[index % colors.length],
            }))}
          />
        </div>
      </div>
    </section>
  );
}
