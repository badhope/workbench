import { useState } from "react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../lib/i18n";
import { Btn, ConfirmDialog, Field, Modal, inputCls } from "../ui";
import { fromNow } from "../lib/util";
import type { Project, Task } from "../types";

/**
 * 全局任务详情。
 *
 * 关闭时卸载，打开时用 task.id 作为 key，避免切换任务时把上一份草稿
 * 带进新任务；保存走现有 updateTask，删除沿用带确认的 ConfirmDialog。
 */
export function TaskDetail() {
  const {
    task,
    projects,
    updateTask,
    deleteTask,
    setTaskDetailId,
  } = useStore(
    useShallow((s) => ({
      task:
        s.taskDetailId === null
          ? null
          : (s.data.tasks.find((item) => item.id === s.taskDetailId) ?? null),
      projects: s.data.projects,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      setTaskDetailId: s.setTaskDetailId,
    }))
  );

  if (!task) return null;
  return (
    <TaskEditor
      key={task.id}
      task={task}
      projects={projects}
      updateTask={updateTask}
      deleteTask={deleteTask}
      onClose={() => setTaskDetailId(null)}
    />
  );
}

function TaskEditor({
  task,
  projects,
  updateTask,
  deleteTask,
  onClose,
}: {
  task: Task;
  projects: Project[];
  updateTask: (id: string, patch: Partial<Task>) => boolean;
  deleteTask: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState({
    title: task.title,
    status: task.status,
    priority: task.priority,
    due: task.due ?? "",
    projectId: task.project_id ?? "",
    tags: task.tags.join(", "),
    nextStep: task.next_step ?? "",
    blockedReason: task.blocked_reason ?? "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = (next: Partial<typeof draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const save = () => {
    const title = draft.title.trim();
    if (!title) return;
    const tags = draft.tags
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const ok = updateTask(task.id, {
      title,
      status: draft.status,
      priority: draft.priority,
      due: draft.due || null,
      project_id: draft.projectId || null,
      tags,
      // 清空输入框就清掉字段（undefined 序列化时被丢弃，Rust 侧读成 None）。
      next_step: draft.nextStep.trim() || undefined,
      blocked_reason: draft.blockedReason.trim() || undefined,
    });
    if (ok) onClose();
  };

  return (
    <>
      <Modal
        open
        title={t("tasks.editTask")}
        onClose={onClose}
        wide
        footer={
          <>
            <Btn onClick={onClose}>{t("tasks.cancel")}</Btn>
            <Btn variant="primary" onClick={save} disabled={!draft.title.trim()}>
              {t("tasks.save")}
            </Btn>
          </>
        }
      >
        <p className="mb-3 text-[11px] leading-relaxed text-dim">
          {t("tasks.detailHint")}
        </p>

        <Field label={t("tasks.fieldTitle")}>
          <input
            className={inputCls}
            value={draft.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label={t("tasks.fieldStatus")}>
            <select
              className={inputCls}
              value={draft.status}
              onChange={(e) => patch({ status: e.target.value })}
            >
              <option value="todo">{t("tasks.colTodo")}</option>
              <option value="doing">{t("tasks.colDoing")}</option>
              <option value="done">{t("tasks.colDone")}</option>
            </select>
          </Field>
          <Field label={t("tasks.fieldPriority")}>
            <select
              className={inputCls}
              value={draft.priority}
              onChange={(e) => patch({ priority: e.target.value })}
            >
              <option value="low">{t("tasks.priorityLow")}</option>
              <option value="normal">{t("tasks.priorityNormal")}</option>
              <option value="high">{t("tasks.priorityHigh")}</option>
            </select>
          </Field>
          <Field label={t("tasks.fieldDue")}>
            <input
              type="date"
              className={inputCls}
              value={draft.due}
              onChange={(e) => patch({ due: e.target.value })}
            />
          </Field>
          <Field label={t("tasks.fieldProject")}>
            <select
              className={inputCls}
              value={draft.projectId}
              onChange={(e) => patch({ projectId: e.target.value })}
            >
              <option value="">{t("tasks.unassigned")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t("tasks.fieldNextStep")}>
          <input
            className={inputCls}
            value={draft.nextStep}
            onChange={(e) => patch({ nextStep: e.target.value })}
            placeholder={t("tasks.nextStepPlaceholder")}
          />
        </Field>

        <Field label={t("tasks.fieldBlockedReason")}>
          <input
            className={inputCls}
            value={draft.blockedReason}
            onChange={(e) => patch({ blockedReason: e.target.value })}
            placeholder={t("tasks.blockedReasonPlaceholder")}
          />
        </Field>

        <Field label={t("tasks.fieldTags")}>
          <input
            className={inputCls}
            value={draft.tags}
            onChange={(e) => patch({ tags: e.target.value })}
            placeholder={t("tasks.tagsPlaceholder")}
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-3 text-[10.5px] text-faint">
          <span>
            {t("tasks.metaCreated")}: {fromNow(task.created_at)}
          </span>
          <span>
            {t("tasks.metaUpdated")}: {fromNow(task.updated_at)}
          </span>
          {task.completed_at ? (
            <span>
              {t("tasks.metaCompleted")}: {fromNow(task.completed_at)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="ml-auto text-[11px] text-danger hover:underline"
          >
            {t("tasks.delete")}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title={t("tasks.deleteConfirmTitle")}
        body={t("tasks.deleteConfirmBody", { title: task.title })}
        confirmLabel={t("tasks.deleteConfirmAction")}
        cancelLabel={t("tasks.cancel")}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteTask(task.id);
          setConfirmDelete(false);
          onClose();
        }}
      />
    </>
  );
}
