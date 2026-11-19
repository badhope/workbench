import { ExternalLink, ListTree, Network } from "lucide-react";
import { useT } from "../../lib/i18n";
import { urlForPort } from "../../lib/openTarget";
import type { PortEntry } from "../../types";

/**
 * 端口磁贴网格：TCP 与 UDP 共用同一套排版，差异只有色调和「打开」按钮。
 * 抽出来的原因：两个 Card 里各写一遍 60 行 JSX，字段/按钮一改就漏一处。
 */
export function PortGrid({
  ports,
  procByPid,
  tone,
  onShowProcess,
  onOpenTarget,
}: {
  ports: PortEntry[];
  procByPid: Map<number, string>;
  tone: "accent" | "warn";
  onShowProcess: (pid: number) => void;
  onOpenTarget: (url: string) => void;
}) {
  const t = useT();
  const text = tone === "accent" ? "text-accent" : "text-warn";
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {ports.map((p) => {
        const target = urlForPort(p.local_port, p.local_addr, p.protocol);
        return (
          <div
            key={`${p.local_addr}-${p.local_port}-${p.pid}`}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/50 bg-panel2 px-3 py-2 text-xs hover:border-accent/40 transition-colors"
          >
            <Network size={12} className={`${text} shrink-0`} />
            <span className={`font-mono font-semibold ${text}`}>:{p.local_port}</span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-dim hover:text-accent"
              onClick={() => onShowProcess(p.pid)}
              title={t("servers.showProcess")}
            >
              {procByPid.get(p.pid) ?? `PID ${p.pid}`}
            </button>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="text-dim hover:text-accent"
                onClick={() => onShowProcess(p.pid)}
                title={t("servers.showProcess")}
                aria-label={t("servers.showProcess")}
              >
                <ListTree size={11} />
              </button>
              {target && (
                <button
                  type="button"
                  className="text-dim hover:text-accent"
                  onClick={() => onOpenTarget(target.url)}
                  title={`${t("servers.open")} · ${target.url}`}
                  aria-label={`${t("servers.open")} ${target.url}`}
                >
                  <ExternalLink size={11} />
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
