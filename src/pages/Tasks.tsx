import { useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
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
  Empty,
  Field,
  Modal,
  SectionTitle,
  inputCls,
  type Tone,
} from "../ui";
import { dueLabel } from "../lib/util";
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

  const { data, addTask, moveTask, updateTask, deleteTask, theme } = useStore(
    useShallow((s) => ({
      data: s.data,
      addTask: s.addTask,
      moveTask: s.moveTask,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      theme: s.theme,
    }))
  );
  const [projectFilter, setProjectFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [taskDraft, setTaskDraft] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const projectName = (id: string | null) =>
    data.projects.find((p) => p.id === id)?.name ?? null;

  const visible = useMemo(
    () =>
      data.tasks.filter((task) => !projectFilter || task.project_id === projectFilter),
    [data.tasks, projectFilter]
  );

  const patchTask = (patch: Partial<Task>) =>
    setTaskDraft((d) => (d ? { ...d, ...patch } : d));

  const commitTask = () => {
    if (taskDraft && updateTask(taskDraft.id, taskDraft)) setTaskDraft(null);
  };

  // ── 图表：优先级分布 ──────────────────────────────────────
  const priorityDist = useMemo(() => {
    const m: Record<string, number> = { low: 0, normal: 0, high: 0 };
    for (const task of data.tasks) m[task.priority] = (m[task.priority] ?? 0) + 1;
    return (["low", "normal", "high"] as const)
      .map((key) => ({
        name: priorityLabel(key, t),
        value: m[key],
        color: PRIORITIES[key].color,
      }))
      .filter((d) => d.value > 0);
  }, [data.tasks, t]);

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
    if (!data.tasks.length) return 0;
    return Math.round(
      (data.tasks.filter((task) => task.status === "done").length / data.tasks.length) *
        100
    );
  }, [data.tasks]);

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
      {/* ── 图表区 ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <SectionTitle>{t("tasks.priorityDist")}</SectionTitle>
          {data.tasks.length > 0 ? (
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
            <div className="text-xs text-dim py-6 text-center">
              {t("tasks.emptyTasks")}
            </div>
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
            {data.tasks.filter((task) => task.status === "done").length} /{" "}
            {data.tasks.length}
          </div>
        </Card>

        {/* 各列数量 */}
        <Card>
          <SectionTitle>{t("tasks.taskDist")}</SectionTitle>
          <div className="space-y-3">
            {COLUMNS.map((c) => {
              const count = data.tasks.filter((task) => task.status === c.key).length;
              const pct = data.tasks.length > 0 ? (count / data.tasks.length) * 100 : 0;
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

      {/* ── 筛选 ── */}
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle>{t("tasks.board")}</SectionTitle>
        <label className="ml-auto flex items-center gap-2 text-xs text-dim">
          {t("tasks.filterByProject")}
          <select
            className="rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1 text-xs text-text outline-none"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">{t("tasks.allProjects")}</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

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
                      onEdit={() => setTaskDraft({ ...task })}
                      onDelete={() => deleteTask(task.id)}
                    />
                  ))
                )}
              </Column>
            );
          })}
        </div>
      </DndContext>

      <Modal
        open={!!taskDraft}
        title={t("tasks.editTask")}
        onClose={() => setTaskDraft(null)}
        footer={
          <>
            <Btn onClick={() => setTaskDraft(null)}>{t("tasks.cancel")}</Btn>
            <Btn variant="primary" onClick={commitTask}>
              {t("tasks.done")}
            </Btn>
          </>
        }
      >
        {taskDraft && (
          <>
            <Field label={t("tasks.fieldTitle")}>
              <input
                className={inputCls}
                value={taskDraft.title}
                onChange={(e) => patchTask({ title: e.target.value })}
              />
            </Field>
            <Field label={t("tasks.fieldPriority")}>
              <select
                className={inputCls}
                value={taskDraft.priority}
                onChange={(e) => patchTask({ priority: e.target.value })}
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
                value={taskDraft.due ?? ""}
                onChange={(e) => patchTask({ due: e.target.value || null })}
              />
            </Field>
            <Field label={t("tasks.fieldProject")}>
              <select
                className={inputCls}
                value={taskDraft.project_id ?? ""}
                onChange={(e) => patchTask({ project_id: e.target.value || null })}
              >
                <option value="">{t("tasks.unassigned")}</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
      </Modal>
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
        {projectName && <Badge tone="dim">{projectName}</Badge>}
      </div>
    </div>
  );
}
