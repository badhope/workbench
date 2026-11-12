import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import dayjs from "dayjs";
import {
  ArrowRight,
  Check,
  FolderOpen,
  Inbox,
  Plus,
  Server,
  Sparkles,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { localeFor, useLang, useT } from "../lib/i18n";
import { Badge, Btn, Card, Empty, SectionTitle, inputCls } from "../ui";
import { dueLabel } from "../lib/util";
import {
  attentionCounts,
  isOpenTask,
  nextTaskForProject,
  pickCurrentProject,
  projectProgress,
  sortTasksForWork,
  tasksForToday,
  type AttentionCounts,
  type ProjectProgress,
} from "../lib/workbench";
import { showsProjectsPanel, showsToolsSummary, WORK_MODES } from "../lib/workModes";
import type { Project, Task } from "../types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function priorityLabel(key: string, t: Translate): string {
  if (key === "low") return t("tasks.priorityLow");
  if (key === "high") return t("tasks.priorityHigh");
  return t("tasks.priorityNormal");
}

/**
 * 工作台首页：上下文 → 注意力 → 今天 → 项目/收件箱/系统摘要。
 *
 * 这里刻意不放大图表：首页首先回答「现在做什么」，统计数据属于回顾页。
 * 所有计数与任务页共用 lib/workbench 的口径，避免两处数字对不上。
 * 页面拆成若干子组件，单个组件的认知复杂度保持在 lint 阈值内。
 */
