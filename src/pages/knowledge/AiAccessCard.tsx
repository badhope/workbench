import { useState } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import { Btn, Card, SectionTitle } from "../../ui";
import { useT } from "../../lib/i18n";

const COMMAND = "workbench mcp --stdio";

/** AI 接入说明卡：只给外部客户端命令，不内嵌模型与 API Key。 */
export function AiAccessCard() {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时保留可见命令，用户可手动复制 */
    }
  }

  return (
    <Card>
      <SectionTitle extra={<Sparkles size={14} className="text-accent" />}>
        {t("knowledge.aiTitle")}
      </SectionTitle>
      <p className="mb-2 text-[11px] text-faint">{t("knowledge.aiSub")}</p>
      <div className="flex items-center gap-2 rounded-[5px] border border-line/70 bg-panel2/50 px-2.5 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">
          {COMMAND}
        </code>
        <Btn onClick={copy} className="!px-2 !py-1 !text-[11px]">
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          {copied ? t("knowledge.copied") : t("knowledge.copy")}
        </Btn>
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
        {t("knowledge.aiHint")}
      </p>
    </Card>
  );
}
