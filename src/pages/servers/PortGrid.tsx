import { useEffect, useRef, useState } from "react";
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
  showPeer = false,
  onShowProcess,
  onOpenTarget,
}: {
  ports: PortEntry[];
  procByPid: Map<number, string>;
  tone: "accent" | "warn" | "ok";
  showPeer?: boolean;
  onShowProcess: (pid: number) => void;
  onOpenTarget: (url: string) => void;
}) {
  const t = useT();
  const text =
    tone === "accent" ? "text-accent" : tone === "ok" ? "text-ok" : "text-warn";

  // 只记住「协议 + 本地地址 + 端口 + PID」的状态：同一本地端口可能有多个
  // 远端连接，按远端区分会把同一次状态变化拆成多行，反而无法高亮。
  const stateKey = (p: PortEntry) =>
    `${p.protocol}|${p.local_addr}|${p.local_port}|${p.pid}`;
  const rowKey = (p: PortEntry) => `${stateKey(p)}|${p.remote_addr}`;
  const previous = useRef(new Map<string, string>());
  const [changed, setChanged] = useState<Set<string>>(new Set());

  useEffect(() => {
    const next = new Map<string, string>();
    const toFlash = new Set<string>();
    for (const port of ports) {
      const key = stateKey(port);
      next.set(key, port.state);
      const old = previous.current.get(key);
      if (old !== undefined && old !== port.state) toFlash.add(key);
    }
    previous.current = next;
    if (toFlash.size === 0) return;
    setChanged(toFlash);
    const timer = window.setTimeout(() => setChanged(new Set()), 1600);
    return () => window.clearTimeout(timer);
  }, [ports]);

  return (
    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {ports.map((p) => {
        const target = urlForPort(p.local_port, p.local_addr, p.protocol);
        return (
          <div
            key={rowKey(p)}
            className={`flex items-center gap-2 rounded-[var(--radius-btn)] border border-line/50 bg-panel2 px-3 py-2 text-xs transition-colors hover:border-accent/40 ${
              changed.has(stateKey(p)) ? "port-state-change" : ""
            }`}
          >
            <Network size={12} className={`${text} shrink-0`} />
            <span className={`font-mono font-semibold ${text}`}>:{p.local_port}</span>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className="block max-w-full truncate text-left text-dim hover:text-accent"
                onClick={() => onShowProcess(p.pid)}
                title={t("servers.showProcess")}
              >
                {procByPid.get(p.pid) ?? `PID ${p.pid}`}
              </button>
              {showPeer && (
                <div
                  className="mt-0.5 truncate text-[9.5px] text-faint"
                  title={`${p.remote_addr} · ${p.state}`}
                >
                  {p.remote_addr || "—"} · {p.state}
                </div>
              )}
            </div>
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
