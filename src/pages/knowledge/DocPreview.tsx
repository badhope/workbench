import { ExternalLink, FileText } from "lucide-react";
import { Badge, Btn, Empty, Skeleton } from "../../ui";
import { localeFor, useLang, useT } from "../../lib/i18n";
import { shortPath } from "../../lib/util";
import type { KnowledgeDoc } from "../../types";
import { MarkdownView } from "./MarkdownView";

export function DocPreview({
  doc,
  loading,
  onOpen,
  opening,
  canOpen,
  onProject,
}: {
  doc: KnowledgeDoc | null;
  loading: boolean;
  onOpen: () => void;
  opening: boolean;
  canOpen: boolean;
  onProject: (id: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  if (loading) return <Skeleton lines={8} className="p-4" />;
  if (!doc) return <Empty icon={FileText}>{t("knowledge.selectHint")}</Empty>;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-line/70 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-text">{doc.title}</h2>
            <p className="mt-1 truncate font-mono text-[10.5px] text-faint">
              {shortPath(doc.path, 80)}
            </p>
          </div>
          <Btn
            onClick={onOpen}
            disabled={!canOpen || opening}
            title={t("knowledge.open")}
          >
            <ExternalLink size={13} /> {t("knowledge.open")}
          </Btn>
        </div>
        {(doc.tags.length > 0 || doc.project_id) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {doc.project_id && (
              <button
                type="button"
                onClick={() => onProject(doc.project_id!)}
                title={t("knowledge.project")}
                className="rounded-[4px] focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Badge tone="accent">{doc.project_id}</Badge>
              </button>
            )}
            {doc.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10.5px] text-faint">
          {t("knowledge.modified")}:{" "}
          {new Date(doc.mtime * 1000).toLocaleString(localeFor(lang))}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MarkdownView body={doc.body} />
      </div>
    </div>
  );
}
