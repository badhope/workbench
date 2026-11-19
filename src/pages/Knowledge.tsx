import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Btn, ConfirmDialog, ErrorState, Skeleton, Spinner } from "../ui";
import { useStore } from "../lib/store";
import {
  isTauri,
  knowledgeAddSource,
  knowledgeOpen,
  knowledgeRead,
  pickKnowledgeFolder,
  knowledgeReindex,
  knowledgeRemoveSource,
  knowledgeSearch,
  knowledgeStatus,
} from "../lib/api";
import { takeKnowledgeRequest, subscribeKnowledge } from "../lib/knowledgeBus";
import { useT } from "../lib/i18n";
import type {
  KnowledgeDoc,
  KnowledgeHit,
  KnowledgeSource,
  KnowledgeStatus,
} from "../types";
import { SourcePanel } from "./knowledge/SourcePanel";
import { ResultList } from "./knowledge/ResultList";
import { DocPreview } from "./knowledge/DocPreview";
import { AiAccessCard } from "./knowledge/AiAccessCard";

/** 知识库：本地 Markdown 的浏览入口，不做编辑器，也不复制正文到数据库。 */
export default function Knowledge() {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const projects = useStore((s) => s.data.projects);
  const setView = useStore((s) => s.setView);
  const setTaskProjectFilter = useStore((s) => s.setTaskProjectFilter);
  const setTaskScope = useStore((s) => s.setTaskScope);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [confirm, setConfirm] = useState<KnowledgeSource | null>(null);

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    try {
      setHits(await knowledgeSearch(q, 30));
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const loadDoc = useCallback(
    async (path: string) => {
      setSelected(path);
      setDocLoading(true);
      try {
        setDoc(await knowledgeRead(path));
        setError("");
      } catch (e) {
        setDoc(null);
        setToast(String(e));
      } finally {
        setDocLoading(false);
      }
    },
    [setToast]
  );

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, recent] = await Promise.all([
        knowledgeStatus(),
        knowledgeSearch("", 30),
      ]);
      setStatus(nextStatus);
      setHits(recent);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    // 知识库是外部文件，首次进入读取一次即可；放到微任务里，
    // 避免 effect 同步体直接触发 setState（React 会判为级联渲染）。
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const apply = (req: ReturnType<typeof takeKnowledgeRequest>) => {
      if (!req) return;
      if (req.query !== undefined) {
        setQuery(req.query);
        void runSearch(req.query);
      }
      if (req.path) void loadDoc(req.path);
    };
    apply(takeKnowledgeRequest());
    return subscribeKnowledge(apply);
  }, [runSearch, loadDoc]);

  async function addSource(pathOverride?: string) {
    const path = (pathOverride ?? draft).trim();
    if (!path) return;
    try {
      const next = await knowledgeAddSource(path);
      setStatus(next);
      setDraft("");
      setToast(t("knowledge.sourceAdded"));
      await runSearch(query);
    } catch (e) {
      setToast(String(e));
    }
  }

  async function browseSource() {
    const path = await pickKnowledgeFolder();
    if (path) {
      setDraft(path);
      await addSource(path);
    }
  }

  async function removeSource(source: KnowledgeSource) {
    try {
      const next = await knowledgeRemoveSource(source.path);
      setStatus(next);
      setConfirm(null);
      if (selected?.startsWith(source.path)) {
        setSelected(null);
        setDoc(null);
      }
      setToast(t("knowledge.sourceRemoved"));
      await runSearch(query);
    } catch (e) {
      setToast(String(e));
    }
  }

  async function reindex() {
    setIndexing(true);
    try {
      const next = await knowledgeReindex();
      setStatus(next);
      setToast(t("knowledge.indexDone", { count: next.doc_count }));
      await runSearch(query);
    } catch (e) {
      setToast(t("knowledge.indexFailed", { err: String(e) }));
    } finally {
      setIndexing(false);
    }
  }

  function openProject(id: string) {
    const project = projects.find((p) => p.id === id || p.name === id);
    if (!project) {
      setToast(t("knowledge.projectMissing", { id }));
      return;
    }
    setTaskProjectFilter(project.id);
    setTaskScope("all");
    setView("tasks");
  }

  async function openDoc() {
    if (!doc) return;
    setOpening(true);
    try {
      await knowledgeOpen(doc.path);
    } catch (e) {
      setToast(String(e));
    } finally {
      setOpening(false);
    }
  }

  if (error && !status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <ErrorState onRetry={() => void refresh()}>{error}</ErrorState>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Skeleton lines={2} />
        <Skeleton lines={8} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line/70 pb-3">
        <BookOpen size={14} className="text-accent" />
        <span className="section-title">{t("knowledge.pageTitle")}</span>
        <span className="text-[11px] text-faint">{t("knowledge.pageSub")}</span>
        <span className="ml-auto flex items-center gap-2">
          {error && <span className="text-[11px] text-danger">{error}</span>}
          {searching && <Spinner />}
          <Btn onClick={() => void reindex()} disabled={indexing}>
            {indexing ? t("knowledge.reindexing") : t("knowledge.reindex")}
          </Btn>
        </span>
      </div>

      {/* 桌面三栏：来源 / 结果 / 预览；窄屏纵向堆叠，不复制第二套布局。 */}
      <div className="mt-4 grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-[minmax(240px,0.75fr)_minmax(260px,1fr)] xl:grid-cols-[minmax(240px,0.72fr)_minmax(280px,0.9fr)_minmax(0,1.25fr)]">
        <div className="flex min-h-0 flex-col gap-4">
          <SourcePanel
            status={status}
            draft={draft}
            onDraft={setDraft}
            onAdd={() => void addSource()}
            onBrowse={() => void browseSource()}
            canBrowse={isTauri()}
            onRemove={setConfirm}
            onReindex={() => void reindex()}
            indexing={indexing}
          />
          <AiAccessCard />
        </div>

        <div className="flex min-h-[280px] flex-col gap-3 lg:min-h-0">
          <ResultList
            query={query}
            onQuery={setQuery}
            onSearch={() => void runSearch(query)}
            hits={hits}
            selected={selected}
            onPick={(hit) => void loadDoc(hit.path)}
            loading={searching}
            hasSources={status.sources.length > 0}
          />
        </div>

        <div className="min-h-[320px] overflow-hidden rounded-[var(--radius-card)] border border-line/80 bg-panel lg:col-span-2 lg:min-h-0 xl:col-span-1">
          <DocPreview
            doc={doc}
            loading={docLoading}
            onOpen={() => void openDoc()}
            opening={opening}
            canOpen={isTauri()}
            onProject={openProject}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={t("knowledge.removeConfirmTitle")}
        body={t("knowledge.removeConfirmBody")}
        confirmLabel={t("knowledge.remove")}
        cancelLabel={t("knowledge.cancel")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void removeSource(confirm)}
      />
    </div>
  );
}
