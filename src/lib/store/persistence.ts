import { loadDataVersioned, saveData } from "../api";
import { notifyDataChanged } from "../dataSync";
import type { WorkbenchData } from "../../types";
import { SAVE_DEBOUNCE_MS } from "./helpers";

export interface LoadTicket {
  loadSequence: number;
  editSequence: number;
  generation: string | null;
}

export interface Persistence {
  isRestoring(): boolean;
  begin(): void;
  end(): void;
  isBlocked(): boolean;
  setBlocked(v: boolean): void;
  isDirty(): boolean;
  markDirty(): void;
  markClean(): void;
  /** 递增加载序号并记录当前编辑/版本，用于判断异步快照是否已过期。 */
  capture(): LoadTicket;
  isCurrent(t: LoadTicket): boolean;
  bumpEdit(): number;
  currentEdit(): number;
  generation(): string | null;
  setGeneration(g: string | null): void;
  clearTimer(): void;
  /** 只等在途写入结束，不主动冲刷 pendingData。 */
  waitForQueue(): Promise<void>;
  /** 清掉防抖窗口里的待写数据并立刻入队；失败时放回 pendingData。 */
  flush(): Promise<void>;
  /** 防抖保存：schedule 自身负责标记 dirty 与递增编辑序号。 */
  schedule(data: WorkbenchData, onError: (e: unknown) => void): void;
  saveNow(data: WorkbenchData): Promise<void>;
  load(): Promise<{ data: WorkbenchData; generation: string }>;
  /** 丢弃待写数据并把版本标干净（discard 成功路径）。 */
  discardPending(): void;
  /** 丢弃失败后，把仍在内存的待写数据重新排一次防抖保存。 */
  reschedule(onError: (e: unknown) => void): void;
}

let active: Persistence | null = null;

export function createPersistence(): Persistence {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingData: WorkbenchData | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  let restoring = false;
  let blocked = true;
  let generation: string | null = null;
  let loadSequence = 0;
  let editSequence = 0;
  let dirty = false;

  function enqueue(data: WorkbenchData): Promise<void> {
    const editAtQueue = editSequence;
    const save = saveQueue
      .catch(() => undefined)
      .then(async () => {
        if (generation === null) throw new Error("数据尚未加载");
        generation = await saveData(data, generation);
        if (editAtQueue === editSequence) dirty = false;
        // 落盘成功后再通知其他窗口，避免对方在 debounce 写入前读到旧快照。
        notifyDataChanged();
      });
    saveQueue = save;
    return save;
  }

  function armedSave(editAtArm: number, onError: (e: unknown) => void): void {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const next = pendingData;
      pendingData = null;
      if (!next) return;
      void enqueue(next).catch((e) => {
        if (editAtArm === editSequence && !pendingData) pendingData = next;
        onError(e);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  const persistence: Persistence = {
    isRestoring: () => restoring,
    begin: () => {
      restoring = true;
    },
    end: () => {
      restoring = false;
    },
    isBlocked: () => blocked,
    setBlocked: (v) => {
      blocked = v;
    },
    isDirty: () => dirty,
    markDirty: () => {
      dirty = true;
    },
    markClean: () => {
      dirty = false;
    },
    capture: () => {
      loadSequence += 1;
      return {
        loadSequence,
        editSequence,
        generation,
      };
    },
    isCurrent: (t) =>
      t.loadSequence === loadSequence &&
      t.editSequence === editSequence &&
      t.generation === generation,
    bumpEdit: () => {
      editSequence += 1;
      return editSequence;
    },
    currentEdit: () => editSequence,
    generation: () => generation,
    setGeneration: (g) => {
      generation = g;
    },
    clearTimer: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
    },
    waitForQueue: () => saveQueue.catch(() => undefined),
    flush: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // 必须先等在途保存结束：没有 pendingData 不等于没有写入正在进行。
      await persistence.waitForQueue();
      const data = pendingData;
      if (!data) return;
      pendingData = null;
      try {
        await enqueue(data);
      } catch (error) {
        pendingData = data;
        throw error;
      }
    },
    schedule: (data, onError) => {
      if (saveTimer) clearTimeout(saveTimer);
      pendingData = data;
      dirty = true;
      armedSave(++editSequence, onError);
    },
    saveNow: (data) => enqueue(data),
    load: async () => {
      const snapshot = await loadDataVersioned();
      return { data: snapshot.data, generation: snapshot.generation };
    },
    discardPending: () => {
      pendingData = null;
      dirty = false;
      editSequence += 1;
    },
    reschedule: (onError) => {
      const data = pendingData;
      if (!data || blocked) return;
      armedSave(editSequence, onError);
    },
  };

  active = persistence;
  return persistence;
}

export function activePersistence(): Persistence {
  if (!active) throw new Error("store 尚未初始化");
  return active;
}
