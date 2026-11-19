import { useMemo, useState, type ReactNode } from "react";
import dayjs from "dayjs";
import { Check, LayoutGrid, List, Plus, Search, Trash2, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { Badge, Btn, Card, ConfirmDialog, Empty, inputCls, type Tone } from "../ui";
import { dueLabel } from "../lib/util";
import { priorityLabel } from "../lib/workbench";
import { isBlocked, taskMatchesScope, type TaskScope } from "../lib/workbench";
import { useT } from "../lib/i18n";
import type { Task } from "../types";
import { TaskPulse } from "./tasks/TaskPulse";
import { TASK_STATUSES, taskStatusLabel } from "./tasks/taskVisuals";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

const COLUMNS = TASK_STATUSES;

const PRIORITIES: Record<string, { tone: Tone }> = {
  low: { tone: "dim" },
  normal: { tone: "accent" },
  high: { tone: "danger" },
};

const SCOPES: { key: TaskScope; labelKey: string }[] = [
  { key: "all", labelKey: "tasks.scopeAll" },
  { key: "today", labelKey: "tasks.scopeToday" },
  { key: "week", labelKey: "tasks.scopeWeek" },
  { key: "inbox", labelKey: "tasks.scopeInbox" },
  { key: "blocked", labelKey: "tasks.scopeBlocked" },
];

function columnLabel(key: string, t: TFunc): string {
  return taskStatusLabel(key, t);
}

export default function Tasks() {
  const t = useT();

  const {
    data,
    addTask,
    moveTask,
    deleteTask,
    taskView,
    setTaskView,
    taskScope,
    setTaskScope,
    projectFilter,
    setTaskProjectFilter,
    setTaskDetailId,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      addTask: s.addTask,
      moveTask: s.moveTask,
      deleteTask: s.deleteTask,
      taskView: s.taskView,
      setTaskView: s.setTaskView,
      taskScope: s.taskScope,
      setTaskScope: s.setTaskScope,
      projectFilter: s.taskProjectFilter,
      setTaskProjectFilter: s.setTaskProjectFilter,
      setTaskDetailId: s.setTaskDetailId,
    }))
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newTitle, setNewTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  // 任务一旦多起来，「翻列表找一条」是最高频的操作。搜索只在当前范围+项目
  // 筛选之内生效：换范围时保留搜索词，符合「先缩小范围再找」的实际用法。
  const [query, setQuery] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const projectName = (id: string | null) =>
    data.projects.find((p) => p.id === id)?.name ?? null;

  // 先算“范围 + 项目 + 搜索”内的全集，再叠加状态筛选。
  // 脉冲读数始终基于全集，点某个状态时其余数字不会跟着塌掉。
  const baseVisible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.tasks.filter((task) => {
      if (!taskMatchesScope(task, taskScope)) return false;
      if (projectFilter && task.project_id !== projectFilter) return false;
      if (!q) return true;
      // 标题、下一步、阻塞原因、标签都参与搜索：用户记得的往往是「卡在哪」
      // 或那个标签，而不是标题原文。
      return (
        task.title.toLowerCase().includes(q) ||
        (task.next_step ?? "").toLowerCase().includes(q) ||
        (task.blocked_reason ?? "").toLowerCase().includes(q) ||
        task.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [data.tasks, projectFilter, taskScope, query]);

  const visible = useMemo(
    () =>
      statusFilter
        ? baseVisible.filter((task) => task.status === statusFilter)
        : baseVisible,
    [baseVisible, statusFilter]
  );

  /** 新建任务的默认到期日：今天/本周范围补今天，否则无日期（收件箱/全部）。 */
  function defaultDueForScope(scope: TaskScope): string | null {
    return scope === "today" || scope === "week" ? dayjs().format("YYYY-MM-DD") : null;
  }

  const changeScope = (scope: TaskScope) => {
    setTaskScope(scope);
    setStatusFilter(null);
  };

  const changeProject = (projectId: string) => {
    setTaskProjectFilter(projectId);
    setStatusFilter(null);
  };

  const addFromList = () => {
    const title = newTitle.trim();
    if (!title) return;
    // 在「今天/本周」范围下新建时补今天到期，否则新任务会立刻被当前筛选隐藏，
    // 用户会以为没有创建成功。收件箱/全部范围保持无日期。
    const due = defaultDueForScope(taskScope);
    if (
      addTask({
        title,
        status: "todo",
        priority: "normal",
        due,
        project_id: projectFilter || null,
      })
    ) {
      setNewTitle("");
      setStatusFilter(null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const over = e.over?.id;
    if (!over) return;
    const status = String(over);
    if (!COLUMNS.some((c) => c.key === status)) return;
    const task = data.tasks.find((item) => item.id === id);
    if (task && task.status !== status) moveTask(id, status);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── 工具栏：视图 / 范围 / 项目 / 统计 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-full border border-line bg-panel2/60 p-0.5">
          <button
            type="button"
            aria-pressed={taskView === "list"}
            onClick={() => setTaskView("list")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              taskView === "list"
                ? "bg-panel text-text shadow-sm"
                : "text-dim hover:text-text"
            }`}
          >
            <List size={12} /> {t("tasks.viewList")}
          </button>
          <button
            type="button"
            aria-pressed={taskView === "board"}
            onClick={() => setTaskView("board")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              taskView === "board"
                ? "bg-panel text-text shadow-sm"
                : "text-dim hover:text-text"
            }`}
          >
            <LayoutGrid size={12} /> {t("tasks.viewBoard")}
          </button>
        </div>

        <div className="flex items-center gap-0.5 rounded-full border border-line bg-panel2/60 p-0.5">
          {SCOPES.map((scope) => (
            <button
              key={scope.key}
              type="button"
              aria-pressed={taskScope === scope.key}
              onClick={() => changeScope(scope.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                taskScope === scope.key
                  ? "bg-panel text-text shadow-sm"
                  : "text-dim hover:text-text"
              }`}
            >
              {t(scope.labelKey)}
            </button>
          ))}
        </div>

        <div className="relative min-w-[150px] flex-1 sm:max-w-[240px]">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-dim"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tasks.searchPlaceholder")}
            aria-label={t("tasks.searchPlaceholder")}
            className="w-full rounded-[var(--radius-btn)] border border-line bg-panel2 py-1 pl-7 pr-6 text-xs text-text placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("tasks.clearSearch")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-dim hover:text-text"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <select
          className="ml-auto rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1 text-xs text-text outline-none"
          value={projectFilter}
          onChange={(e) => changeProject(e.target.value)}
          aria-label={t("tasks.filterByProject")}
        >
          <option value="">{t("tasks.allProjects")}</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <TaskPulse
        tasks={baseVisible}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
      />

      {taskView === "board" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {COLUMNS.map((col) => {
              const tasks = visible.filter((task) => task.status === col.key);
              return (
                <Column
                  key={col.key}
                  colKey={col.key}
                  label={columnLabel(col.key, t)}
                  count={tasks.length}
                  color={col.color}
                  draft={drafts[col.key] ?? ""}
                  onDraft={(v) => setDrafts((d) => ({ ...d, [col.key]: v }))}
                  onAdd={() => {
                    const title = (drafts[col.key] ?? "").trim();
                    if (!title) return;
                    // 与列表新建同一口径：今天/本周范围补今天到期；
                    // 阻塞范围无法凭空生成阻塞原因，添加后回到全部，避免“假消失”。
                    const due = defaultDueForScope(taskScope);
                    if (
                      addTask({
                        title,
                        status: col.key,
                        due,
                        project_id: projectFilter || null,
                      })
                    ) {
                      setDrafts((d) => ({ ...d, [col.key]: "" }));
                      setStatusFilter(null);
                      if (taskScope === "blocked") setTaskScope("all");
                    }
                  }}
                >
                  {tasks.length === 0 ? (
                    <Empty>{t("tasks.columnEmptyHint")}</Empty>
                  ) : (
                    tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        projectName={projectName(task.project_id)}
                        onEdit={() => setTaskDetailId(task.id)}
                        onDelete={() => setPendingDelete(task)}
                      />
                    ))
                  )}
                </Column>
              );
            })}
          </div>
        </DndContext>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
            <Plus size={13} className="shrink-0 text-faint" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text outline-none placeholder:text-faint"
              placeholder={t("tasks.addPlaceholder")}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFromList();
              }}
              aria-label={t("tasks.add")}
            />
            <Btn variant="primary" onClick={addFromList} className="!py-1 !text-xs">
              {t("tasks.add")}
            </Btn>
          </div>
          <div className="hidden items-center gap-2 border-b border-line px-3 py-2 text-[10.5px] font-medium tracking-[0.04em] text-faint sm:flex">
            <span className="w-5" />
            <span className="min-w-0 flex-1">{t("tasks.colTask")}</span>
            <span className="w-28 truncate">{t("tasks.colProject")}</span>
            <span className="w-24">{t("tasks.colDue")}</span>
            <span className="w-16">{t("tasks.colPriority")}</span>
            <span className="w-16 text-right">{t("tasks.colActions")}</span>
          </div>
          {visible.length === 0 ? (
            <div className="p-4">
              <Empty>
                {data.tasks.length === 0 ? t("tasks.emptyTasks") : t("tasks.noMatch")}
              </Empty>
            </div>
          ) : (
            <ul>
              {visible.map((task) => {
                const due = dueLabel(task.due);
                const pri = PRIORITIES[task.priority] ?? PRIORITIES.normal;
                const done = task.status === "done";
                return (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0 hover:bg-panel2/40"
                  >
                    <button
                      type="button"
                      aria-label={t("tasks.markDone")}
                      aria-pressed={done}
                      onClick={() => moveTask(task.id, done ? "todo" : "done")}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        done
                          ? "border-ok bg-ok/15 text-ok"
                          : "border-dim/50 text-transparent hover:border-ok hover:text-ok"
                      }`}
                    >
                      <Check size={11} strokeWidth={3} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaskDetailId(task.id)}
                      className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12.5px] hover:text-accent ${
                        done ? "text-faint line-through" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">{task.title}</span>
                      {isBlocked(task) && (
                        <Badge tone="danger" className="shrink-0">
                          {t("tasks.blocked")}
                        </Badge>
                      )}
                    </button>
                    <span className="hidden w-28 truncate text-[10.5px] text-faint sm:block">
                      {projectName(task.project_id) ?? t("tasks.unassigned")}
                    </span>
                    <span className="w-24">
                      <Badge tone={due.tone}>{due.text}</Badge>
                    </span>
                    <span className="w-16">
                      <Badge tone={pri.tone}>{priorityLabel(task.priority, t)}</Badge>
                    </span>
                    <span className="w-16 text-right">
                      <button
                        type="button"
                        aria-label={t("tasks.delete")}
                        title={t("tasks.delete")}
                        onClick={() => setPendingDelete(task)}
                        className="rounded p-1 text-faint transition-colors hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <p className="text-[10.5px] text-faint">{t("tasks.listHint")}</p>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("tasks.deleteConfirmTitle")}
        body={t("tasks.deleteConfirmBody", {
          title: pendingDelete?.title ?? "",
        })}
        confirmLabel={t("tasks.deleteConfirmAction")}
        cancelLabel={t("tasks.cancel")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteTask(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function Column({
  colKey,
  label,
  count,
  color,
  children,
  draft,
  onDraft,
  onAdd,
}: {
  colKey: string;
  label: string;
  count: number;
  color: string;
  children: ReactNode;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const { setNodeRef, isOver } = useDroppable({ id: colKey });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[300px] flex-col rounded-[var(--radius-card)] border bg-panel p-3 transition-colors ${
        isOver ? "border-accent/70 bg-accent/[0.03]" : "border-line/90"
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="section-title">{label}</span>
        <Badge tone="dim">{count}</Badge>
        <span className="ml-auto h-2 w-2 rounded-full" style={{ background: color }} />
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
      <div className="mt-2 flex gap-1.5">
        <input
          className={inputCls}
          aria-label={`${label} — ${t("tasks.add")}`}
          placeholder={t("tasks.addPlaceholder")}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <Btn variant="primary" className="!px-2.5" title={t("tasks.add")} onClick={onAdd}>
          <Plus size={14} />
        </Btn>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  projectName,
  onEdit,
  onDelete,
}: {
  task: Task;
  projectName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };
  const pri = PRIORITIES[task.priority] ?? PRIORITIES.normal;
  const due = dueLabel(task.due);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab rounded-[var(--radius-btn)] border border-line bg-panel2 p-2.5 active:cursor-grabbing hover:border-accent/40 transition-colors"
    >
      <div className="flex items-start gap-2">
        <button className="flex-1 text-left text-sm" onClick={onEdit}>
          {task.title}
        </button>
        <button
          className="text-dim hover:text-danger"
          title={t("tasks.delete")}
          onClick={onDelete}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={pri.tone}>{priorityLabel(task.priority, t)}</Badge>
        <Badge tone={due.tone}>{due.text}</Badge>
        {isBlocked(task) && <Badge tone="danger">{t("tasks.blocked")}</Badge>}
        {projectName && <Badge tone="dim">{projectName}</Badge>}
      </div>
    </div>
  );
}