export default function Today() {
  const t = useT();
  const lang = useLang();
  const quickRef = useRef<HTMLInputElement>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickProject, setQuickProject] = useState("");

  const {
    data,
    devs,
    ais,
    ports,
    runtimeError,
    workModes,
    addTask,
    moveTask,
    setView,
    setToast,
    setTaskScope,
    setTaskProjectFilter,
    openTarget,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      devs: s.devs,
      ais: s.ais,
      ports: s.ports,
      runtimeError: s.runtimeError,
      workModes: s.workModes,
      addTask: s.addTask,
      moveTask: s.moveTask,
      setView: s.setView,
      setToast: s.setToast,
      setTaskScope: s.setTaskScope,
      setTaskProjectFilter: s.setTaskProjectFilter,
      openTarget: s.openTarget,
    }))
  );

  const now = dayjs();
  const counts = useMemo(() => attentionCounts(data.tasks), [data.tasks]);
  const todayTasks = useMemo(() => tasksForToday(data.tasks), [data.tasks]);
  const todayIds = useMemo(() => new Set(todayTasks.map((x) => x.id)), [todayTasks]);
  const upcoming = useMemo(
    () =>
      sortTasksForWork(
        data.tasks.filter(
          (task) =>
            isOpenTask(task) &&
            !todayIds.has(task.id) &&
            task.due &&
            dayjs(task.due).isValid() &&
            dayjs(task.due).isBefore(now.startOf("day").add(7, "day"), "day")
        )
      ).slice(0, 4),
    [data.tasks, todayIds, now]
  );

  const current = useMemo(
    () => pickCurrentProject(data.projects, data.tasks),
    [data.projects, data.tasks]
  );
  const currentProgress = current ? projectProgress(current.id, data.tasks) : null;
  const currentNext = current ? nextTaskForProject(current.id, data.tasks) : null;

  const projectRows = useMemo(() => {
    const latest = new Map<string, number>();
    for (const task of data.tasks) {
      if (!task.project_id) continue;
      latest.set(
        task.project_id,
        Math.max(latest.get(task.project_id) ?? 0, task.updated_at)
      );
    }
    return [...data.projects]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
        return (latest.get(b.id) ?? 0) - (latest.get(a.id) ?? 0);
      })
      .slice(0, 5)
      .map((project) => ({
        project,
        progress: projectProgress(project.id, data.tasks),
        next: nextTaskForProject(project.id, data.tasks),
      }));
  }, [data.projects, data.tasks]);

  const inbox = useMemo(
    () =>
      sortTasksForWork(
        data.tasks.filter((task) => isOpenTask(task) && !task.project_id)
      ).slice(0, 4),
    [data.tasks]
  );

  const openTaskList = (
    scope: "all" | "today" | "week" | "inbox",
    projectId = ""
  ) => {
    setTaskScope(scope);
    setTaskProjectFilter(projectId);
    setView("tasks");
  };

  const capture = () => {
    const title = quickTitle.trim();
    if (!title) return;
    if (
      addTask({
        title,
        status: "todo",
        priority: "normal",
        project_id: quickProject || null,
      })
    ) {
      setQuickTitle("");
      setToast(t("today.added"));
    }
  };

  const focusQuick = (projectId = "") => {
    setQuickProject(projectId);
    quickRef.current?.focus();
  };

  const modeNames = workModes
    .map((id) => WORK_MODES.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  return (
    <div className="flex flex-col gap-4">
      <TodayHeader now={now} lang={lang} modeNames={modeNames} onChangeMode={() => setView("settings")} />

      <QuickCapture
        inputRef={quickRef}
        title={quickTitle}
        onTitle={setQuickTitle}
        project={quickProject}
        onProject={setQuickProject}
        projects={data.projects}
        onSubmit={capture}
      />

      <AttentionBar counts={counts} onOpen={openTaskList} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CurrentProjectCard
            project={current}
            progress={currentProgress}
            next={currentNext}
            onOpenTasks={() => current && openTaskList("all", current.id)}
            onNewTask={() => focusQuick(current?.id ?? "")}
            onOpenFolder={() => current?.path && void openTarget(current.path)}
            onCreateProject={() => setView("projects")}
          />

          <TaskListCard
            title={t("today.today")}
            tasks={todayTasks.slice(0, 7)}
            projects={data.projects}
            emptyText={t("today.nothingToday")}
            emptyAction={
              <Btn onClick={() => focusQuick()}>
                <Plus size={13} /> {t("today.quickAdd")}
              </Btn>
            }
            extra={
              <button
                type="button"
                className="text-[11px] text-accent hover:underline"
                onClick={() => openTaskList("today")}
              >
                {t("today.viewTasks")}
              </button>
            }
            onComplete={(id) => moveTask(id, "done")}
            onOpen={(task) => openTaskList("all", task.project_id ?? "")}
          />

          {upcoming.length > 0 && (
            <TaskListCard
              title={t("today.upcoming")}
              tasks={upcoming}
              projects={data.projects}
              onComplete={(id) => moveTask(id, "done")}
              onOpen={(task) => openTaskList("all", task.project_id ?? "")}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {showsProjectsPanel(workModes) && (
            <ProjectsPanel
              rows={projectRows}
              onOpen={(id) => openTaskList("all", id)}
              onViewAll={() => setView("projects")}
              onCreate={() => setView("projects")}
            />
          )}

          <InboxPanel
            tasks={inbox}
            onOpen={(task) => openTaskList("inbox", task.project_id ?? "")}
            onComplete={(id) => moveTask(id, "done")}
            onViewAll={() => openTaskList("inbox")}
          />

          {showsToolsSummary(workModes) && (
            <SystemPanel
              devs={devs.length}
              ports={ports.length}
              ais={ais.length}
              error={runtimeError}
              onOpen={() => setView("overview")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TodayHeader({
  now,
  lang,
  modeNames,
  onChangeMode,
}: {
  now: dayjs.Dayjs;
  lang: ReturnType<typeof useLang>;
  modeNames: { labelKey: string }[];
  onChangeMode: () => void;
}) {
  const t = useT();
  return (
    <header className="flex flex-col gap-3 border-b border-line/70 pb-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <span className="num">
            {now.toDate().toLocaleDateString(localeFor(lang), {
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </span>
          {modeNames.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={onChangeMode}
                className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-dim transition-colors hover:border-accent/40 hover:text-text"
                title={t("workMode.change")}
              >
                {modeNames.map((m) => t(m.labelKey)).join(" / ")}
              </button>
            </>
          )}
        </div>
        <h1 className="t-heading mt-1 text-[22px] font-semibold leading-tight">
          {t("today.title")}
        </h1>
        <p className="mt-1 text-[12.5px] text-dim">{t("today.subtitle")}</p>
      </div>
    </header>
  );
}

function QuickCapture({
  inputRef,
  title,
  onTitle,
  project,
  onProject,
  projects,
  onSubmit,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  title: string;
  onTitle: (v: string) => void;
  project: string;
  onProject: (v: string) => void;
  projects: Project[];
  onSubmit: () => void;
}) {
  const t = useT();
  return (
    <Card className="px-4 py-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-btn)] border border-line bg-panel2/60 text-dim">
            <Plus size={14} />
          </span>
          <input
            ref={inputRef}
            className={inputCls}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder={t("today.quickPlaceholder")}
            aria-label={t("today.quickPlaceholder")}
          />
        </div>
        <select
          className="rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1.5 text-xs text-text outline-none sm:w-44"
          value={project}
          onChange={(e) => onProject(e.target.value)}
          aria-label={t("today.quickProject")}
        >
          <option value="">{t("today.inboxOption")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Btn variant="primary" type="submit" className="shrink-0">
          {t("today.quickAdd")}
        </Btn>
      </form>
    </Card>
  );
}

function AttentionBar({
  counts,
  onOpen,
}: {
  counts: AttentionCounts;
  onOpen: (scope: "all" | "today" | "week" | "inbox") => void;
}) {
  const t = useT();
  const total = counts.overdue + counts.today + counts.doing + counts.inbox;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium tracking-[0.04em] text-faint">
        {t("today.attention")}
      </span>
      <AttentionChip
        tone="danger"
        label={t("today.overdue", { count: counts.overdue })}
        active={counts.overdue > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="warn"
        label={t("today.dueToday", { count: counts.today })}
        active={counts.today > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="accent"
        label={t("today.doing", { count: counts.doing })}
        active={counts.doing > 0}
        onClick={() => onOpen("today")}
      />
      <AttentionChip
        tone="dim"
        label={t("today.inboxCount", { count: counts.inbox })}
        active={counts.inbox > 0}
        onClick={() => onOpen("inbox")}
      />
      {total === 0 && <span className="text-[11px] text-faint">{t("today.allClear")}</span>}
    </div>
  );
}

function CurrentProjectCard({
  project,
  progress,
  next,
  onOpenTasks,
  onNewTask,
  onOpenFolder,
  onCreateProject,
}: {
  project: Project | null;
  progress: ProjectProgress | null;
  next: Task | null;
  onOpenTasks: () => void;
  onNewTask: () => void;
  onOpenFolder: () => void;
  onCreateProject: () => void;
}) {
  const t = useT();
  if (!project || !progress) {
    return (
      <Card>
        <SectionTitle>{t("today.current")}</SectionTitle>
        <Empty
          action={
            <Btn variant="primary" onClick={onCreateProject}>
              <Plus size={13} /> {t("today.createProject")}
            </Btn>
          }
        >
          {t("today.noProjectHint")}
        </Empty>
      </Card>
    );
  }
  const statusTone =
    project.status === "active" ? "ok" : project.status === "paused" ? "warn" : "dim";
  const statusLabel =
    project.status === "active"
      ? t("projects.statusActive")
      : project.status === "paused"
        ? t("projects.statusPaused")
        : t("projects.statusArchived");
  return (
    <Card>
      <SectionTitle
        extra={
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={onOpenTasks}
          >
            {t("today.viewTasks")}
          </button>
        }
      >
        {t("today.current")}
      </SectionTitle>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{project.name}</span>
          <Badge tone={statusTone}>{statusLabel}</Badge>
          {progress.overdue > 0 && (
            <Badge tone="danger">
              {t("projects.overdueCount", { count: progress.overdue })}
            </Badge>
          )}
        </div>
        <p className="line-clamp-2 text-[12.5px] leading-relaxed text-dim">
          {project.note.trim() || t("projects.noGoal")}
        </p>

        <div>
          <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
            <span>
              {t("projects.progress", { done: progress.done, total: progress.total })}
            </span>
            <span className="num text-faint">{progress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        <NextAction next={next} onOpen={onOpenTasks} />

        <div className="flex flex-wrap gap-1.5">
          <Btn variant="primary" onClick={onOpenTasks}>
            {t("today.continue")} <ArrowRight size={13} />
          </Btn>
          <Btn onClick={onNewTask}>
            <Plus size={13} /> {t("today.newTask")}
          </Btn>
          {project.path && (
            <Btn onClick={onOpenFolder}>
              <FolderOpen size={13} /> {t("today.openFolder")}
            </Btn>
          )}
        </div>
      </div>
    </Card>
  );
}

function NextAction({ next, onOpen }: { next: Task | null; onOpen: () => void }) {
  const t = useT();
  const due = next ? dueLabel(next.due) : null;
  return (
    <div className="rounded-[var(--radius-btn)] border border-line/80 bg-panel2/50 px-3 py-2">
      <div className="text-[10.5px] font-medium tracking-[0.04em] text-faint">
        {t("today.nextAction")}
      </div>
      {next && due ? (
        <button
          type="button"
          onClick={onOpen}
          className="mt-0.5 flex w-full items-center gap-2 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px]">{next.title}</span>
          <Badge tone={due.tone}>{due.text}</Badge>
        </button>
      ) : (
        <div className="mt-0.5 text-[12px] text-dim">{t("today.noNextAction")}</div>
      )}
    </div>
  );
}

function TaskListCard({
  title,
  tasks,
  projects,
  emptyText,
  emptyAction,
  extra,
  onComplete,
  onOpen,
}: {
  title: string;
  tasks: Task[];
  projects: Project[];
  emptyText?: string;
  emptyAction?: ReactNode;
  extra?: ReactNode;
  onComplete: (id: string) => void;
  onOpen: (task: Task) => void;
}) {
  const t = useT();
  return (
    <Card>
      <SectionTitle extra={extra}>{title}</SectionTitle>
      {tasks.length === 0 ? (
        <Empty action={emptyAction}>{emptyText ?? t("today.noTasks")}</Empty>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={
                projects.find((p) => p.id === task.project_id)?.name ?? null
              }
              onComplete={() => onComplete(task.id)}
              onOpen={() => onOpen(task)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProjectsPanel({
  rows,
  onOpen,
  onViewAll,
  onCreate,
}: {
  rows: { project: Project; progress: ProjectProgress; next: Task | null }[];
  onOpen: (id: string) => void;
  onViewAll: () => void;
  onCreate: () => void;
}) {
  const t = useT();
  return (
    <Card>
      <SectionTitle
        extra={
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={onViewAll}
          >
            {t("today.viewProjects")}
          </button>
        }
      >
        {t("today.projects")}
      </SectionTitle>
      {rows.length === 0 ? (
        <Empty
          action={
            <Btn onClick={onCreate}>
              <Plus size={13} /> {t("today.createProject")}
            </Btn>
          }
        >
          {t("today.noProjectHint")}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ project, progress, next }) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => onOpen(project.id)}
                className="w-full rounded-[var(--radius-btn)] border border-line/70 bg-panel2/40 px-2.5 py-2 text-left transition-colors hover:border-accent/40"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {project.name}
                  </span>
                  <span className="num text-[10.5px] text-faint">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] text-dim">
                    {next ? next.title : t("projects.noOpenTasks")}
                  </span>
                  {progress.overdue > 0 && (
                    <span className="text-[10px] text-danger">{progress.overdue}</span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InboxPanel({
  tasks,
  onOpen,
  onComplete,
  onViewAll,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onComplete: (id: string) => void;
  onViewAll: () => void;
}) {
  const t = useT();
  return (
    <Card>
      <SectionTitle
        extra={
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={onViewAll}
          >
            {t("today.viewTasks")}
          </button>
        }
      >
        <span className="flex items-center gap-1.5">
          <Inbox size={13} /> {t("today.inboxTitle")}
        </span>
      </SectionTitle>
      {tasks.length === 0 ? (
        <div className="rounded-[var(--radius-btn)] border border-dashed border-line/80 px-3 py-4 text-center">
          <div className="text-[12px] text-dim">{t("today.inboxEmpty")}</div>
          <div className="mt-1 text-[10.5px] text-faint">{t("today.inboxHint")}</div>
        </div>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              projectName={null}
              onComplete={() => onComplete(task.id)}
              onOpen={() => onOpen(task)}
              compact
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SystemPanel({
  devs,
  ports,
  ais,
  error,
  onOpen,
}: {
  devs: number;
  ports: number;
  ais: number;
  error: string;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <Card>
      <SectionTitle
        extra={
          <button
            type="button"
            className="text-[11px] text-accent hover:underline"
            onClick={onOpen}
          >
            {t("today.openTools")}
          </button>
        }
      >
        {t("today.system")}
      </SectionTitle>
      {error ? (
        <div className="rounded-[var(--radius-btn)] border border-danger/30 bg-danger/8 px-2.5 py-2 text-[11px] text-danger">
          {t("today.systemError", { err: error })}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5 text-[11.5px]">
          <li className="flex items-center gap-2">
            <Server size={12} className="text-ok" />
            <span className="flex-1 text-dim">
              {t("today.services", { count: devs })}
            </span>
            <span className="num">{devs}</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-3 w-3 items-center justify-center text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="flex-1 text-dim">{t("today.ports", { count: ports })}</span>
            <span className="num">{ports}</span>
          </li>
          <li className="flex items-center gap-2">
            <Sparkles size={12} className="text-warn" />
            <span className="flex-1 text-dim">
              {t("today.aiProcesses", { count: ais })}
            </span>
            <span className="num">{ais}</span>
          </li>
        </ul>
      )}
    </Card>
  );
}

function AttentionChip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: "danger" | "warn" | "accent" | "dim";
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger/8 text-danger",
    warn: "border-warn/30 bg-warn/8 text-warn",
    accent: "border-accent/30 bg-accent/8 text-accent",
    dim: "border-line bg-panel2/50 text-dim",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:brightness-110 ${
        active ? tones[tone] : "border-line bg-transparent text-faint"
      }`}
    >
      {label}
    </button>
  );
}

function TaskRow({
  task,
  projectName,
  onComplete,
  onOpen,
  compact = false,
}: {
  task: Task;
  projectName: string | null;
  onComplete: () => void;
  onOpen: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const due = dueLabel(task.due);
  return (
    <li className="group flex items-center gap-2 border-b border-line/50 py-1.5 last:border-0">
      <button
        type="button"
        onClick={onComplete}
        aria-label={t("today.markDone")}
        title={t("today.markDone")}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-dim/50 text-transparent transition-colors hover:border-ok hover:text-ok"
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate text-left text-[12.5px] hover:text-accent"
      >
        {task.title}
      </button>
      {!compact && projectName && (
        <span className="hidden max-w-[110px] truncate text-[10.5px] text-faint sm:inline">
          {projectName}
        </span>
      )}
      <span className="hidden text-[10px] text-faint sm:inline">
        {priorityLabel(task.priority, t)}
      </span>
      <Badge tone={due.tone}>{due.text}</Badge>
    </li>
  );
}
