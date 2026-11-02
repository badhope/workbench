import { useCallback, useMemo, useState } from "react";
import { FolderOpen, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { EChart } from "../lib/echarts";
import { chartGapColor, FIXED_COLORS, horizontalBarOption } from "../lib/chartTheme";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  Empty,
  Field,
  Modal,
  SectionTitle,
  Table,
  Td,
  Tr,
  inputCls,
  type Tone,
} from "../ui";
import { shortPath } from "../lib/util";
import { isPieWorthRendering, isProjectRunning } from "../lib/aggregate";
import { useT } from "../lib/i18n";
import type { Project } from "../types";

const STATUS_MAP: Record<string, { tone: Tone; color: string }> = {
  active: { tone: "ok", color: FIXED_COLORS.system },
  paused: { tone: "warn", color: FIXED_COLORS.ai },
  archived: { tone: "dim", color: FIXED_COLORS.other },
};

interface Draft {
  id?: string;
  name: string;
  path: string;
  status: string;
  tags: string;
  pinned: boolean;
  note: string;
}

const emptyDraft: Draft = {
  name: "",
  path: "",
  status: "active",
  tags: "",
  pinned: false,
  note: "",
};

export default function Projects() {
  const t = useT();

  const {
    data,
    devs,
    addProject,
    updateProject,
    deleteProject,
    setView,
    theme,
    openTarget,
  } = useStore(
    useShallow((s) => ({
      data: s.data,
      devs: s.devs,
      addProject: s.addProject,
      updateProject: s.updateProject,
      deleteProject: s.deleteProject,
      setView: s.setView,
      theme: s.theme,
      openTarget: s.openTarget,
    }))
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  const statusLabel = useCallback(
    (s: string) =>
      s === "active"
        ? t("projects.statusActive")
        : s === "paused"
          ? t("projects.statusPaused")
          : s === "archived"
            ? t("projects.statusArchived")
            : s,
    [t]
  );

  const runningDirs = useMemo(() => devs.map((d) => d.project_dir), [devs]);

  const isRunning = (p: Project) => isProjectRunning(p.path, runningDirs);

  const sorted = useMemo(
    () => [...data.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [data.projects]
  );

  // 状态分布数据
  const statusDist = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of data.projects) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return [...m.entries()].map(([s, c]) => ({
      name: statusLabel(s),
      value: c,
      itemStyle: { color: STATUS_MAP[s]?.color ?? "#64748b" },
    }));
  }, [data.projects, statusLabel]);

  // 任务数 Top5 项目
  const taskCountData = useMemo(() => {
    return data.projects
      .map((p) => ({
        name: p.name.length > 10 ? p.name.slice(0, 10) + "…" : p.name,
        count: data.tasks.filter((task) => task.project_id === p.id).length,
      }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [data.projects, data.tasks]);

  const statusPieOption = useMemo(
    () => ({
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      series: [
        {
          id: "status-pie",
          type: "pie",
          radius: ["46%", "68%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: chartGapColor(theme), borderWidth: 2 },
          data: statusDist,
        },
      ],
    }),
    [statusDist, theme]
  );

  const taskBarOption = useMemo(
    () =>
      horizontalBarOption({
        labels: taskCountData.map((d) => d.name),
        values: taskCountData.map((d) => ({ value: d.count, color: "#a78bfa" })),
        theme,
        left: 90,
        fontSize: 9,
        inverse: true,
        barWidth: 12,
      }),
    [taskCountData, theme]
  );

  const submit = () => {
    if (!draft?.name.trim()) return;
    const payload = {
      name: draft.name,
      path: draft.path,
      status: draft.status,
      tags: draft.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      pinned: draft.pinned,
      note: draft.note,
    };
    const accepted = draft.id ? updateProject(draft.id, payload) : addProject(payload);
    if (accepted) setDraft(null);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── 顶部图表 ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <SectionTitle>{t("projects.statusDistTitle")}</SectionTitle>
          {data.projects.length > 0 ? (
            <>
              {isPieWorthRendering(
                (["active", "paused", "archived"] as const).map(
                  (k) =>
                    [k, data.projects.filter((p) => p.status === k).length] as [
                      string,
                      number,
                    ]
                )
              ) && <EChart option={statusPieOption} style={{ height: 140 }} lazyUpdate />}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {Object.entries(STATUS_MAP).map(([k, v]) => {
                  const count = data.projects.filter((p) => p.status === k).length;
                  if (!count) return null;
                  return (
                    <span
                      key={k}
                      className="flex items-center gap-1 text-[11px] text-dim"
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: v.color }}
                      />
                      {statusLabel(k)}{" "}
                      <span className="font-mono text-text">{count}</span>
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <Empty>{t("projects.emptyProjects")}</Empty>
          )}
        </Card>
        <Card className="md:col-span-2">
          <SectionTitle>{t("projects.topTasksTitle")}</SectionTitle>
          {taskCountData.length > 0 ? (
            <EChart option={taskBarOption} style={{ height: 160 }} lazyUpdate />
          ) : (
            <Empty>{t("projects.noLinkedTasks")}</Empty>
          )}
        </Card>
      </div>

      {/* ── 顶部操作 ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-dim">
          {t("projects.totalCount", { count: data.projects.length })}
        </span>
        <Btn
          variant="primary"
          className="ml-auto"
          onClick={() => setDraft({ ...emptyDraft })}
        >
          <Plus size={14} /> {t("projects.new")}
        </Btn>
      </div>

      {data.projects.length === 0 ? (
        <Card>
          {/* 空状态必须给下一步动作：只写「还没有项目」用户得自己找按钮 */}
          <Empty
            action={
              <Btn variant="primary" onClick={() => setDraft({ ...emptyDraft })}>
                <Plus size={13} /> {t("projects.newFirst")}
              </Btn>
            }
          >
            {t("projects.emptyHint", {
              newProject: t("projects.new"),
              running: t("projects.running"),
            })}
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((p) => {
            const st = STATUS_MAP[p.status] ?? STATUS_MAP.active;
            const tasks = data.tasks.filter((task) => task.project_id === p.id);
            const doing = tasks.filter((task) => task.status === "doing").length;
            return (
              <Card key={p.id} className="card-hover flex flex-col gap-2 px-4 py-3.5">
                <div className="flex items-start gap-2">
                  <span className="text-[13px] font-semibold">{p.name}</span>
                  {p.pinned && <Pin size={12} className="mt-1 text-accent" />}
                  <div className="ml-auto flex gap-1">
                    <Badge tone={st.tone}>{statusLabel(p.status)}</Badge>
                    {isRunning(p) && <Badge tone="ok">{t("projects.running")}</Badge>}
                  </div>
                </div>
                <div className="truncate font-mono text-[11px] text-dim" title={p.path}>
                  {p.path ? shortPath(p.path, 60) : t("projects.unboundPath")}
                </div>
                {p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((tag) => (
                      <Badge key={tag} tone="dim">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-dim">
                  <button
                    className="text-accent hover:underline"
                    onClick={() => setView("tasks")}
                  >
                    {t("projects.taskCount", { count: tasks.length })}
                  </button>
                  {doing > 0 && (
                    <Badge tone="accent">
                      {t("projects.doingCount", { count: doing })}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex gap-1.5 border-t border-line/60 pt-2">
                  {p.path && (
                    <Btn
                      className="!px-2 !py-1 !text-xs"
                      title={t("projects.openDir")}
                      onClick={() => openTarget(p.path)}
                    >
                      <FolderOpen size={12} />
                    </Btn>
                  )}
                  <Btn
                    className="!px-2 !py-1 !text-xs"
                    title={t("projects.edit")}
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        name: p.name,
                        path: p.path,
                        status: p.status,
                        tags: p.tags.join(", "),
                        pinned: p.pinned,
                        note: p.note,
                      })
                    }
                  >
                    <Pencil size={12} />
                  </Btn>
                  <Btn
                    variant="danger"
                    className="!px-2 !py-1 !text-xs"
                    title={t("projects.deleteTitle")}
                    onClick={() => setPendingDelete(p)}
                  >
                    <Trash2 size={12} />
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="">
        <h3 className="mb-2 text-sm font-medium">{t("projects.tableView")}</h3>
        <Table
          head={[
            t("projects.colProject"),
            t("projects.status"),
            t("projects.colPath"),
            t("projects.colTasks"),
            t("projects.running"),
          ]}
        >
          {sorted.map((p) => (
            <Tr key={p.id}>
              <Td className="font-medium">{p.name}</Td>
              <Td>
                <Badge tone={STATUS_MAP[p.status]?.tone ?? "dim"}>
                  {statusLabel(p.status)}
                </Badge>
              </Td>
              <Td
                className="max-w-[280px] truncate font-mono text-[11px] text-dim"
                title={p.path}
              >
                {p.path || "-"}
              </Td>
              <Td className="text-xs text-dim">
                {data.tasks.filter((task) => task.project_id === p.id).length}
              </Td>
              <Td>
                {isRunning(p) ? (
                  <Badge tone="ok">{t("projects.yes")}</Badge>
                ) : (
                  <Badge tone="dim">{t("projects.no")}</Badge>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      </Card>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t("projects.deleteTitle")}
        body={t("projects.deleteConfirm", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("projects.deleteAction")}
        cancelLabel={t("projects.cancel")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteProject(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      <Modal
        open={!!draft}
        title={draft?.id ? t("projects.editTitle") : t("projects.new")}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Btn onClick={() => setDraft(null)}>{t("projects.cancel")}</Btn>
            <Btn variant="primary" onClick={submit}>
              {t("projects.save")}
            </Btn>
          </>
        }
      >
        {draft && (
          <>
            <Field label={t("projects.fieldName")}>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("projects.placeholderName")}
              />
            </Field>
            <Field label={t("projects.fieldPath")}>
              <input
                className={inputCls}
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                placeholder="C:\proj\shop-web"
              />
            </Field>
            <Field label={t("projects.status")}>
              <select
                className={inputCls}
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="active">{t("projects.statusActive")}</option>
                <option value="paused">{t("projects.statusPaused")}</option>
                <option value="archived">{t("projects.statusArchived")}</option>
              </select>
            </Field>
            <Field label={t("projects.fieldTags")}>
              <input
                className={inputCls}
                value={draft.tags}
                onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
                placeholder={t("projects.placeholderTags")}
              />
            </Field>
            <Field label={t("projects.fieldNote")}>
              <textarea
                className={inputCls}
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              {t("projects.pinLabel")}
            </label>
          </>
        )}
      </Modal>
    </div>
  );
}
