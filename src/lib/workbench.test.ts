import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import {
  attentionCounts,
  completionTrend,
  explicitNextStep,
  isDueThisWeek,
  isDueToday,
  isOverdue,
  nextTaskForProject,
  pickCurrentProject,
  projectGoal,
  projectProgress,
  sortTasksForWork,
  taskMatchesScope,
  tasksForToday,
} from "./workbench";
import type { Project, Task } from "../types";

const NOW = dayjs("2026-11-11T09:00:00");

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Task",
    status: "todo",
    priority: "normal",
    due: null,
    project_id: null,
    tags: [],
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Project",
    path: "",
    status: "active",
    tags: [],
    pinned: false,
    note: "",
    created_at: 1,
    ...over,
  };
}

describe("日期范围口径", () => {
  it("逾期只算未完成且截止日早于今天", () => {
    expect(isOverdue(task({ due: "2026-11-10" }), NOW)).toBe(true);
    expect(isOverdue(task({ due: "2026-11-11" }), NOW)).toBe(false);
    expect(isOverdue(task({ due: "2026-11-10", status: "done" }), NOW)).toBe(false);
  });

  it("今天到期按本地日历日比较", () => {
    expect(isDueToday(task({ due: "2026-11-11" }), NOW)).toBe(true);
    expect(isDueToday(task({ due: "2026-11-12" }), NOW)).toBe(false);
  });

  it("本周范围包含逾期和未来 7 天，不包含更远", () => {
    expect(isDueThisWeek(task({ due: "2026-11-18" }), NOW)).toBe(true);
    expect(isDueThisWeek(task({ due: "2026-11-19" }), NOW)).toBe(false);
  });

  it("今天的任务范围包含进行中事项，即使没有截止日", () => {
    expect(taskMatchesScope(task({ status: "doing" }), "today", NOW)).toBe(true);
    expect(taskMatchesScope(task({ status: "todo" }), "today", NOW)).toBe(false);
    expect(taskMatchesScope(task({ due: "2026-11-11" }), "today", NOW)).toBe(true);
  });

  it("收件箱只包含未归入项目的未完成任务", () => {
    expect(taskMatchesScope(task(), "inbox", NOW)).toBe(true);
    expect(taskMatchesScope(task({ project_id: "p1" }), "inbox", NOW)).toBe(false);
    expect(taskMatchesScope(task({ status: "done" }), "inbox", NOW)).toBe(false);
  });
});

