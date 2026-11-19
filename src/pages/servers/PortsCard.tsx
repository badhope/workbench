import { Btn, Card, Empty, SectionTitle } from "../../ui";
import { downloadCsv } from "../../lib/export";
import { useT } from "../../lib/i18n";
import type { PortEntry } from "../../types";
import { PortGrid } from "./PortGrid";

/**
 * 端口 Card 的完整壳：标题、CSV 导出、空态、磁贴网格。
 * TCP 与 UDP 两块曾各写一遍，连“导出文件名 + 表头 + 空态文案”都重复；
 * 这里只保留参数差异，新增列不会漏改其中一块。
 */
export function PortsCard({
  title,
  empty,
  ports,
  csvName,
  procByPid,
  tone,
  onShowProcess,
  onOpenTarget,
}: {
  title: string;
  empty: string;
  ports: PortEntry[];
  csvName: string;
  procByPid: Map<number, string>;
  tone: "accent" | "warn";
  onShowProcess: (pid: number) => void;
  onOpenTarget: (url: string) => void;
}) {
  const t = useT();
  const exportRows = () => {
    downloadCsv(csvName, [
      ["protocol", "local_address", "port", "pid", "process"],
      ...ports.map((p) => [
        p.protocol,
        p.local_addr,
        p.local_port,
        p.pid,
        procByPid.get(p.pid) ?? "",
      ]),
    ]);
  };

  return (
    <Card>
      <SectionTitle
        extra={
          ports.length > 0 ? (
            <Btn className="!py-1 !text-xs" onClick={exportRows}>
              {t("servers.exportCsv")}
            </Btn>
          ) : undefined
        }
      >
        {title}
      </SectionTitle>
      {ports.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <PortGrid
          ports={ports}
          procByPid={procByPid}
          tone={tone}
          onShowProcess={onShowProcess}
          onOpenTarget={onOpenTarget}
        />
      )}
    </Card>
  );
}
