import { useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import dayjs from "dayjs";
import {
  ArrowRight,
  Check,
  FolderOpen,
  Inbox,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Server,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { localeFor, useLang, useT } from "../lib/i18n";
import { useTransportMode } from "../lib/useAppRuntime";
import { Badge, Btn, Empty, Modal } from "../ui";
import { BrandMark } from "../components/BrandMark";
import { ProgressRing } from "../components/ProgressRing";
import { dueLabel, formatTime } from "../lib/util";
import {
  attentionCounts,
  explicitNextStep,
  isBlocked,
  isDueToday,
  isOpenTask,
  nextTaskForProject,
  pickCurrentProject,
  projectGoal,
  projectProgress,
  sortTasksForWork,
  tasksForToday,
  type AttentionCounts,
  type ProjectProgress,
  type TaskScope,
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
 * 工作台首页：品牌头部 → 快速记录 → 注意力 → 当前项目/今天 → 右栏上下文。
 *
 * 设计意图：减少等大方块卡片，用一个大标题、一条环形进度、右侧独立信息栏
 * 建立层次；动效只保留缓慢的品牌轨道，并受 data-motion 全局断闸控制。
 * 所有计数仍来自 lib/workbench，与任务页保持同一口径。
 */
export default function Today() {
  const t = useT();
  const lang = useLang();
  const mode = useTransportMode();
  const quickRef = useRef<HTMLInputElement>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickProject, setQuickProject] = useState("");
  const [railSettingsOpen, setRailSettingsOpen] = useState(false);

  const {
    data,
    devs,
    ais,
    ports,
    runtimeError,
    workModes,
    railCollapsed,
    railSections,
    lastDataUpdatedAt,
    addTask,
    moveTask,
    setView,
    setToast,
    setTaskScope,
    setTaskProjectFilter,
    setRailCollapsed,
    setRailSection,
    resetRailSections,
    setTaskDetailId,
    openTarget,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      devs: s.devs,
      ais: s.ais,
      ports: s.ports,
      runtimeError: s.runtimeError,
      workModes: s.workModes,
      railCollapsed: s.railCollapsed,
      railSections: s.railSections,
      lastDataUpdatedAt: s.lastDataUpdatedAt,
      addTask: s.addTask,
      moveTask: s.moveTask,
      setView: s.setView,
      setToast: s.setToast,
      setTaskScope: s.setTaskScope,
      setTaskProjectFilter: s.setTaskProjectFilter,
      setRailCollapsed: s.setRailCollapsed,
      setRailSection: s.setRailSection,
      resetRailSections: s.resetRailSections,
      setTaskDetailId: s.setTaskDetailId,
      openTarget: s.openTarget,
    }))
  );

  const now = dayjs();
  const counts = useMemo(() => attentionCounts(data.tasks), [data.tasks]);
  const todayTasks = useMemo(() => tasksForToday(data.tasks), [data.tasks]);
  const todayDone = useMemo(
    () => data.tasks.filter((task) => task.status === "done" && isDueToday(task)).length,
    [data.tasks]
  );
  const todayTotal = todayDone + todayTasks.length;
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
    scope: TaskScope,
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

  const showProjects = railSections.projects && showsProjectsPanel(workModes);
  const showInbox = railSections.inbox;
  const showSystem = railSections.system && showsToolsSummary(workModes);
  const railHasContent = showProjects || showInbox || showSystem;

  return (
    <div className="flex flex-col gap-6">
      <TodayHeader
        now={now}
        lang={lang}
        modeNames={modeNames}
        onChangeMode={() => setView("settings")}
        done={todayDone}
        total={todayTotal}
        dataUpdatedAt={lastDataUpdatedAt}
      />

      {mode === "demo" && (
        <div className="rounded-[var(--radius-btn)] border border-warn/30 bg-warn/8 px-3 py-2 text-[11.5px] leading-relaxed text-warn">
          {t("today.demoNotice")}
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-6 ${
          railCollapsed ? "xl:grid-cols-1" : "xl:grid-cols-[minmax(0,1fr)_320px]"
        }`}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <QuickCapture
            inputRef={quickRef}
            title={quickTitle}
            onTitle={setQuickTitle}
            project={quickProject}
            onProject={setQuickProject}
            projects={data.projects}
            onSubmit={capture}
          />

          <div className="flex flex-wrap items-center gap-2">
            <AttentionBar counts={counts} onOpen={openTaskList} />
            <button
              type="button"
              onClick={() => setRailCollapsed(!railCollapsed)}
              title={
                railCollapsed ? t("today.railExpand") : t("today.railCollapse")
              }
              aria-label={
                railCollapsed ? t("today.railExpand") : t("today.railCollapse")
              }
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-panel/60 px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-accent/40 hover:text-text"
            >
              {railCollapsed ? (
                <PanelRightOpen size={13} />
              ) : (
                <PanelRightClose size={13} />
              )}
              <span className="hidden sm:inline">
                {railCollapsed ? t("today.railExpand") : t("today.railCollapse")}
              </span>
            </button>
          </div>

          <CurrentProject
            project={current}
            progress={currentProgress}
            next={currentNext}
            onOpenTasks={() => current && openTaskList("all", current.id)}
            onNewTask={() => focusQuick(current?.id ?? "")}
            onOpenFolder={() => current?.path && void openTarget(current.path)}
            onCreateProject={() => setView("projects")}
          />

          <TaskList
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
            onOpen={(task) => setTaskDetailId(task.id)}
          />

          {upcoming.length > 0 && (
            <TaskList
              title={t("today.upcoming")}
              tasks={upcoming}
              projects={data.projects}
              onComplete={(id) => moveTask(id, "done")}
              onOpen={(task) => setTaskDetailId(task.id)}
            />
          )}
        </div>

        {!railCollapsed && (
          <aside className="flex min-w-0 flex-col gap-5 rounded-[calc(var(--radius-card)+2px)] border border-line/70 bg-panel/60 p-4 xl:sticky xl:top-5 xl:self-start [&>section:first-of-type]:border-t-0 [&>section:first-of-type]:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] font-medium tracking-[0.04em] text-faint">
                {t("today.rail")}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setRailSettingsOpen(true)}
                  title={t("today.railSettings")}
                  aria-label={t("today.railSettings")}
                  className="rounded p-1 text-faint transition-colors hover:text-text"
                >
                  <SlidersHorizontal size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setRailCollapsed(true)}
                  title={t("today.railCollapse")}
                  aria-label={t("today.railCollapse")}
                  className="rounded p-1 text-faint transition-colors hover:text-text"
                >
                  <PanelRightClose size={13} />
                </button>
              </div>
            </div>

            {showProjects && (
              <ProjectsRail
                rows={projectRows}
                onOpen={(id) => openTaskList("all", id)}
                onViewAll={() => setView("projects")}
                onCreate={() => setView("projects")}
              />
            )}

            {showInbox && (
              <InboxRail
                tasks={inbox}
                onOpen={(task) => setTaskDetailId(task.id)}
                onComplete={(id) => moveTask(id, "done")}
                onViewAll={() => openTaskList("inbox")}
              />
            )}

            {showSystem && (
              <SystemRail
                devs={devs.length}
                ports={ports.length}
                ais={ais.length}
                error={runtimeError}
                onOpen={() => setView("overview")}
              />
            )}

            {!railHasContent && (
              <div className="rounded-[var(--radius-btn)] border border-dashed border-line/80 px-3 py-4 text-center">
                <div className="text-[11.5px] text-dim">{t("today.railAllHidden")}</div>
                <Btn className="mt-2" onClick={resetRailSections}>
                  {t("today.railRestore")}
                </Btn>
              </div>
            )}
          </aside>
        )}
      </div>

      <Modal
        open={railSettingsOpen}
        title={t("today.railSettings")}
        onClose={() => setRailSettingsOpen(false)}
        footer={
          <Btn variant="primary" onClick={() => setRailSettingsOpen(false)}>
            {t("tasks.done")}
          </Btn>
        }
      >
        <p className="text-[12px] leading-relaxed text-dim">{t("today.railHint")}</p>
        <div className="mt-3 flex flex-col gap-2.5">
          {(["projects", "inbox", "system"] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={railSections[key]}
                onChange={(e) => setRailSection(key, e.target.checked)}
                className="rounded border-line accent-accent"
              />
              <span>
                {key === "projects"
                  ? t("today.projects")
                  : key === "inbox"
                    ? t("today.inboxTitle")
                    : t("today.system")}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <Btn onClick={resetRailSections}>{t("today.railRestore")}</Btn>
        </div>
      </Modal>
    </div>
  );
}

function TodayHeader({
  now,
  lang,
  modeNames,
  onChangeMode,
  done,
  total,
  dataUpdatedAt,
}: {
  now: dayjs.Dayjs;
  lang: ReturnType<typeof useLang>;
  modeNames: { labelKey: string }[];
  onChangeMode: () => void;
  done: number;
  total: number;
  dataUpdatedAt: number;
}) {
  const t = useT();
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <header className="workbench-hero relative rounded-[calc(var(--radius-card)+4px)] border border-line/80 px-5 py-6 sm:px-7 sm:py-7">
      <HeroOrbit />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          <BrandMark
            className="mt-1 h-12 w-[54px] shrink-0 text-accent sm:h-16 sm:w-[72px]"
            strokeWidth={4.5}
          />
          <div className="min-w-0">
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
              <span aria-hidden="true">·</span>
              <span title={t("app.dataUpdatedAt", { time: formatTime(dataUpdatedAt) })}>
                {dataUpdatedAt > 0
                  ? t("app.dataUpdatedAt", { time: formatTime(dataUpdatedAt) })
                  : t("app.dataWaiting")}
              </span>
            </div>
            <h1 className="t-heading mt-2 text-[34px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[44px]">
              {t("today.title")}
            </h1>
            <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-dim">
              {t("today.subtitle")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 self-start rounded-[calc(var(--radius-card))] border border-line/60 bg-panel/70 px-3 py-2.5 backdrop-blur-sm sm:self-center sm:gap-4 sm:px-4">
          <ProgressRing percent={percent} size={76} strokeWidth={6} />
          <div className="min-w-0">
            <div className="text-[10px] text-faint">{t("today.today")}</div>
            <div className="mt-0.5 whitespace-nowrap text-[12px] font-medium">
              {t("today.progress", { done, total })}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeroOrbit() {
  return (
    <svg
      className="pointer-events-none absolute -right-16 -top-20 h-[300px] w-[300px] text-accent/30 sm:-right-4 sm:-top-16"
      viewBox="0 0 200 200"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="100" cy="100" r="94" stroke="currentColor" strokeOpacity=".22" />
      <circle
        cx="100"
        cy="100"
        r="72"
        stroke="currentColor"
        strokeOpacity=".12"
        strokeDasharray="1.5 8"
      />
      <g className="hero-orbit-spin">
        <circle cx="100" cy="6" r="4" fill="currentColor" fillOpacity=".7" />
        <circle cx="194" cy="100" r="2.5" fill="currentColor" fillOpacity=".45" />
        <circle cx="100" cy="172" r="2" fill="currentColor" fillOpacity=".3" />
      </g>
    </svg>
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
    <form
      className="flex flex-col gap-1.5 rounded-[calc(var(--radius-card)+2px)] border border-line/80 bg-panel px-2 py-2 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.5)] transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10 sm:flex-row sm:items-center sm:rounded-full"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
        <Plus size={16} className="shrink-0 text-accent" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-text outline-none placeholder:text-faint"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder={t("today.quickPlaceholder")}
          aria-label={t("today.quickPlaceholder")}
        />
      </div>
      <select
        className="rounded-[var(--radius-btn)] border border-line bg-panel2 px-2 py-1.5 text-xs text-text outline-none sm:w-40 sm:border-0 sm:border-l sm:bg-transparent sm:pl-3"
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
      <Btn variant="primary" type="submit" className="shrink-0 sm:!rounded-full">
        {t("today.quickAdd")}
      </Btn>
    </form>
  );
}

function AttentionBar({
  counts,
  onOpen,
}: {
  counts: AttentionCounts;
  onOpen: (scope: TaskScope) => void;
}) {
  const t = useT();
  const total =
    counts.overdue + counts.today + counts.doing + counts.inbox + counts.blocked;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[11px] font-medium tracking-[0.04em] text-faint">
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
        tone="danger"
        label={t("today.blocked", { count: counts.blocked })}
        active={counts.blocked > 0}
        onClick={() => onOpen("blocked")}
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

function CurrentProject({
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
      <section className="rounded-[calc(var(--radius-card)+2px)] border border-dashed border-line/80 px-5 py-6">
        <div className="text-[11px] font-medium text-faint">{t("today.current")}</div>
        <Empty
          action={
            <Btn variant="primary" onClick={onCreateProject}>
              <Plus size={13} /> {t("today.createProject")}
            </Btn>
          }
        >
          {t("today.noProjectHint")}
        </Empty>
      </section>
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
    <section className="relative overflow-hidden rounded-[calc(var(--radius-card)+2px)] border border-line/80 bg-panel p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-faint">{t("today.current")}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[24px] font-semibold tracking-[-0.025em]">
                {project.name}
              </h2>
              <Badge tone={statusTone}>{statusLabel}</Badge>
              {progress.overdue > 0 && (
                <Badge tone="danger">
                  {t("projects.overdueCount", { count: progress.overdue })}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 max-w-[52ch] text-[12.5px] leading-relaxed text-dim">
              {projectGoal(project) || t("projects.noGoal")}
            </p>
          </div>
          <ProgressRing
            percent={progress.percent}
            size={72}
            strokeWidth={6}
            label={`${progress.done}/${progress.total}`}
          />
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
    </section>
  );
}

function NextAction({ next, onOpen }: { next: Task | null; onOpen: () => void }) {
  const t = useT();
  const due = next ? dueLabel(next.due) : null;
  const step = explicitNextStep(next);
  return (
    <div className="flex items-center gap-3 border-l-2 border-accent/60 pl-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-medium tracking-[0.04em] text-faint">
          {t("today.nextAction")}
        </div>
        {next ? (
          <>
            <button
              type="button"
              onClick={onOpen}
              className="mt-0.5 block w-full truncate text-left text-[13.5px] font-medium hover:text-accent"
            >
              {step || next.title}
            </button>
            {step && (
              <div className="mt-0.5 truncate text-[11px] text-faint">{next.title}</div>
            )}
          </>
        ) : (
          <div className="mt-0.5 text-[12px] text-dim">{t("today.noNextAction")}</div>
        )}
      </div>
      {due && <Badge tone={due.tone}>{due.text}</Badge>}
    </div>
  );
}

function TaskList({
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
    <section className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 border-b border-line/70 pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {tasks.length > 0 && (
            <span className="num text-[10.5px] text-faint">{tasks.length}</span>
          )}
        </div>
        {extra}
      </div>
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
    </section>
  );
}

function ProjectsRail({
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
    <section>
      <RailHeader title={t("today.projects")} action={t("today.viewProjects")} onAction={onViewAll} />
      {rows.length === 0 ? (
        <div className="pt-2">
          <Empty
            action={
              <Btn onClick={onCreate}>
                <Plus size={13} /> {t("today.createProject")}
              </Btn>
            }
          >
            {t("today.noProjectHint")}
          </Empty>
        </div>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ project, progress, next }) => (
            <li key={project.id} className="border-b border-line/40 last:border-0">
              <button
                type="button"
                onClick={() => onOpen(project.id)}
                className="group flex w-full flex-col gap-1.5 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium group-hover:text-accent">
                    {project.name}
                  </span>
                  <span className="num text-[10px] text-faint">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-bg">
                  <div
                    className="h-full rounded-full bg-accent/80"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
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
    </section>
  );
}

function InboxRail({
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
    <section className="border-t border-line/60 pt-4">
      <RailHeader
        title={t("today.inboxTitle")}
        action={t("today.viewTasks")}
        onAction={onViewAll}
        icon={<Inbox size={12} />}
      />
      {tasks.length === 0 ? (
        <div className="py-2.5">
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
    </section>
  );
}

function SystemRail({
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
    <section className="border-t border-line/60 pt-4">
      <RailHeader title={t("today.system")} action={t("today.openTools")} onAction={onOpen} />
      {error ? (
        <div className="mt-2 rounded-[var(--radius-btn)] border border-danger/30 bg-danger/8 px-2.5 py-2 text-[11px] text-danger">
          {t("today.systemError", { err: error })}
        </div>
      ) : (
        <ul className="mt-1 flex flex-col gap-2 text-[11.5px]">
          <li className="flex items-center gap-2">
            <Server size={12} className="text-ok" />
            <span className="flex-1 text-dim">
              {t("today.services", { count: devs })}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-3 w-3 items-center justify-center text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="flex-1 text-dim">{t("today.ports", { count: ports })}</span>
          </li>
          <li className="flex items-center gap-2">
            <Sparkles size={12} className="text-warn" />
            <span className="flex-1 text-dim">
              {t("today.aiProcesses", { count: ais })}
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}

function RailHeader({
  title,
  action,
  onAction,
  icon,
}: {
  title: string;
  action: string;
  onAction: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.04em] text-faint">
        {icon}
        {title}
      </h2>
      <button
        type="button"
        className="text-[10.5px] text-accent hover:underline"
        onClick={onAction}
      >
        {action}
      </button>
    </div>
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
    <li className="group flex items-center gap-2 rounded-[var(--radius-btn)] border-b border-line/50 px-1 py-2 transition-colors last:border-0 hover:bg-panel2/50">
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
      {isBlocked(task) && <Badge tone="danger">{t("tasks.blocked")}</Badge>}
      <Badge tone={due.tone}>{due.text}</Badge>
    </li>
  );
}
