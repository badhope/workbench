import { useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal } from "lucide-react";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { useLang, useT } from "../lib/i18n";
import { Btn, Modal } from "../ui";
import {
  attentionCounts,
  isOpenTask,
  nextTaskForProject,
  pickCurrentProject,
  projectProgress,
  sortTasksForWork,
  tasksForToday,
  todayStats,
  type TaskScope,
} from "../lib/workbench";
import { showsProjectsPanel, showsToolsSummary, WORK_MODES } from "../lib/workModes";
import { TodayHeader } from "./today/TodayHeader";
import { LivePulse } from "./today/LivePulse";
import { QuickCapture } from "./today/QuickCapture";
import { AttentionBar } from "./today/AttentionBar";
import { CurrentProject } from "./today/CurrentProject";
import { TaskList } from "./today/TaskList";
import { InboxRail, ProjectsRail, SystemRail } from "./today/Rails";

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
  // 完成数按 completed_at 落在今天统计；分母含今天已完成的，不会“越做越倒退”。
  const todayStat = useMemo(
    () => todayStats(data.tasks, todayTasks),
    [data.tasks, todayTasks]
  );
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

  const openTaskList = (scope: TaskScope, projectId = "") => {
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
        done={todayStat.done}
        total={todayStat.total}
        dataUpdatedAt={lastDataUpdatedAt}
      />

      <LivePulse />

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
              title={railCollapsed ? t("today.railExpand") : t("today.railCollapse")}
              aria-label={railCollapsed ? t("today.railExpand") : t("today.railCollapse")}
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
            onOpenTask={(id) => setTaskDetailId(id)}
          />

          <TaskList
            title={t("today.today")}
            tasks={todayTasks.slice(0, 7)}
            totalCount={todayTasks.length}
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
