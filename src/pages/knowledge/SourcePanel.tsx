import { FolderOpen, FolderPlus, RefreshCw, X } from "lucide-react";
import { Btn, Card, Field, SectionTitle, inputCls } from "../../ui";
import { localeFor, useLang, useT } from "../../lib/i18n";
import type { KnowledgeSource, KnowledgeStatus } from "../../types";

export function SourcePanel({
  status,
  draft,
  onDraft,
  onAdd,
  onBrowse,
  canBrowse,
  onRemove,
  onReindex,
  indexing,
}: {
  status: KnowledgeStatus;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: () => void;
  onBrowse: () => void;
  canBrowse: boolean;
  onRemove: (source: KnowledgeSource) => void;
  onReindex: () => void;
  indexing: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const last = status.last_indexed_at
    ? new Date(status.last_indexed_at * 1000).toLocaleString(localeFor(lang))
    : t("knowledge.never");

  return (
    <Card>
      <SectionTitle
        extra={
          <Btn onClick={onReindex} disabled={indexing}>
            <RefreshCw size={13} className={indexing ? "animate-spin" : ""} />
            {indexing ? t("knowledge.reindexing") : t("knowledge.reindex")}
          </Btn>
        }
      >
        {t("knowledge.sources")}
      </SectionTitle>

      {status.sources.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {status.sources.map((s) => (
            <div
              key={s.path}
              className="flex min-w-0 items-center gap-2 rounded-[5px] border border-line/70 bg-panel2/40 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-text">
                {s.name}
                <span className="ml-2 font-mono text-[10.5px] text-faint">{s.path}</span>
              </span>
              <button
                type="button"
                aria-label={`${t("knowledge.remove")} ${s.name}`}
                title={t("knowledge.remove")}
                onClick={() => onRemove(s)}
                className="shrink-0 rounded p-0.5 text-faint hover:text-danger"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-3 rounded-[5px] border border-dashed border-line/80 px-3 py-3 text-[12px] leading-relaxed text-dim">
          {t("knowledge.noSourcesHint")}
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label={t("knowledge.addSource")}>
            <input
              className={inputCls}
              value={draft}
              placeholder={t("knowledge.sourcePlaceholder")}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAdd();
              }}
            />
          </Field>
        </div>
        {canBrowse && (
          <Btn onClick={onBrowse} title={t("knowledge.browse")}>
            <FolderOpen size={13} />
          </Btn>
        )}
        <Btn variant="primary" onClick={onAdd} disabled={!draft.trim()}>
          <FolderPlus size={13} /> {t("knowledge.add")}
        </Btn>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-faint">
        <span>{t("knowledge.docCount", { count: status.doc_count })}</span>
        <span>
          {t("knowledge.lastIndexed")}: {last}
        </span>
      </div>
    </Card>
  );
}
