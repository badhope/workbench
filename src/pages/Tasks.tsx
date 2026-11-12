import { useMemo, useState, type ReactNode } from "react";
import dayjs from "dayjs";
import { Check, LayoutGrid, List, Plus, Trash2 } from "lucide-react";
import { EChart } from "../lib/echarts";
import { chartGapColor, FIXED_COLORS } from "../lib/chartTheme";
import { isPieWorthRendering } from "../lib/aggregate";
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
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  Empty,
  SectionTitle,
  inputCls,
  type Tone,
} from "../ui";
import { dueLabel } from "../lib/util";
import { isBlocked, taskMatchesScope, type TaskScope } from "../lib/workbench";
import { useT } from "../lib/i18n";
import type { Task } from "../types";

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

const COLUMNS: { key: string; color: string }[] = [
  { key: "todo", color: FIXED_COLORS.other },
  { key: "doing", color: FIXED_COLORS.normal },
  { key: "done", color: FIXED_COLORS.system },
];

const PRIORITIES: Record<string, { tone: Tone; color: string }> = {
  low: { tone: "dim", color: FIXED_COLORS.low },
  normal: { tone: "accent", color: FIXED_COLORS.normal },
  high: { tone: "danger", color: FIXED_COLORS.high },
};

const SCOPES: { key: TaskScope; labelKey: string }[] = [
  { key: "all", labelKey: "tasks.scopeAll" },
  { key: "today", labelKey: "tasks.scopeToday" },
  { key: "week", labelKey: "tasks.scopeWeek" },
  { key: "inbox", labelKey: "tasks.scopeInbox" },
  { key: "blocked", labelKey: "tasks.scopeBlocked" },
];

function columnLabel(key: string, t: TFunc): string {
  switch (key) {
    case "todo":
      return t("tasks.colTodo");
    case "doing":
      return t("tasks.colDoing");
    case "done":
      return t("tasks.colDone");
    default:
      return key;
  }
}

function priorityLabel(key: string, t: TFunc): string {
  switch (key) {
    case "low":
      return t("tasks.priorityLow");
    case "normal":
      return t("tasks.priorityNormal");
    case "high":
      return t("tasks.priorityHigh");
    default:
      return key;
  }
}

export default function Tasks() {
  const t = useT();

  const {
    data,
    addTask,
    moveTask,
    deleteTask,
    theme,
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
      theme: s.theme,
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
  const [showStats, setShowStats] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const projectName = (id: string | null) =>
    data.projects.find((p) => p.id === id)?.name ?? null;

  const visible = useMemo(
    () =>
      data.tasks.filter(
        (task) =>
          taskMatchesScope(task, taskScope) &&
          (!projectFilter || task.project_id === projectFilter)
      ),
    [data.tasks, projectFilter, taskScope]
  );

  const addFromList = () => {
    const title = newTitle.trim();
    if (!title) return;
    // 在「今天/本周」范围下新建时补今天到期，否则新任务会立刻被当前筛选隐藏，
    // 用户会以为没有创建成功。收件箱/全部范围保持无日期。
    const due =
      taskScope === "today" || taskScope === "week"
        ? dayjs().format("YYYY-MM-DD")
        : null;
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
    }
  };

  // ── 图表：优先级分布 ──────────────────────────────────────
  const priorityDist = useMemo(() => {
    const m: Record<string, number> = { low: 0, normal: 0, high: 0 };
    for (const task of visible) m[task.priority] = (m[task.priority] ?? 0) + 1;
    return (["low", "normal", "high"] as const)
      .map((key) => ({
        name: priorityLabel(key, t),
        value: m[key],
        color: PRIORITIES[key].color,
      }))
      .filter((d) => d.value > 0);
  }, [visible, t]);

  const priorityPieOption = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          id: "priority-pie",
          type: "pie",
          radius: ["44%", "66%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
          data: priorityDist.map((d) => ({
            name: d.name,
            value: d.value,
            itemStyle: { color: d.color },
          })),
        },
      ],
    }),
    [priorityDist, theme]
  );

  // 完成率统计
  const completionRate = useMemo(() => {
    if (!visible.length) return 0;
    return Math.round(
      (visible.filter((task) => task.status === "done").length / visible.length) * 100
    );
  }, [visible]);

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
              taskView === "list" ? "bg-panel text-text shadow-sm" : "text-dim hover:text-text"
            }`}
          >
            <List size={12} /> {t("tasks.viewList")}
          </button>
          <button
            type="button"
            aria-pressed={taskView === "board"}
            onClick={() => setTaskView("board")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors ${
              taskView === "board" ? "bg-panel text-text shadow-sm" : "text-dim hover:text-text"
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
              onClick={() => setTaskScope(scope.key)}
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

        <select
          className="ml-auto rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1 text-xs text-text outline-none"
          value={projectFilter}
          onChange={(e) => setTaskProjectFilter(e.target.value)}
          aria-label={t("tasks.filterByProject")}
        >
          <option value="">{t("tasks.allProjects")}</option>
          {data.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Btn onClick={() => setShowStats((v) => !v)} className="!py-1 !text-xs">
          {showStats ? t("tasks.hideStats") : t("tasks.stats")}
        </Btn>
      </div>

      {showStats && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <SectionTitle>{t("tasks.priorityDist")}</SectionTitle>
            {visible.length > 0 ? (
              <>
                {isPieWorthRendering(
                  priorityDist.map((d) => [d.name, d.value] as [string, number])
                ) && (
                  <EChart option={priorityPieOption} style={{ height: 130 }} lazyUpdate />
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {priorityDist.map((d) => (
                    <span
                      key={d.name}
                      className="flex items-center gap-1 text-[11px] text-dim"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: d.color }}
                      />
                      {d.name} <span className="font-mono text-text">{d.value}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <Empty>{t("tasks.emptyTasks")}</Empty>
            )}
          </Card>

          {/* 完成率进度 */}
          <Card className="flex flex-col">
            <SectionTitle>{t("tasks.completionRate")}</SectionTitle>
            <div className="flex flex-1 items-center justify-center">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <svg className="h-24 w-24 -rotate-90">
                  <circle
                    cx="48"
                    cy="48"
                    r="38"
                    fill="none"
                    stroke="var(--color-panel2)"
                    strokeWidth="8"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="38"
                    fill="none"
                    stroke="var(--color-ok)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(completionRate / 100) * 239} 239`}
                  />
                </svg>
                <span className="num absolute text-[22px] font-semibold text-ok">
                  {completionRate}%
                </span>
              </div>
            </div>
            <div className="text-center text-xs text-dim">
              {visible.filter((task) => task.status === "done").length} /{" "}
              {visible.length}
            </div>
          </Card>

          {/* 各列数量 */}
          <Card>
            <SectionTitle>{t("tasks.taskDist")}</SectionTitle>
            <div className="space-y-3">
              {COLUMNS.map((c) => {
                const count = visible.filter((task) => task.status === c.key).length;
                const pct = visible.length > 0 ? (count / visible.length) * 100 : 0;
                return (
                  <div key={c.key}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-dim">{columnLabel(c.key, t)}</span>
                      <span className="font-mono text-text">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: c.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

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
                    if (
                      addTask({ title, status: col.key, project_id: projectFilter || null })
                    ) {
                      setDrafts((d) => ({ ...d, [col.key]: "" }));
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
              <Empty>{data.tasks.length === 0 ? t("tasks.emptyTasks") : t("tasks.noMatch")}</Empty>
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
