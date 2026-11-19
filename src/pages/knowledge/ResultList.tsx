import { Search } from "lucide-react";
import { Badge, Btn, Empty, inputCls, Spinner } from "../../ui";
import { useT } from "../../lib/i18n";
import { shortPath } from "../../lib/util";
import type { KnowledgeHit } from "../../types";

export function ResultList({
  query,
  onQuery,
  onSearch,
  hits,
  selected,
  onPick,
  loading,
  hasSources,
}: {
  query: string;
  onQuery: (v: string) => void;
  onSearch: () => void;
  hits: KnowledgeHit[];
  selected: string | null;
  onPick: (hit: KnowledgeHit) => void;
  loading: boolean;
  hasSources: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            className={`${inputCls} pl-7`}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("knowledge.searchPlaceholder")}
            aria-label={t("knowledge.searchPlaceholder")}
          />
        </div>
        <Btn type="submit" variant="primary" disabled={!hasSources || loading}>
          {loading ? <Spinner /> : t("knowledge.search")}
        </Btn>
      </form>

      {!hasSources ? (
        <Empty>{t("knowledge.noSources")}</Empty>
      ) : hits.length === 0 ? (
        <Empty>
          <span className="font-medium text-text">{t("knowledge.noResults")}</span>
          <span className="mt-1 block">{t("knowledge.noResultsHint")}</span>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-[6px] border border-line/70">
          {hits.map((hit) => {
            const active = selected === hit.path;
            return (
              <button
                key={hit.path}
                type="button"
                onClick={() => onPick(hit)}
                className={`flex flex-col gap-1 border-b border-line/60 px-3 py-2.5 text-left last:border-b-0 ${
                  active ? "bg-accentsoft/60" : "hover:bg-panel2/60"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">
                    {hit.title}
                  </span>
                  {hit.project_id && <Badge tone="accent">{hit.project_id}</Badge>}
                </span>
                {hit.snippet && (
                  <span className="line-clamp-2 text-[11px] leading-relaxed text-dim">
                    {hit.snippet}
                  </span>
                )}
                <span className="truncate font-mono text-[10px] text-faint">
                  {shortPath(hit.path, 64)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
