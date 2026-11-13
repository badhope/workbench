import { useCallback, useEffect, useState } from "react";
import { Archive, FolderOpen, History, RotateCcw } from "lucide-react";
import { isTauri, listBackups, openBackupDir } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { Badge, Btn, Card, ConfirmDialog, SectionTitle } from "../ui";
import type { BackupPoint } from "../types";

/**
 * 数据备份与恢复。
 *
 * 之前只有「导出 JSON」（仅项目/任务）一个出口，成本数据完全没有备份路径，
 * 而「清空成本记录」是不可逆的。这里补上：
 * - 一键备份三份数据文件；
 * - 列出历史备份点（带时间与文件清单）；
 * - 从任意备份点恢复，**恢复前自动生成一个回退点**。
 *
 * 恢复用 ConfirmDialog 而不是直接执行：它会覆盖当前数据，
 * 与「终止进程」同级，必须二次确认。
 */
export function BackupPanel() {
  const t = useT();
  const restoreData = useStore((state) => state.restoreData);
  const backupCurrentData = useStore((state) => state.backupCurrentData);
  const [points, setPoints] = useState<BackupPoint[] | null>(null);
  const [status, setStatus] = useState({ text: "", ok: false });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BackupPoint | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const list = await listBackups();
      setPoints(list);
      setStatus({ text: "", ok: false });
    } catch (e) {
      setStatus({ text: String(e), ok: false });
      setPoints([]);
    }
  }, []);

  useEffect(() => {
    // setState 落在 await 之后，不在同步渲染路径上
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上
    void refresh();
  }, [refresh]);

  if (!isTauri()) {
    return (
      <Card>
        <SectionTitle>{t("settings.backupSection")}</SectionTitle>
        <p className="text-[11.5px] leading-relaxed text-faint">
          {t("settings.backupDesktopOnly")}
        </p>
      </Card>
    );
  }

  const doBackup = async () => {
    setBusy(true);
    try {
      const r = await backupCurrentData();
      setStatus({ text: "", ok: false });
      await refresh();
      return r;
    } catch (e) {
      setStatus({ text: String(e), ok: false });
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <SectionTitle
          extra={
            <div className="flex items-center gap-1.5">
              <Btn
                className="!px-2 !py-1 !text-[11px]"
                onClick={() => void openBackupDir().catch((e) => setStatus({ text: String(e), ok: false }))}
              >
                <FolderOpen size={11} /> {t("settings.openBackup")}
              </Btn>
              <Btn
                variant="primary"
                className="!px-2 !py-1 !text-[11px]"
                disabled={busy}
                onClick={() => void doBackup()}
              >
                <Archive size={11} /> {t("settings.backup")}
              </Btn>
            </div>
          }
        >
          {t("settings.backupSection")}
        </SectionTitle>

        <p className="mb-2 text-[11px] leading-relaxed text-dim">
          {t("settings.backupHint")}
        </p>

        {status.text && (
          <div
            role="status"
            className={`mb-2 rounded-[var(--radius-btn)] border px-2.5 py-1.5 text-[11px] ${
              status.ok
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}
          >
            {status.text}
          </div>
        )}

        {points === null ? (
          <p className="text-[11.5px] text-faint">{t("settings.backupLoading")}</p>
        ) : points.length === 0 ? (
          <p className="text-[11.5px] text-faint">{t("settings.backupEmpty")}</p>
        ) : (
          <ul className="flex max-h-[220px] flex-col gap-1 overflow-y-auto">
            {points.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--radius-btn)] border border-line/70 bg-panel2/40 px-2.5 py-1.5"
              >
                <History size={11} className="shrink-0 text-faint" />
                <span className="num shrink-0 text-[11px] text-text">
                  {formatStamp(p.id)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-faint">
                  {p.files.join(" · ")}
                </span>
                <Badge tone="dim">{p.files.length}</Badge>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-accent hover:underline"
                  disabled={busy}
                  onClick={() => setPending(p)}
                >
                  <RotateCcw size={10} /> {t("settings.restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={!!pending}
        title={t("settings.restoreTitle")}
        body={t("settings.restoreBody", {
          time: pending ? formatStamp(pending.id) : "",
          files: pending?.files.join(", ") ?? "",
        })}
        confirmLabel={t("settings.restoreConfirm")}
        cancelLabel={t("settings.restoreCancel")}
        danger
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const target = pending;
          setPending(null);
          if (!target) return;
          setBusy(true);
          void restoreData(target.id)
            .then((r) => {
              setStatus({ text: "", ok: false });
              void refresh();
              // 恢复后提示回退点，用户知道「选错了还能回去」——用成功样式而不是红色错误
              setStatus({
                text: t("settings.restored", {
                  count: r.restored.length,
                  safety: formatStamp(r.safety_backup.split(/[\\/]/).pop() ?? ""),
                }),
                ok: true,
              });
            })
            .catch((e) => setStatus({ text: String(e), ok: false }))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

/** `20261022-114208` → `2026-10-22 11:42:08`；无法识别时原样返回。 */
function formatStamp(id: string): string {
  if (!/^\d{8}-\d{6}$/.test(id)) return id;
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)} ${id.slice(
    9,
    11
  )}:${id.slice(11, 13)}:${id.slice(13, 15)}`;
}
