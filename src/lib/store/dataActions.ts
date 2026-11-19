import { backupData, isBackend, restoreBackup } from "../api";
import { notifyDataChanged } from "../dataSync";
import { t } from "../i18n";
import type { Project, RestoreResult, Task } from "../../types";
import { mergeSnapshot, uid } from "./helpers";
import type { Persistence } from "./persistence";
import type { Store, StoreGet, StoreSet } from "./types";

export type DataActions = Pick<
  Store,
  | "addTask"
  | "moveTask"
  | "updateTask"
  | "deleteTask"
  | "addProject"
  | "updateProject"
  | "deleteProject"
  | "persistData"
  | "persistDataNow"
  | "discardUnsavedAndReload"
  | "backupCurrentData"
  | "restoreData"
>;

function saveFailureToast(set: StoreSet, error: unknown): void {
  set({ toast: t("store.saveFailed", { err: String(error) }) });
}

export function createDataActions(
  set: StoreSet,
  get: StoreGet,
  p: Persistence
): DataActions {
  function rejectIfBusy(): boolean {
    if (p.isRestoring() || (isBackend() && p.isBlocked())) {
      set({ toast: t("store.saveFailed", { err: "数据正在恢复或需要重新加载" }) });
      return true;
    }
    return false;
  }

  return {
    addTask: (input) => {
      const now = Math.floor(Date.now() / 1000);
      const status = input.status ?? "todo";
      const task: Task = {
        id: uid(),
        title: input.title?.trim() || t("store.unnamedTask"),
        status,
        priority: input.priority ?? "normal",
        due: input.due ?? null,
        project_id: input.project_id ?? null,
        tags: input.tags ?? [],
        next_step: input.next_step ?? undefined,
        blocked_reason: input.blocked_reason ?? undefined,
        // 直接以 done 状态建的任务，完成时间就是建的那一刻。
        completed_at: status === "done" ? now : undefined,
        created_at: now,
        updated_at: now,
      };
      return get().persistData({ ...get().data, tasks: [task, ...get().data.tasks] });
    },

    moveTask: (id, status) => {
      return get().updateTask(id, { status });
    },

    updateTask: (id, patch) => {
      const now = Math.floor(Date.now() / 1000);
      const tasks = get().data.tasks.map((task) => {
        if (task.id !== id) return task;
        const next = { ...task, ...patch, updated_at: now };
        // 完成时间是「状态进入 done 的那一刻」，离开 done 就清掉。
        // 只在状态真的变了的时候动它 —— 改个标题不该把完成时间刷新一遍。
        if (patch.status !== undefined && patch.status !== task.status) {
          next.completed_at = patch.status === "done" ? now : undefined;
        }
        return next;
      });
      return get().persistData({ ...get().data, tasks });
    },

    deleteTask: (id) => {
      get().persistData({
        ...get().data,
        tasks: get().data.tasks.filter((task) => task.id !== id),
      });
    },

    addProject: (input) => {
      const project: Project = {
        id: uid(),
        name: input.name?.trim() || t("store.unnamedProject"),
        path: input.path?.trim() ?? "",
        status: input.status ?? "active",
        tags: input.tags ?? [],
        pinned: input.pinned ?? false,
        note: input.note ?? "",
        goal: input.goal ?? undefined,
        created_at: Math.floor(Date.now() / 1000),
      };
      return get().persistData({
        ...get().data,
        projects: [project, ...get().data.projects],
      });
    },

    updateProject: (id, patch) => {
      const projects = get().data.projects.map((project) =>
        project.id === id ? { ...project, ...patch } : project
      );
      return get().persistData({ ...get().data, projects });
    },

    deleteProject: (id) => {
      if (get().taskProjectFilter === id) set({ taskProjectFilter: "" });
      get().persistData({
        projects: get().data.projects.filter((project) => project.id !== id),
        tasks: get().data.tasks.map((task) =>
          task.project_id === id ? { ...task, project_id: null } : task
        ),
      });
    },

    persistData: (next) => {
      if (rejectIfBusy()) return false;
      set({ data: next, lastDataUpdatedAt: Date.now() });
      if (!isBackend()) {
        // 纯浏览器演示没有磁盘；仍然广播一次，方便同源窗口看到变更。
        notifyDataChanged();
        return true;
      }
      p.schedule(next, (error) => saveFailureToast(set, error));
      return true;
    },

    persistDataNow: async (next) => {
      if (rejectIfBusy()) return false;
      if (!isBackend()) {
        set({ data: next, lastDataUpdatedAt: Date.now() });
        notifyDataChanged();
        return true;
      }
      p.begin();
      try {
        await p.flush();
        await p.saveNow(next);
        p.bumpEdit();
        set({ data: next, lastDataUpdatedAt: Date.now() });
        return true;
      } finally {
        p.end();
      }
    },

    discardUnsavedAndReload: async () => {
      if (p.isRestoring()) throw new Error("数据正在恢复");
      p.begin();
      p.capture();
      p.clearTimer();
      try {
        await p.waitForQueue();
        const snapshot = await p.load();
        p.discardPending();
        p.setGeneration(snapshot.generation);
        set({ data: mergeSnapshot(snapshot.data) });
        p.setBlocked(false);
      } catch (error) {
        p.reschedule((failure) => saveFailureToast(set, failure));
        throw error;
      } finally {
        p.end();
      }
    },

    backupCurrentData: async () => {
      if (p.isRestoring()) throw new Error("数据正在恢复或备份");
      p.begin();
      try {
        await p.flush();
        if (p.isDirty()) throw new Error("有未保存的数据，无法创建备份");
        return await backupData();
      } finally {
        p.end();
      }
    },

    restoreData: async (id) => {
      if (p.isRestoring()) throw new Error("数据正在恢复");
      p.begin();
      p.capture();
      try {
        try {
          await p.flush();
        } catch (error) {
          throw new Error(
            `${String(error)}；未保存的数据仍在内存，请先导出 JSON 再重新加载`,
            { cause: error }
          );
        }
        let result: RestoreResult | undefined;
        let restoreError: unknown;
        let restoreFailed = false;
        try {
          result = await restoreBackup(id);
        } catch (error) {
          restoreFailed = true;
          restoreError = error;
        }
        p.setBlocked(true);
        try {
          const snapshot = await p.load();
          p.setGeneration(snapshot.generation);
          set({
            data: mergeSnapshot(snapshot.data),
            lastDataUpdatedAt: Date.now(),
          });
          p.setBlocked(false);
        } catch (error) {
          if (restoreFailed) {
            throw new Error(`${String(restoreError)}；重新加载失败: ${String(error)}`, {
              cause: error,
            });
          }
          throw error;
        }
        if (restoreFailed) throw restoreError;
        if (!result) throw new Error("恢复未返回结果");
        return result;
      } finally {
        p.end();
      }
    },
  };
}
