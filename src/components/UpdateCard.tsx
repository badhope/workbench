import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "../lib/api";
import { useLang } from "../lib/i18n";
import { Badge, Btn, Card, SectionTitle, Spinner } from "../ui";

type Phase =
  "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";

function copy(lang: "en" | "zh" | "ja") {
  if (lang === "zh") {
    return {
      title: "更新",
      hint: "检查 GitHub Releases 上的新版本。更新包会用内置公钥校验，校验失败不会安装。",
      check: "检查更新",
      upToDate: "已是最新版本",
      available: "发现新版本 {v}",
      install: "下载并安装",
      downloading: "下载中 {pct}%",
      ready: "安装完成，重启后生效",
      restart: "立即重启",
      error: "检查更新失败：{err}",
      desktopOnly: "自动更新只在桌面版可用。",
    };
  }
  if (lang === "ja") {
    return {
      title: "アップデート",
      hint: "GitHub Releases の新しいバージョンを確認します。更新パッケージは内蔵の公開鍵で検証され、失敗した場合はインストールされません。",
      check: "更新を確認",
      upToDate: "最新バージョンです",
      available: "新しいバージョン {v} があります",
      install: "ダウンロードしてインストール",
      downloading: "ダウンロード中 {pct}%",
      ready: "インストール完了。再起動後に反映されます",
      restart: "今すぐ再起動",
      error: "更新の確認に失敗しました：{err}",
      desktopOnly: "自動更新はデスクトップ版でのみ利用できます。",
    };
  }
  return {
    title: "Updates",
    hint: "Check GitHub Releases for a newer build. Update packages are verified with the built-in public key; a failed signature is never installed.",
    check: "Check for updates",
    upToDate: "You are up to date",
    available: "Version {v} is available",
    install: "Download & install",
    downloading: "Downloading {pct}%",
    ready: "Installed — restart to finish",
    restart: "Restart now",
    error: "Update check failed: {err}",
    desktopOnly: "In-app updates are available in the desktop app only.",
  };
}

/**
 * 自动更新卡。
 *
 * 只做「检查 / 下载 / 安装 / 重启」这一条链路，不静默替用户安装：
 * 更新会改变磁盘上的程序，必须由用户点第二次。签名校验在 Rust 侧完成，
 * 前端无法绕过；因此这里的错误文案只负责解释，不负责兜底。
 *
 * Windows 的 NSIS 安装器会在安装完成后重启应用（`restartAfterInstall`），
 * macOS / Linux 则留在当前进程，由界面显示「重启」按钮。
 */
export function UpdateCard() {
  const lang = useLang();
  const text = copy(lang);
  const desktop = isTauri();
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const updateRef = useRef<Update | null>(null);
  const [error, setError] = useState("");
  const [pct, setPct] = useState(0);

  const runCheck = useCallback(
    async (manual = true) => {
      if (!desktop) return;
      setPhase("checking");
      setError("");
      try {
        const found = await check({ timeout: 15_000 });
        if (!found) {
          void updateRef.current?.close().catch(() => undefined);
          updateRef.current = null;
          setUpdate(null);
          setPhase("current");
          return;
        }
        // 重新检查会拿到新的 Update 句柄；旧的必须先释放，否则 Rust 侧
        // 会一直保留下载状态和临时资源。
        if (updateRef.current && updateRef.current !== found) {
          void updateRef.current.close().catch(() => undefined);
        }
        updateRef.current = found;
        setUpdate(found);
        setPhase("available");
      } catch (e) {
        setError(String(e));
        // 首次启动还没有 Release 时，endpoint 会 404；自动检查不该把
        // 设置页变成常驻红色错误。用户手动点检查时才展示原因。
        setPhase(manual ? "error" : "idle");
      }
    },
    [desktop]
  );

  useEffect(() => {
    // 打开设置页时自动检查一次，避免用户必须先知道要点按钮。
    const id = setTimeout(() => void runCheck(false), 0);
    return () => {
      clearTimeout(id);
      void updateRef.current?.close().catch(() => undefined);
      updateRef.current = null;
    };
  }, [runCheck]);

  const install = async () => {
    if (!update) return;
    setPhase("downloading");
    setPct(0);
    setError("");
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall(
        (event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            setPct(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0);
          }
        },
        { timeout: 120_000, restartAfterInstall: true }
      );
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  };

  if (!desktop) return null;

  return (
    <Card>
      <SectionTitle
        extra={
          <span className="flex items-center gap-2">
            {phase === "current" && <Badge tone="ok">{text.upToDate}</Badge>}
            {(phase === "checking" || phase === "downloading") && <Spinner />}
            <Btn
              className="!py-1 !text-xs"
              onClick={() => void runCheck()}
              disabled={phase === "checking" || phase === "downloading"}
            >
              <RefreshCw size={12} /> {text.check}
            </Btn>
          </span>
        }
      >
        {text.title}
      </SectionTitle>
      <p className="mb-3 text-[11px] leading-relaxed text-dim">{text.hint}</p>

      {phase === "available" && update && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-btn)] border border-accent/30 bg-accentsoft/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-text">
              {text.available.replace("{v}", update.version)}
            </span>
            <Btn
              variant="primary"
              className="!py-1 !text-xs"
              onClick={() => void install()}
            >
              <Download size={12} /> {text.install}
            </Btn>
          </div>
          {update.body && (
            <p className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-dim">
              {update.body}
            </p>
          )}
        </div>
      )}

      {phase === "downloading" && (
        <div className="flex items-center gap-2 text-xs text-dim">
          <Spinner /> {text.downloading.replace("{pct}", String(pct))}
        </div>
      )}

      {phase === "ready" && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-btn)] border border-ok/30 bg-ok/8 px-3 py-2 text-xs text-ok">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {text.ready}
          </span>
          <Btn className="!py-1 !text-xs" onClick={() => void relaunch()}>
            {text.restart}
          </Btn>
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-start gap-2 rounded-[var(--radius-btn)] border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{text.error.replace("{err}", error)}</span>
        </div>
      )}
    </Card>
  );
}
