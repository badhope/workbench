import type { ReactNode } from "react";
import { Card } from "../../../ui";

/** 组件外壳：统一的标题栏 + 拖拽把手。 */
export function WidgetFrame({
  title,
  extra,
  children,
  dragHandle,
  className = "",
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  dragHandle?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`flex h-full min-h-0 flex-col ${className}`}>
      {(title || dragHandle) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <h2 className="section-title flex min-w-0 items-center gap-2">
              <span className="h-3 w-px shrink-0 bg-accent/70" aria-hidden="true" />
              <span className="truncate">{title}</span>
            </h2>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {extra}
            {dragHandle}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}
