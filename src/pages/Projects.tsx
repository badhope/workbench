import { useCallback, useMemo, useState } from "react";
import { ArrowRight, FolderOpen, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Modal,
  inputCls,
  type Tone,
} from "../ui";
import { shortPath } from "../lib/util";
import { isProjectRunning } from "../lib/aggregate";
import { nextTaskForProject, projectGoal, projectProgress } from "../lib/workbench";
import { useT } from "../lib/i18n";
import type { Project } from "../types";

const STATUS_MAP: Record<string, { tone: Tone }> = {
  active: { tone: "ok" },
  paused: { tone: "warn" },
  archived: { tone: "dim" },
};

interface Draft {
  id?: string;
  name: string;
  path: string;
  status: string;
  tags: string;
  pinned: boolean;
  note: string;
  goal: string;
}

const emptyDraft: Draft = {
  name: "",
  path: "",
  status: "active",
  tags: "",
  pinned: false,
  note: "",
  goal: "",
};

export default function Projects() {
  const t = useT();

  const {
    data,
    devs,
    addProject,
    updateProject,
    deleteProject,
    setView,
    setTaskProjectFilter,
    setTaskScope,
    openTarget,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      devs: s.devs,
      addProject: s.addProject,
      updateProject: s.updateProject,
      deleteProject: s.deleteProject,
      setView: s.setView,
      setTaskProjectFilter: s.setTaskProjectFilter,
      setTaskScope: s.setTaskScope,
      openTarget: s.openTarget,
    }))
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const statusLabel = useCallback(
    (s: string) =>
      s === "active"
        ? t("projects.statusActive")
        : s === "paused"
          ? t("projects.statusPaused")
          : s === "archived"
            ? t("projects.statusArchived")
            : s,
    [t]
  );

  const runningDirs = useMemo(() => devs.map((d) => d.project_dir), [devs]);

  const isRunning = (p: Project) => isProjectRunning(p.path, runningDirs);

  const sorted = useMemo(
    () => [...data.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [data.projects]
  );

  const openProjectTasks = (projectId: string) => {
    setTaskProjectFilter(projectId);
    setTaskScope("all");
    setView("tasks");
  };

  const submit = () => {
    if (!draft?.name.trim()) return;
    const payload = {
      name: draft.name,
      path: draft.path,
      status: draft.status,
      tags: draft.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      pinned: draft.pinned,
      note: draft.note,
      // 清空就清掉 goal（undefined 不会写进磁盘），显示层再回落到 note。
      goal: draft.goal.trim() || undefined,
    };
    const accepted = draft.id ? updateProject(draft.id, payload) : addProject(payload);
    if (accepted) setDraft(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── 顶部操作 ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-dim">
          {t("projects.totalCount", { count: data.projects.length })}
        </span>
        <Btn
          variant="primary"
          className="ml-auto"
          onClick={() => setDraft({ ...emptyDraft })}
        >
          <Plus size={14} /> {t("projects.new")}
        </Btn>
      </div>

      {data.projects.length === 0 ? (
        <Card>
          {/* 空状态必须给下一步动作：只写「还没有项目」用户得自己找按钮 */}
          <Empty
            action={
              <Btn variant="primary" onClick={() => setDraft({ ...emptyDraft })}>
                <Plus size={13} /> {t("projects.newFirst")}
              </Btn>
            }
          >
            {t("projects.emptyHint", {
              newProject: t("projects.new"),
              running: t("projects.running"),
            })}
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => {
            const st = STATUS_MAP[p.status] ?? STATUS_MAP.active;
            const progress = projectProgress(p.id, data.tasks);
            const next = nextTaskForProject(p.id, data.tasks);
            return (
              <Card key={p.id} className="card-hover flex flex-col gap-2.5 px-4 py-3.5">
                <div className="flex items-start gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{p.name}</span>
                  {p.pinned && <Pin size={12} className="mt-1 shrink-0 text-accent" />}
                  <div className="ml-auto flex shrink-0 gap-1">
                    <Badge tone={st.tone}>{statusLabel(p.status)}</Badge>
                    {isRunning(p) && <Badge tone="ok">{t("projects.running")}</Badge>}
                  </div>
                </div>

                <p className="line-clamp-2 min-h-[2.6em] text-[11.5px] leading-relaxed text-dim">
                  {projectGoal(p) || t("projects.noGoal")}
                </p>

                <div>
                  <div className="mb-1 flex items-center justify-between text-[10.5px] text-dim">
                    <span>{t("projects.progress", { done: progress.done, total: progress.total })}</span>
                    <span className="flex items-center gap-1.5">
                      {progress.overdue > 0 && (
                        <span className="text-danger">
                          {t("projects.overdueCount", { count: progress.overdue })}
                        </span>
                      )}
                      <span className="num text-faint">{progress.percent}%</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openProjectTasks(p.id)}
                  className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/70 bg-panel2/40 px-2.5 py-1.5 text-left transition-colors hover:border-accent/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9.5px] font-medium tracking-[0.04em] text-faint">
                      {t("projects.nextAction")}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px]">
                      {next ? next.title : t("projects.noOpenTasks")}
                    </span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-faint" />
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="text-[11px] text-accent hover:underline"
                    onClick={() => openProjectTasks(p.id)}
                  >
                    {t("projects.openTasks")}
                  </button>
                  <span className="text-faint">·</span>
                  <span className="text-[11px] text-dim">
                    {t("projects.taskCount", { count: progress.total })}
                  </span>
                </div>

                {p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((tag) => (
                      <Badge key={tag} tone="dim">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex items-center gap-1 border-t border-line/60 pt-2">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[10px] text-faint"
                    title={p.path}
                  >
                    {p.path ? shortPath(p.path, 44) : t("projects.unboundPath")}
                  </span>
                  {p.path && (
                    <Btn
                      className="!px-2 !py-1 !text-xs"
                      title={t("projects.openDir")}
                      onClick={() => openTarget(p.path)}
                    >
                      <FolderOpen size={12} />
                    </Btn>
                  )}
                  <Btn
                    className="!px-2 !py-1 !text-xs"
                    title={t("projects.edit")}
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        name: p.name,
                        path: p.path,
                        status: p.status,
                        tags: p.tags.join(", "),
                        pinned: p.pinned,
                        note: p.note,
                        goal: p.goal ?? "",
                      })
                    }
                  >
                    <Pencil size={12} />
                  </Btn>
                  <Btn
                    variant="danger"
                    className="!px-2 !py-1 !text-xs"
                    title={t("projects.deleteTitle")}
                    onClick={() => setPendingDelete(p)}
                  >
                    <Trash2 size={12} />
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("projects.deleteTitle")}
        body={t("projects.deleteConfirm", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("projects.deleteAction")}
        cancelLabel={t("projects.cancel")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteProject(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <Modal
        open={!!draft}
        title={draft?.id ? t("projects.editTitle") : t("projects.new")}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Btn onClick={() => setDraft(null)}>{t("projects.cancel")}</Btn>
            <Btn variant="primary" onClick={submit}>
              {t("projects.save")}
            </Btn>
          </>
        }
      >
        {draft && (
          <>
            <Field label={t("projects.fieldName")}>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("projects.placeholderName")}
              />
            </Field>
            <Field label={t("projects.fieldPath")}>
              <input
                className={inputCls}
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                placeholder="C:\proj\shop-web"
              />
            </Field>
            <Field label={t("projects.status")}>
              <select
                className={inputCls}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="active">{t("projects.statusActive")}</option>
                <option value="paused">{t("projects.statusPaused")}</option>
                <option value="archived">{t("projects.statusArchived")}</option>
              </select>
            </Field>
            <Field label={t("projects.fieldTags")}>
              <input
                className={inputCls}
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder={t("projects.placeholderTags")}
              />
            </Field>
            <Field label={t("projects.fieldGoal")}>
              <input
                className={inputCls}
                value={draft.goal}
                onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                placeholder={t("projects.placeholderGoal")}
              />
            </Field>
            <Field label={t("projects.fieldNote")}>
              <textarea
                className={inputCls}
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              {t("projects.pinLabel")}
            </label>
          </>
        )}
      </Modal>
    </div>
  );
}