describe("排序与首页列表", () => {
  it("排序：有截止日优先，同日按优先级", () => {
    const sorted = sortTasksForWork([
      task({ id: "none", due: null, priority: "high" }),
      task({ id: "late", due: "2026-11-20", priority: "high" }),
      task({ id: "today-low", due: "2026-11-11", priority: "low" }),
      task({ id: "today-high", due: "2026-11-11", priority: "high" }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual([
      "today-high",
      "today-low",
      "late",
      "none",
    ]);
  });

  it("今天列表包含逾期、今天到期和进行中，且不重复", () => {
    const list = tasksForToday(
      [
        task({ id: "overdue", due: "2026-11-10" }),
        task({ id: "today", due: "2026-11-11" }),
        task({ id: "doing", status: "doing" }),
        task({ id: "later", due: "2026-11-20" }),
        task({ id: "done", status: "done", due: "2026-11-11" }),
      ],
      NOW
    );
    expect(list.map((x) => x.id).sort()).toEqual(["doing", "overdue", "today"]);
  });
});

describe("项目进度与下一步", () => {
  const tasks = [
    task({ id: "a", project_id: "p1", status: "done", due: "2026-11-01" }),
    task({ id: "b", project_id: "p1", status: "todo", due: "2026-11-12" }),
    task({ id: "c", project_id: "p1", status: "todo", due: "2026-11-10" }),
    task({ id: "d", project_id: "p2", status: "todo", due: "2026-11-11" }),
  ];

  it("统计完成数、未完成数和逾期数", () => {
    expect(projectProgress("p1", tasks, NOW)).toEqual({
      total: 3,
      done: 1,
      open: 2,
      overdue: 1,
      percent: 33,
    });
  });

  it("下一步取未完成中排序最靠前的一项", () => {
    expect(nextTaskForProject("p1", tasks)?.id).toBe("c");
  });

  it("置顶项目优先作为当前项目", () => {
    const picked = pickCurrentProject(
      [
        project({ id: "recent", name: "Recent", created_at: 9 }),
        project({ id: "pinned", name: "Pinned", pinned: true, created_at: 1 }),
      ],
      tasks
    );
    expect(picked?.id).toBe("pinned");
  });

  it("没有置顶时选最近有未完成任务的項目", () => {
    const picked = pickCurrentProject(
      [
        project({ id: "p1", name: "P1", created_at: 1 }),
        project({ id: "p2", name: "P2", created_at: 2 }),
      ],
      [
        task({ id: "old", project_id: "p1", updated_at: 10 }),
        task({ id: "new", project_id: "p2", updated_at: 20 }),
      ]
    );
    expect(picked?.id).toBe("p2");
  });

  it("注意力计数覆盖逾期、今天、进行中、收件箱和阻塞", () => {
    expect(
      attentionCounts(
        [
          task({ id: "overdue", due: "2026-11-10" }),
          task({ id: "today", due: "2026-11-11" }),
          task({ id: "doing", status: "doing", project_id: "p1" }),
          task({ id: "blocked", project_id: "p1", blocked_reason: "等待后端" }),
          task({ id: "inbox" }),
        ],
        NOW
      )
    ).toEqual({ overdue: 1, today: 1, doing: 1, inbox: 3, blocked: 1 });
  });

  it("阻塞范围只包含写明阻塞原因且未完成的任务", () => {
    expect(taskMatchesScope(task({ blocked_reason: "等待后端" }), "blocked", NOW)).toBe(
      true
    );
    expect(taskMatchesScope(task({ blocked_reason: "  " }), "blocked", NOW)).toBe(false);
    expect(
      taskMatchesScope(
        task({ status: "done", blocked_reason: "等待后端" }),
        "blocked",
        NOW
      )
    ).toBe(false);
  });
});

describe("v2 字段口径", () => {
  it("项目目标优先 goal，为空时回落到 note", () => {
    expect(projectGoal(project({ goal: "上线", note: "备注" }))).toBe("上线");
    expect(projectGoal(project({ goal: "  ", note: "备注" }))).toBe("备注");
    expect(projectGoal(project({ note: "" }))).toBe("");
    expect(projectGoal(null)).toBe("");
  });

  it("显式下一步只认 next_step，不拿标题凑数", () => {
    expect(explicitNextStep(task({ next_step: " 先改数据模型 " }))).toBe(
      "先改数据模型"
    );
    expect(explicitNextStep(task({ title: "标题" }))).toBe("");
    expect(explicitNextStep(null)).toBe("");
  });

  it("完成趋势按 completed_at 落到本地日历日", () => {
    const trend = completionTrend(
      [
        task({ id: "today", status: "done", completed_at: NOW.unix() }),
        task({
          id: "two-days-ago",
          status: "done",
          completed_at: NOW.subtract(2, "day").unix(),
        }),
        // 旧任务没有完成时间：不计数，也不拿 updated_at 冒充。
        task({ id: "legacy", status: "done" }),
      ],
      14,
      NOW
    );
    expect(trend).toHaveLength(14);
    expect(trend[13].count).toBe(1);
    expect(trend[11].count).toBe(1);
    expect(trend.reduce((sum, point) => sum + point.count, 0)).toBe(2);
  });

  it("没有完成记录时趋势全为 0", () => {
    const trend = completionTrend([task({ id: "legacy", status: "done" })], 3, NOW);
    expect(trend.map((point) => point.count)).toEqual([0, 0, 0]);
  });
});
