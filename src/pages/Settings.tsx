import { useEffect, useRef, useState } from "react";
import { DollarSign, Download, Eraser, RefreshCw, Upload } from "lucide-react";
import { useStore } from "../lib/store";
import { useTransportMode } from "../lib/useAppRuntime";
import { useShallow } from "zustand/react/shallow";
import { isBackend, isTauri } from "../lib/api";

import { APP_VERSION, setLang, useLang, useT, type Lang } from "../lib/i18n";
import { Badge, Btn, Card, ConfirmDialog, Field, Modal, SectionTitle, inputCls } from "../ui";
import { AppearancePanel } from "../components/AppearancePanel";
import { AutostartCard } from "../components/AutostartCard";
import { BackupPanel } from "../components/BackupPanel";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { WorkModeChoices } from "../components/WorkModeChoices";
import { WORK_MODES, type WorkMode } from "../lib/workModes";
import { formatUsd } from "../lib/util";
import type { CostSettings, WorkbenchData } from "../types";

// ════════════════════════════════════════════════════════════
// 自定义 Hook: 成本设置的本地编辑状态
// ════════════════════════════════════════════════════════════
function useCostSettingsEditor(current: CostSettings) {
  const [draft, setDraft] = useState<CostSettings>(current);
  const [dirty, setDirty] = useState(false);
  // 「渲染期派生状态」：记住上一次同步所依据的服务端值，只有它真正变化时
  // 才覆盖草稿（React 官方推荐模式）。用 state 而非 ref 是因为这里要在
  // 渲染期读写，React 要求渲染期状态变更必须走 setState 才能触发重渲染。
  const [synced, setSynced] = useState(current);

  if (synced !== current) {
    setSynced(current);
    setDraft(current);
    setDirty(false);
  }

  const update = (patch: Partial<CostSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  return { draft, dirty, update, setDirty };
}

// ════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════

const REFRESH_OPTIONS = [
  { ms: 1000, key: "settings.refresh1s" },
  { ms: 3000, key: "settings.refresh3s" },
  { ms: 5000, key: "settings.refresh5s" },
  { ms: 10000, key: "settings.refresh10s" },
  { ms: 30000, key: "settings.refresh30s" },
];

const ALERT_OPTIONS = [
  { value: 50, key: "settings.alert50" },
  { value: 70, key: "settings.alert70" },
  { value: 80, key: "settings.alert80" },
  { value: 90, key: "settings.alert90" },
  { value: 100, key: "settings.alert100" },
];

const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
  { code: "ja", label: "日本語" },
];

