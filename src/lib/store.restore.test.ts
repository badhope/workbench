import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchData } from "../types";

const backend = vi.hoisted(() => ({
  disk: { projects: [], tasks: [] } as WorkbenchData,
  backup: { projects: [], tasks: [] } as WorkbenchData,
  safety: { projects: [], tasks: [] } as WorkbenchData,
  failRestore: false,
  failLoad: false,
  saveGate: null as Promise<void> | null,
  generation: 0,
  loadGate: null as Promise<void> | null,
  manualBackup: null as WorkbenchData | null,
}));

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return {
    ...actual,
    isTauri: () => true,
    isBackend: () => true,
    loadDataVersioned: async () => {
      if (backend.failLoad) throw new Error("load failed");
      const snapshot = {
        data: structuredClone(backend.disk),
        generation: String(backend.generation),
      };
      if (backend.loadGate) await backend.loadGate;
      return snapshot;
    },
    saveData: async (data: WorkbenchData, generation: string) => {
      if (backend.saveGate) await backend.saveGate;
      if (generation !== String(backend.generation)) throw new Error("stale generation");
      backend.disk = structuredClone(data);
      backend.generation += 1;
      return String(backend.generation);
    },
    backupData: async () => {
      backend.manualBackup = structuredClone(backend.disk);
      return { dir: "fixture", files: ["data.json"], skipped: [] };
    },
    restoreBackup: async () => {
      backend.safety = structuredClone(backend.disk);
      backend.disk = structuredClone(backend.backup);
      backend.generation += 1;
      if (backend.failRestore) throw new Error("partial restore");
      return { safety_backup: "fixture", restored: ["data.json"], untouched: [] };
    },
  };
});

const { useStore } = await import("./store");

