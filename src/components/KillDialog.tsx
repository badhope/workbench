import { useState } from "react";
import { useT } from "../lib/i18n";
import { useStore } from "../lib/store";
import { useShallow } from "zustand/react/shallow";
import { Btn, Modal } from "../ui";
import { terminateProcessElevated } from "../lib/api";

/** 提权结束依赖 Windows UAC；其余平台连入口都不出（后端 Err 仅作纵深防御）。 */
function isWindowsPlatform(): boolean {
  return navigator.platform.toLowerCase().includes("win");
}

/** 结束进程的二次确认框。不可逆操作，必须走 Modal 而不是 window.confirm。 */
export function KillDialog() {
  const t = useT();
  const { killTarget, setKillTarget, killProcess, setToast } = useStore(
    useShallow((s) => ({
      killTarget: s.killTarget,
      setKillTarget: s.setKillTarget,
      killProcess: s.killProcess,
      setToast: s.setToast,
    }))
  );
  // 普通结束失败后才出现「以管理员结束」入口；每次重新打开确认框都回到默认路径。
  const [killFailed, setKillFailed] = useState(false);
  const [elevating, setElevating] = useState(false);

  const closeDialog = () => {
    setKillFailed(false);
    setKillTarget(null);
  };

  const confirmKill = async () => {
    if (!killTarget) return;
    const pid = killTarget.pid;
    await killProcess(pid);
    // 成功时 store 会清空 killTarget；仍在则说明普通结束失败，亮出提权入口
    const stillOpen = useStore.getState().killTarget?.pid === pid;
    setKillFailed(stillOpen);
  };

  const elevatedKill = async () => {
    if (!killTarget) return;
    const pid = killTarget.pid;
    setElevating(true);
    try {
      await terminateProcessElevated(pid);
      closeDialog();
      setToast(t("store.killElevatedSent", { pid }));
    } catch (e) {
      setToast(t("store.killElevatedFailed", { err: String(e) }));
    } finally {
      setElevating(false);
    }
  };

  return (
    <Modal
      open={!!killTarget}
      title={t("app.kill.title")}
      onClose={closeDialog}
      footer={
        <>
          <Btn onClick={closeDialog}>{t("app.kill.cancel")}</Btn>
          {killFailed && isWindowsPlatform() && (
            <Btn
              variant="danger"
              disabled={elevating}
              onClick={() => void elevatedKill()}
            >
              {t("app.kill.elevated")}
            </Btn>
          )}
          <Btn variant="danger" onClick={() => void confirmKill()}>
            {t("app.kill.confirm", { pid: killTarget?.pid ?? "" })}
          </Btn>
        </>
      }
    >
      <p className="text-sm text-dim">
        {t("app.kill.body", {
          name: killTarget?.name ?? "",
          pid: killTarget?.pid ?? "",
        })}
      </p>
    </Modal>
  );
}

/** 底部 toast。 */
export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      className="animate-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-panel2/95 px-4 py-1.5 text-[12.5px] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur"
      role="status"
      aria-live="polite"
    >
      {toast}
    </div>
  );
}