export default function Settings() {
  const t = useT();
  const lang = useLang();
  const workModes = useStore((s) => s.workModes);
  const setWorkModes = useStore((s) => s.setWorkModes);
  const [modeOpen, setModeOpen] = useState(false);
  const [modeDraft, setModeDraft] = useState<WorkMode[]>(workModes);
  const {
    refreshMs,
    setRefreshMs,
    data,
    persistDataNow,
    discardUnsavedAndReload,
    setToast,
    refreshRuntime,
    // 成本
    costSettings,
    loadCostSettings,
    updateCostSettings,
    costOverview,
  } = useStore(
    useShallow((s) => ({
      refreshMs: s.refreshMs,
      setRefreshMs: s.setRefreshMs,
      data: s.data,
      persistDataNow: s.persistDataNow,
      discardUnsavedAndReload: s.discardUnsavedAndReload,
      setToast: s.setToast,
      refreshRuntime: s.refreshRuntime,
      costSettings: s.costSettings,
      loadCostSettings: s.loadCostSettings,
      updateCostSettings: s.updateCostSettings,
      costOverview: s.costOverview,
    }))
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const {
    draft: costDraft,
    dirty: costDirty,
    update: updateCost,
    setDirty: setCostDirty,
  } = useCostSettingsEditor(costSettings);

  useEffect(() => {
    void loadCostSettings();
  }, [loadCostSettings]);

  // ── 导入 / 导出 ──
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(t("settings.exported"));
  };

  const importJson = async (file: File) => {
    try {
      const parsed = parseBackup(await file.text(), t);
      if (!(await persistDataNow(parsed))) return;
      setToast(
        t("settings.imported", {
          projects: parsed.projects.length,
          tasks: parsed.tasks.length,
        })
      );
    } catch (e) {
      setToast(t("settings.importFailed", { err: String(e) }));
    }
  };

  const saveCostConfig = async () => {
    // 只有真正落盘成功才清掉「未保存」标记：保存失败的草稿必须继续显示为待保存，
    // 否则用户关掉页面就以为已经生效了。
    const ok = await updateCostSettings(costDraft);
    if (ok) setCostDirty(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── 页面标题（与其他页头部呼应） ── */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold">{t("settings.pageTitle")}</h2>
        <span className="text-xs text-dim">{t("settings.pageSub")}</span>
      </div>

      <Card>
        <SectionTitle
          extra={
            <Btn
              onClick={() => {
                setModeDraft(workModes);
                setModeOpen(true);
              }}
            >
              {t("workMode.change")}
            </Btn>
          }
        >
          {t("workMode.title")}
        </SectionTitle>
        {workModes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {workModes.map((id) => {
              const mode = WORK_MODES.find((m) => m.id === id);
              if (!mode) return null;
              return (
                <Badge key={id} tone="accent">
                  {t(mode.labelKey)}
                </Badge>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-warn">{t("workMode.none")}</p>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("workMode.settingsHint")}
        </p>
      </Card>

      <AppearancePanel />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* 左列：语言、成本计量 */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ── 语言 ── */}
          <Card>
            <SectionTitle>{t("settings.language")}</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {LANG_OPTIONS.map((o) => (
                <Btn
                  key={o.code}
                  variant={lang === o.code ? "primary" : "ghost"}
                  onClick={() => setLang(o.code)}
                >
                  {o.label}
                </Btn>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              {t("settings.languageHint")}
            </p>
          </Card>

          {/* ── ⚡ 成本计量（新增主 section）── */}
          <Card className="">
            <SectionTitle
              extra={costDirty && <Badge tone="warn">{t("settings.unsaved")}</Badge>}
            >
              <span className="flex items-center gap-1.5">
                <DollarSign size={14} />
                {t("settings.cost")}
              </span>
            </SectionTitle>

            <div className="flex flex-col gap-4">
              {/* 预算设置 */}
              <div>
                <div className="mb-2 text-xs font-medium text-dim">
                  {t("settings.budgetLabel")}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-dim">
                      {t("settings.dailyBudget")}
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className={inputCls}
                      value={costDraft.daily_budget}
                      onChange={(e) =>
                        updateCost({
                          daily_budget: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-dim">
                      {t("settings.monthlyBudget")}
                    </span>
                    <input
                      type="number"
                      step="5"
                      min="0"
                      className={inputCls}
                      value={costDraft.monthly_budget}
                      onChange={(e) =>
                        updateCost({
                          monthly_budget: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                    />
                  </label>
                </div>
              </div>

              {/* 告警阈值 */}
              <Field label={t("settings.alertLabel")}>
                <div className="flex flex-wrap gap-2">
                  {ALERT_OPTIONS.map((o) => (
                    <Btn
                      key={o.value}
                      variant={
                        costDraft.alert_threshold_pct === o.value ? "primary" : "ghost"
                      }
                      onClick={() => updateCost({ alert_threshold_pct: o.value })}
                    >
                      {t(o.key)}
                    </Btn>
                  ))}
                </div>
              </Field>

              {/* 计价偏好 */}
              <Field label={t("settings.pricingLabel")}>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={costDraft.include_estimated}
                      onChange={(e) =>
                        updateCost({ include_estimated: e.target.checked })
                      }
                      className="rounded border-line accent-accent"
                    />
                    <span>{t("settings.includeEstimated")}</span>
                  </label>
                </div>
              </Field>

              {/* 当前状态展示 */}
              {costOverview && (
                <div className="rounded-[var(--radius-btn)] border border-line/80 bg-panel2/50 p-3">
                  <div className="mb-2 text-xs font-medium text-dim">
                    {t("settings.statusTitle")}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                    <div>
                      <div className="text-dim">{t("settings.recordCount")}</div>
                      <div className="font-mono font-medium">
                        {costOverview.record_count}
                      </div>
                    </div>
                    <div>
                      <div className="text-dim">{t("settings.measuredEstimated")}</div>
                      <div className="font-mono font-medium">
                        {costOverview.measured_count} / {costOverview.estimated_count}
                      </div>
                    </div>
                    <div>
                      <div className="text-dim">{t("settings.totalCost")}</div>
                      <div className="font-mono font-medium">
                        {formatUsd(costOverview.total_cost)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex gap-2">
                <Btn variant="primary" onClick={saveCostConfig} disabled={!costDirty}>
                  <RefreshCw size={14} /> {t("settings.applyCost")}
                </Btn>
                <Btn
                  onClick={() =>
                    updateCost({
                      daily_budget: 5,
                      monthly_budget: 50,
                      alert_threshold_pct: 80,
                      include_estimated: true,
                    })
                  }
                >
                  <Eraser size={14} /> {t("settings.restoreDefaults")}
                </Btn>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              {t("settings.costNote")}
            </p>
          </Card>
        </div>

        {/* 右列：运行时刷新、数据与备份 */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* ── 刷新 ── */}
          <Card className="">
            <SectionTitle>{t("settings.refresh")}</SectionTitle>
            <Field label={t("settings.refreshLabel")}>
              <div className="flex flex-wrap gap-2">
                {REFRESH_OPTIONS.map((o) => (
                  <Btn
                    key={o.ms}
                    variant={refreshMs === o.ms ? "primary" : "ghost"}
                    onClick={() => {
                      setRefreshMs(o.ms);
                      refreshRuntime();
                    }}
                  >
                    {t(o.key)}
                  </Btn>
                ))}
              </div>
            </Field>
            <p className="text-[11px] leading-relaxed text-dim">
              {t("settings.refreshHint")}
            </p>
          </Card>
          <AutostartCard />
          {/* ── 数据：导出/导入 + 备份恢复，同一列纵向排列 ── */}
          <div className="flex flex-col gap-4">
            <Card>
              <SectionTitle>{t("settings.data")}</SectionTitle>
              <div className="flex flex-wrap gap-2">
                <Btn onClick={exportJson}>
                  <Download size={14} /> {t("settings.exportJson")}
                </Btn>
                <Btn onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> {t("settings.importJson")}
                </Btn>
                {isTauri() && (
                  <Btn onClick={() => setConfirmReload(true)}>
                    {lang === "zh"
                      ? "放弃未保存更改并重新加载"
                      : lang === "ja"
                        ? "未保存の変更を破棄して再読込"
                        : "Discard unsaved changes and reload"}
                  </Btn>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  aria-label={t("settings.importJson")}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importJson(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-dim">
                {t("settings.dataLocation")}:
                {isTauri() ? (
                  <>
                    {" "}
                    {t("settings.dataDesktop")}{" "}
                    <span className="font-mono">
                      %APPDATA%\com.workbench.desktop\data.json
                    </span>
                    {t("settings.dataLocalNote")}
                  </>
                ) : (
                  <> {t("settings.dataBrowserNote")}</>
                )}
              </p>
            </Card>
            <BackupPanel />
            {isBackend() && <DiagnosticsPanel />}
          </div>{" "}
        </div>
      </div>

      <Modal
        open={modeOpen}
        title={t("workMode.title")}
        onClose={() => setModeOpen(false)}
        wide
        footer={
          <>
            <Btn onClick={() => setModeOpen(false)}>{t("projects.cancel")}</Btn>
            <Btn
              variant="primary"
              disabled={modeDraft.length === 0}
              onClick={() => {
                setWorkModes(modeDraft);
                setModeOpen(false);
              }}
            >
              {t("projects.save")}
            </Btn>
          </>
        }
      >
        <p className="mb-3 text-[12px] leading-relaxed text-dim">{t("workMode.body")}</p>
        <WorkModeChoices value={modeDraft} onChange={setModeDraft} />
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          {t("workMode.settingsHint")}
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmReload}
        title={
          lang === "zh"
            ? "放弃未保存更改？"
            : lang === "ja"
              ? "未保存の変更を破棄しますか？"
              : "Discard unsaved changes?"
        }
        body={
          lang === "zh"
            ? "未保存的项目和任务将被丢弃。请先导出 JSON 备份，再确认重新加载磁盘数据。"
            : lang === "ja"
              ? "未保存のプロジェクトとタスクは失われます。先に JSON をエクスポートしてください。"
              : "Unsaved projects and tasks will be discarded. Export JSON first, then reload disk data."
        }
        confirmLabel={
          lang === "zh"
            ? "放弃并重新加载"
            : lang === "ja"
              ? "破棄して再読込"
              : "Discard and reload"
        }
        cancelLabel={t("settings.restoreCancel")}
        danger
        onCancel={() => setConfirmReload(false)}
        onConfirm={() => {
          setConfirmReload(false);
          void discardUnsavedAndReload().catch((error) => setToast(String(error)));
        }}
      />
      {/* ── 关于 ── */}
      <Card className="">
        <SectionTitle>{t("settings.about")}</SectionTitle>
        <div className="flex flex-col gap-1.5 text-xs text-dim">
          <div className="flex items-center gap-2">
            {t("settings.version")} <Badge tone="dim">v{APP_VERSION}</Badge>
            {t("settings.mode")} <ModeBadge />
          </div>
          <p>{t("settings.aboutNote")}</p>
          <p className="text-warn">{t("settings.killWarning")}</p>
        </div>
      </Card>
    </div>
  );
}

/**
 * 导入的 JSON 来自外部，必须整份校验后再落库。
 *
 * 「只检查顶层两个数组」是不够的：缺 id 的项目会让列表 key 变成 undefined，
 * 非法状态的任务会从看板上消失（三列里都不匹配）。这里逐字段校验，
 * 任一不合规就整份拒绝，并给出具体原因。
 */
function parseBackup(text: string, t: (key: string) => string): WorkbenchData {
  const parsed = JSON.parse(text) as WorkbenchData;
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) {
    throw new Error(t("settings.importBadStructure"));
  }
  const stringArray = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  const uint = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  for (const p of parsed.projects) {
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      typeof p.path !== "string" ||
      typeof p.status !== "string" ||
      !stringArray(p.tags) ||
      typeof p.pinned !== "boolean" ||
      typeof p.note !== "string" ||
      !uint(p.created_at)
    ) {
      throw new Error(t("settings.importBadProject"));
    }
  }
  for (const task of parsed.tasks) {
    if (
      !task ||
      typeof task.id !== "string" ||
      typeof task.title !== "string" ||
      typeof task.priority !== "string" ||
      !stringArray(task.tags) ||
      !uint(task.created_at) ||
      !uint(task.updated_at) ||
      (task.due !== null && task.due !== undefined && typeof task.due !== "string") ||
      (task.project_id !== null &&
        task.project_id !== undefined &&
        typeof task.project_id !== "string")
    ) {
      throw new Error(t("settings.importBadTask"));
    }
    if (!["todo", "doing", "done"].includes(task.status)) {
      throw new Error(t("settings.importBadStatus"));
    }
  }
  return parsed;
}

/** 运行模式徽章：三态（桌面 / Web 后端 / 静态演示）。 */
function ModeBadge() {
  const t = useT();
  const mode = useTransportMode();
  const label =
    mode === "tauri"
      ? t("settings.modeTauri")
      : mode === "http"
        ? t("settings.modeWeb")
        : t("settings.modeBrowser");
  return <Badge tone={mode === "demo" ? "warn" : "ok"}>{label}</Badge>;
}