beforeEach(async () => {
  vi.useFakeTimers();
  backend.disk = { projects: [], tasks: [] };
  backend.backup = { projects: [], tasks: [] };
  backend.failRestore = false;
  backend.failLoad = false;
  backend.saveGate = null;
  backend.loadGate = null;
  backend.generation = 0;
  backend.manualBackup = null;
  useStore.setState({ data: structuredClone(backend.disk), toast: "" });
  await useStore.getState().restoreData("20261101-000000");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("restore persistence coordination", () => {
  it("flushes pending edits before manual backup", async () => {
    useStore.getState().addTask({ title: "pending backup" });
    await useStore.getState().backupCurrentData();
    expect(backend.manualBackup?.tasks.map((task) => task.title)).toEqual([
      "pending backup",
    ]);
  });

  it("waits for an in-flight save before backing up", async () => {
    let release!: () => void;
    backend.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    useStore.getState().addTask({ title: "in-flight backup" });
    await vi.advanceTimersByTimeAsync(300);
    const backup = useStore.getState().backupCurrentData();
    await Promise.resolve();
    expect(backend.manualBackup).toBeNull();
    release();
    await backup;
    expect(backend.manualBackup?.tasks.map((task) => task.title)).toEqual([
      "in-flight backup",
    ]);
  });

  it("does not create a backup if pending save fails", async () => {
    useStore.getState().addTask({ title: "unsaved" });
    backend.generation += 1;
    await expect(useStore.getState().backupCurrentData()).rejects.toThrow(
      "stale generation"
    );
    expect(backend.manualBackup).toBeNull();
    await useStore.getState().discardUnsavedAndReload();
  });
  it("flushes pending edits into the safety backup, reloads restored data and saves subsequent edits on it", async () => {
    useStore.getState().addTask({ title: "pending" });
    const oldData = structuredClone(useStore.getState().data);
    backend.backup = {
      projects: [],
      tasks: [{ ...oldData.tasks[0], id: "restored", title: "restored" }],
    };

    await useStore.getState().restoreData("20261101-000000");
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.safety).toEqual(oldData);
    expect(backend.disk).toEqual(backend.backup);
    expect(useStore.getState().data).toEqual(backend.backup);

    useStore.getState().addTask({ title: "new" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual(["new", "restored"]);
  });

  it("ignores a late load snapshot after a newer edit has been saved", async () => {
    let release!: () => void;
    backend.loadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = useStore.getState().loadAll();
    useStore.getState().addTask({ title: "newer" });
    await vi.advanceTimersByTimeAsync(300);
    release();
    await loading;
    expect(useStore.getState().data.tasks.map((task) => task.title)).toEqual(["newer"]);
    useStore.getState().addTask({ title: "next" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual(["next", "newer"]);
  });

  it("preserves both errors when restoration and reload fail", async () => {
    backend.failLoad = true;
    backend.failRestore = true;
    await expect(useStore.getState().restoreData("20261101-000000")).rejects.toThrow(
      /partial restore.*load failed/
    );
  });

  it("preserves pre-import pending edits when their write fails", async () => {
    useStore.getState().addTask({ title: "original pending" });
    const original = structuredClone(useStore.getState().data);
    backend.saveGate = Promise.reject(new Error("disk unavailable"));
    const imported = { projects: [], tasks: [] };
    await expect(useStore.getState().persistDataNow(imported)).rejects.toThrow(
      "disk unavailable"
    );
    expect(useStore.getState().data).toEqual(original);
    backend.saveGate = null;
    await useStore.getState().restoreData("20261101-000000");
    expect(backend.safety).toEqual(original);
  });

  it("preserves an in-flight snapshot and blocks unrelated edits while import waits", async () => {
    let reject!: (reason: Error) => void;
    backend.saveGate = new Promise<void>((_, fail) => {
      reject = fail;
    });
    useStore.getState().addTask({ title: "in flight before import" });
    const original = structuredClone(useStore.getState().data);
    await vi.advanceTimersByTimeAsync(300);
    const importing = useStore.getState().persistDataNow({ projects: [], tasks: [] });
    useStore.getState().addTask({ title: "unrelated" });
    expect(useStore.getState().data).toEqual(original);
    reject(new Error("disk unavailable"));
    await expect(importing).rejects.toThrow("disk unavailable");
    expect(useStore.getState().data).toEqual(original);
    backend.saveGate = null;
    await useStore.getState().restoreData("20261101-000000");
    expect(backend.safety).toEqual(original);
  });

  it("reschedules pending edits when discard reload fails", async () => {
    useStore.getState().addTask({ title: "pending after failed reload" });
    backend.failLoad = true;
    await expect(useStore.getState().discardUnsavedAndReload()).rejects.toThrow(
      "load failed"
    );
    backend.failLoad = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual([
      "pending after failed reload",
    ]);
  });

  it("does not apply or later save imported data after the immediate disk write fails", async () => {
    const imported = {
      projects: [],
      tasks: [
        {
          id: "import",
          title: "imported",
          status: "todo",
          priority: "normal",
          due: null,
          project_id: null,
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    };
    backend.generation += 1;
    await expect(useStore.getState().persistDataNow(imported)).rejects.toThrow(
      "stale generation"
    );
    expect(useStore.getState().data).toEqual({ projects: [], tasks: [] });
    expect(backend.disk.tasks).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.disk.tasks).toEqual([]);
    await useStore.getState().discardUnsavedAndReload();
    useStore.getState().addTask({ title: "later edit" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual(["later edit"]);
  });

  it("uses the latest returned version for sequential saves", async () => {
    useStore.getState().addTask({ title: "first" });
    await vi.advanceTimersByTimeAsync(300);
    useStore.getState().addTask({ title: "second" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual(["second", "first"]);
  });

  it("waits for an in-flight save and rejects edits until restoration completes", async () => {
    let release!: () => void;
    backend.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    useStore.getState().addTask({ title: "in flight" });
    await vi.advanceTimersByTimeAsync(300);
    const restoration = useStore.getState().restoreData("20261101-000000");
    useStore.getState().addTask({ title: "blocked" });
    expect(useStore.getState().data.tasks.map((task) => task.title)).toEqual([
      "in flight",
    ]);
    release();
    await restoration;
    expect(backend.safety.tasks.map((task) => task.title)).toEqual(["in flight"]);
    expect(backend.disk).toEqual(backend.backup);
  });

  it("retries an in-flight failed save before a later restore without losing the edit", async () => {
    let reject!: (error: Error) => void;
    backend.saveGate = new Promise<void>((_, fail) => {
      reject = fail;
    });
    useStore.getState().addTask({ title: "unsaved" });
    await vi.advanceTimersByTimeAsync(300);
    const first = useStore.getState().restoreData("20261101-000000");
    reject(new Error("temporary failure"));
    await expect(first).rejects.toThrow("temporary failure");
    backend.saveGate = null;
    await useStore.getState().restoreData("20261101-000000");
    expect(backend.safety.tasks.map((task) => task.title)).toEqual(["unsaved"]);
  });

  it("reports when an edit is rejected during restoration", async () => {
    let release!: () => void;
    backend.saveGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    useStore.getState().addTask({ title: "pending" });
    const restoring = useStore.getState().restoreData("20261101-000000");
    const accepted = useStore.getState().persistData({ projects: [], tasks: [] });
    const taskAccepted = useStore.getState().addTask({ title: "draft" });
    const projectAccepted = useStore.getState().addProject({ name: "draft" });
    release();
    await restoring;
    expect(accepted).toBe(false);
    expect(taskAccepted).toBe(false);
    expect(projectAccepted).toBe(false);
  });

  it("blocks edits if the restored data cannot be loaded", async () => {
    backend.failLoad = true;
    await expect(useStore.getState().restoreData("20261101-000000")).rejects.toThrow(
      "load failed"
    );
    useStore.getState().addTask({ title: "blocked" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks).toEqual([]);
    expect(useStore.getState().data.tasks).toEqual([]);
    backend.failLoad = false;
    await useStore.getState().restoreData("20261101-000000");
  });

  it("reloads after a partial restore failure instead of saving the stale snapshot", async () => {
    useStore.getState().addTask({ title: "old" });
    backend.backup = structuredClone(useStore.getState().data);
    backend.backup.tasks[0].title = "restored";
    backend.failRestore = true;

    await expect(useStore.getState().restoreData("20261101-000000")).rejects.toThrow(
      "partial restore"
    );
    expect(useStore.getState().data).toEqual(backend.backup);
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk).toEqual(backend.backup);
  });

  it("does not overwrite data restored by another client when an old snapshot is saved", async () => {
    backend.generation += 1;
    useStore.getState().addTask({ title: "stale" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks).toEqual([]);
    expect(useStore.getState().toast).toContain("stale generation");
    expect(useStore.getState().data.tasks.map((task) => task.title)).toEqual(["stale"]);
    await useStore.getState().loadAll();
    expect(useStore.getState().data.tasks.map((task) => task.title)).toEqual(["stale"]);
    await expect(useStore.getState().restoreData("20261101-000000")).rejects.toThrow(
      "stale generation"
    );
    expect(backend.disk.tasks).toEqual([]);
    backend.failLoad = true;
    await expect(useStore.getState().discardUnsavedAndReload()).rejects.toThrow(
      "load failed"
    );
    expect(useStore.getState().data.tasks.map((task) => task.title)).toEqual(["stale"]);
    backend.failLoad = false;
    await useStore.getState().discardUnsavedAndReload();
    expect(useStore.getState().data.tasks).toEqual([]);
    useStore.getState().addTask({ title: "resolved" });
    await vi.advanceTimersByTimeAsync(300);
    expect(backend.disk.tasks.map((task) => task.title)).toEqual(["resolved"]);
  });
});
