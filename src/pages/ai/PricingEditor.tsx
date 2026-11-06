import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { getPricing, isBackend, savePricing } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { Badge, Btn, Card, Field, SectionTitle, inputCls } from "../../ui";
import type { PricingRow, PricingView } from "../../types";

/**
 * 定价覆盖编辑器。
 *
 * 之前这张表只能手工放 `pricing_overrides.json`，界面上完全不可见——
 * 于是「模型价格可自定义」是一个只有文档知道的功能。现在：
 * - 内置型号全量列出（可搜索），显示当前内置价与是否已覆盖；
 * - 可就地编辑任一型号的输入/输出单价；
 * - 可新增内置表里没有的型号；
 * - 可逐条恢复内置价 / 全部清空；
 * - 保存前整表校验：任一条非法就整体拒绝，并把原因显示出来。
 *
 * 为什么整表校验而不是逐条跳过：价格直接影响账单。部分成功会让界面显示的
 * 价格与磁盘上的不一致，用户无法判断到底哪条生效了。
 */
export function PricingEditor({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  const [view, setView] = useState<PricingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<
    Record<string, { input: string; output: string }>
  >({});
  const [newModel, setNewModel] = useState({ model: "", input: "", output: "" });
  const [saving, setSaving] = useState(false);

  // 所有 setState 都落在 await 之后（微任务里），不在渲染/同步 effect 路径上。
  const load = useCallback(async () => {
    if (!isBackend()) return;
    try {
      const next = await getPricing();
      setView(next);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 拉取是外部系统同步：setState 在 await 之后，不会触发级联渲染。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上
    void load();
  }, [load]);

  const rows = useMemo(() => view?.rows ?? [], [view]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.model.toLowerCase().includes(q));
  }, [rows, query]);

  const overrides = useMemo(() => {
    const out: Record<string, [number, number]> = {};
    for (const r of rows) {
      if (r.override_input !== null && r.override_output !== null) {
        out[r.model] = [r.override_input, r.override_output];
      }
    }
    // 正在编辑但还没保存的行也要带上：保存是「整表替换」，
    // 否则用户改了 A 再点保存，A 不会生效。
    for (const [model, draft] of Object.entries(editing)) {
      const i = Number(draft.input);
      const o = Number(draft.output);
      if (
        draft.input !== "" &&
        draft.output !== "" &&
        Number.isFinite(i) &&
        Number.isFinite(o)
      ) {
        out[model] = [i, o];
      }
    }
    return out;
  }, [rows, editing]);

  const dirty = Object.keys(editing).length > 0;

  const startEdit = (r: PricingRow) => {
    setEditing((d) => ({
      ...d,
      [r.model]: {
        input: String(r.override_input ?? r.builtin_input ?? ""),
        output: String(r.override_output ?? r.builtin_output ?? ""),
      },
    }));
  };

  const patchEdit = (model: string, patch: Partial<{ input: string; output: string }>) =>
    setEditing((d) => ({ ...d, [model]: { ...d[model], ...patch } }));

  const cancelEdit = (model: string) =>
    setEditing((d) => {
      const next = { ...d };
      delete next[model];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const next = await savePricing(overrides);
      setView(next);
      setEditing({});
      onChanged?.();
    } catch (e) {
      // 后端把每条非法原因拼在一条消息里，原样展示便于逐条修
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetOne = (model: string) => {
    const r = rows.find((x) => x.model === model);
    if (!r) return;
    setEditing((d) => ({ ...d, [model]: { input: "", output: "" } }));
    void savePricing(
      Object.fromEntries(
        Object.entries(overrides).filter(([k]) => k !== model)
      ) as Record<string, [number, number]>
    )
      .then((next) => {
        setView(next);
        setEditing((d) => {
          const n = { ...d };
          delete n[model];
          return n;
        });
        onChanged?.();
      })
      .catch((e) => setError(String(e)));
  };

  const addModel = () => {
    const model = newModel.model.trim().toLowerCase();
    if (!model) return;
    setEditing((d) => ({
      ...d,
      [model]: { input: newModel.input, output: newModel.output },
    }));
    setNewModel({ model: "", input: "", output: "" });
    setQuery(model);
  };

  if (!isBackend()) {
    return (
      <Card>
        <SectionTitle>{t("pricing.title")}</SectionTitle>
        <p className="text-[11.5px] leading-relaxed text-faint">
          {t("pricing.desktopOnly")}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle
        extra={
          <div className="flex items-center gap-1.5">
            {dirty && <Badge tone="warn">{t("pricing.unsaved")}</Badge>}
            <Btn
              className="!px-2 !py-1 !text-[11px]"
              onClick={() => void load()}
              disabled={loading}
            >
              {t("pricing.reload")}
            </Btn>
            <Btn
              variant="primary"
              className="!px-2 !py-1 !text-[11px]"
              onClick={() => void save()}
              disabled={saving}
            >
              <Check size={11} /> {t("pricing.save")}
            </Btn>
          </div>
        }
      >
        {t("pricing.title")}
      </SectionTitle>

      <p className="mb-2 text-[11px] leading-relaxed text-dim">{t("pricing.hint")}</p>

      {error && (
        <div className="mb-2 rounded-[var(--radius-btn)] border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {error}
        </div>
      )}
      {view && view.problems.length > 0 && (
        <div className="mb-2 rounded-[var(--radius-btn)] border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11px] text-warn">
          <div className="font-medium">{t("pricing.problems")}</div>
          <ul className="mt-1 list-disc pl-4">
            {view.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <input
          className={`${inputCls} max-w-[220px]`}
          placeholder={t("pricing.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="num text-[10.5px] text-faint">
          {t("pricing.count", { shown: filtered.length, total: rows.length })}
        </span>
      </div>

      <div className="max-h-[340px] overflow-auto rounded-[var(--radius-btn)] border border-line/70">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line/80 text-left">
              {[
                t("pricing.colModel"),
                t("pricing.colInput"),
                t("pricing.colOutput"),
                t("pricing.colSource"),
                "",
              ].map((h, i) => (
                <th
                  key={i}
                  className="col-head whitespace-nowrap px-2 py-1.5 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <PriceRow
                key={r.model}
                row={r}
                draft={editing[r.model]}
                onPatch={patchEdit}
                onStart={startEdit}
                onCancel={cancelEdit}
                onReset={resetOne}
                onSave={save}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
        <Field label={t("pricing.newModel")}>
          <input
            className={inputCls}
            value={newModel.model}
            placeholder="my-model-v2"
            onChange={(e) => setNewModel((n) => ({ ...n, model: e.target.value }))}
          />
        </Field>
        <Field label={t("pricing.colInput")}>
          <input
            className={inputCls}
            value={newModel.input}
            inputMode="decimal"
            placeholder="3.00"
            onChange={(e) => setNewModel((n) => ({ ...n, input: e.target.value }))}
          />
        </Field>
        <Field label={t("pricing.colOutput")}>
          <input
            className={inputCls}
            value={newModel.output}
            inputMode="decimal"
            placeholder="15.00"
            onChange={(e) => setNewModel((n) => ({ ...n, output: e.target.value }))}
          />
        </Field>
        <div className="flex items-end">
          <Btn
            className="w-full justify-center"
            onClick={addModel}
            disabled={!newModel.model.trim()}
          >
            <Plus size={12} /> {t("pricing.add")}
          </Btn>
        </div>
      </div>

      {view && (
        <p className="mt-2 break-all font-mono text-[10px] text-faint">
          {t("pricing.path", { path: view.path })}
        </p>
      )}
    </Card>
  );
}

/** 一行价格：内置价 / 覆盖价 / 编辑态，右侧是编辑、重置、应用、取消。 */
function PriceRow({
  row: r,
  draft,
  onPatch,
  onStart,
  onCancel,
  onReset,
  onSave,
}: {
  row: PricingRow;
  draft: { input: string; output: string } | undefined;
  onPatch: (model: string, patch: { input?: string; output?: string }) => void;
  onStart: (row: PricingRow) => void;
  onCancel: (model: string) => void;
  onReset: (model: string) => void;
  onSave: () => void;
}) {
  const overridden = r.override_input !== null;
  return (
    <tr className="border-b border-line/40">
      <td className="px-2 py-1 font-mono text-[11px]">{r.model}</td>
      <PriceCell
        value={draft ? Number(draft.input) : (r.override_input ?? r.builtin_input)}
        editing={Boolean(draft)}
        onChange={(v) => onPatch(r.model, { input: v })}
      />
      <PriceCell
        value={draft ? Number(draft.output) : (r.override_output ?? r.builtin_output)}
        editing={Boolean(draft)}
        onChange={(v) => onPatch(r.model, { output: v })}
      />
      <td className="px-2 py-1">
        <PriceStatus
          draft={Boolean(draft)}
          overridden={overridden}
          known={r.builtin_input !== null}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right">
        {draft ? (
          <EditingActions onCancel={() => onCancel(r.model)} onSave={onSave} />
        ) : (
          <RowActions
            onEdit={() => onStart(r)}
            onReset={overridden ? () => onReset(r.model) : undefined}
          />
        )}
      </td>
    </tr>
  );
}

/** 单价单元格：编辑态是输入框，否则是保留两位的数字。 */
function PriceCell({
  value,
  editing,
  onChange,
}: {
  value: number | null;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  if (editing) {
    return (
      <td className="px-2 py-1">
        <input
          className="w-20 rounded border border-line bg-panel2 px-1.5 py-0.5 text-right font-mono text-[11px] outline-none focus:border-accent"
          value={Number.isFinite(value) ? String(value) : ""}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
        />
      </td>
    );
  }
  return (
    <td className="px-2 py-1">
      <span className="num">{value?.toFixed(2) ?? "—"}</span>
    </td>
  );
}

/** 状态徽章：编辑中 / 已覆盖 / 内置 / 未知（无价格）。 */
function PriceStatus({
  draft,
  overridden,
  known,
}: {
  draft: boolean;
  overridden: boolean;
  known: boolean;
}) {
  const t = useT();
  if (draft) return <Badge tone="warn">{t("pricing.editing")}</Badge>;
  if (overridden) return <Badge tone="accent">{t("pricing.overridden")}</Badge>;
  if (known) return <Badge tone="dim">{t("pricing.builtin")}</Badge>;
  return <Badge tone="danger">{t("pricing.unknown")}</Badge>;
}

function EditingActions({
  onSave,
  onCancel,
}: {
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <>
      <button
        className="rounded p-1 text-faint hover:text-text"
        title={t("pricing.cancel")}
        onClick={onCancel}
      >
        <X size={11} />
      </button>
      <button
        className="rounded p-1 text-ok hover:text-text"
        title={t("pricing.apply")}
        onClick={onSave}
      >
        <Check size={11} />
      </button>
    </>
  );
}

function RowActions({ onEdit, onReset }: { onEdit: () => void; onReset?: () => void }) {
  const t = useT();
  return (
    <>
      <button
        className="rounded p-1 text-faint hover:text-text"
        title={t("pricing.edit")}
        onClick={onEdit}
      >
        <Pencil size={11} />
      </button>
      {onReset && (
        <button
          className="rounded p-1 text-faint hover:text-warn"
          title={t("pricing.resetOne")}
          onClick={onReset}
        >
          <RotateCcw size={11} />
        </button>
      )}
    </>
  );
}
