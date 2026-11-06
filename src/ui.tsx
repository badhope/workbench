import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { AlertTriangle, Inbox } from "lucide-react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`t-card t-panel border border-line/90 ${className}`}>{children}</div>
  );
}

export function SectionTitle({
  children,
  extra,
}: {
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="section-title flex min-w-0 items-center gap-2">
        <span className="h-3 w-px shrink-0 bg-accent/70" aria-hidden="true" />
        <span className="truncate">{children}</span>
      </h2>
      {extra}
    </div>
  );
}

/** 语义色集合。调用方只允许这五个值，拼错由 tsc 拦下。 */
export type Tone = "accent" | "ok" | "warn" | "danger" | "dim";

const TONES: Record<Tone, string> = {
  accent: "text-accent border-accent/35 bg-accent/8",
  ok: "text-ok border-ok/35 bg-ok/8",
  warn: "text-warn border-warn/35 bg-warn/8",
  danger: "text-danger border-danger/35 bg-danger/8",
  dim: "text-dim border-line bg-panel2",
};

export function Badge({
  children,
  tone = "dim",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[1px] text-[10.5px] font-medium leading-[16px] ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

type BtnProps = {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "title" | "disabled" | "type"
>;

export function Btn({
  children,
  onClick,
  variant = "ghost",
  className = "",
  title,
  disabled,
  type = "button",
}: BtnProps) {
  const base =
    "t-btn inline-flex items-center gap-1.5 px-3 py-[5px] text-[12.5px] font-medium disabled:opacity-40";
  const styles: Record<string, string> = {
    // 渐变由 .t-btn-primary 消费 --gradient-accent：关档时退化为纯色，
    // 这里不写任何条件样式（消费方无感知）。
    primary:
      "t-btn-primary text-[var(--color-on-accent)] hover:brightness-110 active:brightness-95 font-semibold",
    ghost:
      "border border-line bg-panel2/70 text-text hover:border-line hover:bg-panel2 hover:text-text",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/18",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * 对话框内可聚焦元素的选择器。集中一份，初始聚焦与 Tab 陷阱共用，
 * 避免两处漂移（曾经的初始聚焦没有 `:not([disabled])`）。
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * 模态框：补上 dialog 语义、焦点圈定与恢复、ESC 关闭。
 * 原先只有裸 div + 点击遮罩，键盘用户打开后 Tab 会跑到背后的页面里，
 * 而删除/清空这类不可逆操作的确认框正是最需要焦点约束的地方。
 */
export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    // 与 Tab 陷阱共用同一套可聚焦选择器：禁用控件不能拿到初始焦点，
    // 否则 first?.focus() 静默失败，焦点留在背后的页面上。
    const first = node?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();

    return () => {
      const target = restoreFocusRef.current;
      // 触发按钮可能已随列表刷新卸载，focus 前确认它仍在文档里
      if (target?.isConnected) target.focus();
    };
  }, [open]);

  // 焦点圈定必须在 document 级监听：焦点一旦落到对话框外（用户点了不可聚焦
  // 的正文，activeElement 回到 body），keydown 就不会再经过对话框元素，
  // 挂在对话框上的 onKeyDown 根本没机会拦截，Tab 会按文档顺序逃到遮罩后面。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const node = dialogRef.current;
      if (!node) return;
      trapTab(event, node);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const onDialogKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      // 手机上 p-6 只留 272px 给内容，太挤；窄屏用更小的外边距
      className="overlay-scrim fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
        className={`t-card t-panel max-h-[90vh] w-full overflow-y-auto border border-line shadow-2xl ${wide ? "max-w-2xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id={titleId}
          className="border-b border-line px-5 py-3 text-base font-semibold"
        >
          {title}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 破坏性操作确认框。替代 window.confirm：
 * 后者在 WKWebView/macOS 上会静默返回 true，且无法样式化、无法测试。
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  danger = true,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Btn onClick={onCancel}>{cancelLabel}</Btn>
          <Btn variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <div className="flex items-start gap-3 text-sm text-dim">
        {danger && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />}
        <p className="whitespace-pre-wrap">{body}</p>
      </div>
    </Modal>
  );
}

/**
 * 动效档位 → 数字滚动时长（ms）。
 *
 * useCountUp 是全站唯一的 JS 动效例外：CSS 断闸管不到 rAF，
 * 所以它自己读 data-motion（组件不读 store 的 motion 字段，约定见设计文档）。
 * off = 0（直接落值）；rich 略长于 standard，制造「更满」的观感。
 */
function countUpDuration(): number {
  const level = document.documentElement.dataset.motion;
  if (level === "off") return 0;
  return level === "rich" ? 800 : 600;
}

/** 数字滚动动画：目标值变化时从旧值平滑过渡到新值。 */
function useCountUp(target: number): number {
  const [val, setVal] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    const to = target;
    prevRef.current = target;
    if (from === to) {
      setVal(to);
      return;
    }
    const duration = countUpDuration();
    if (duration <= 0) {
      // 关档：不给 rAF 循环，下一帧直接落值（不在 effect 里同步 setState，
      // 避免级联渲染；rAF 回调本身就是「外部系统回调」）。
      const raf = requestAnimationFrame(() => setVal(to));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setVal(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return val;
}

const STAT_TONES: Record<"text" | Tone, string> = {
  text: "text-text",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  dim: "text-dim",
};

/**
 * 统计单元（视觉 2.0 重做）：图标有 accent-soft 圆角底座做「锚点」，
 * accent 档数字用 accent→accent2 渐变（.grad-accent）+ 等宽表格数字。
 * 对外 props 不变：CostDashboard 等调用点零改动。
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "text",
}: {
  icon: typeof Inbox;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "text" | Tone;
}) {
  const numeric = typeof value === "number";
  const shown = useCountUp(numeric ? value : 0);
  return (
    <Card className="card-hover group relative overflow-hidden px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-dim">{label}</span>
        {/* 底座只换底色与圆角，不放大图标：锚点的作用是固定视线，
            抢戏的图标块反而降低信息密度 */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accentsoft text-accent">
          <Icon size={13} />
        </span>
      </div>
      {/* 数值字号随屏幕收缩：390px 下两列卡片只有 ~160px 宽，
          text-3xl 的 "17.66M" 会溢出卡片边界。 */}
      <div
        className={`num mt-2 truncate text-[26px] font-semibold leading-none sm:text-[30px] ${
          tone === "accent" ? "grad-accent" : STAT_TONES[tone]
        }`}
        title={String(numeric ? shown : value)}
      >
        {numeric ? shown : value}
      </div>
      {hint && (
        <div className="mt-2 truncate text-[11px] text-faint" title={hint}>
          {hint}
        </div>
      )}
    </Card>
  );
}

/**
 * 空状态。
 *
 * `action` 是可选的下一步操作：只说「还没有数据」而不给按钮，
 * 用户得自己去找入口（Raycast/Datadog 的空状态都带引导）。
 */
/**
 * 空态插画：虚线托盘上一只轻轻悬浮的盒子，语义图标嵌在盒面。
 * 颜色全部走主题 token——自定义主题/亮暗切换都自动成立，不用出参调色。
 * 动效是 1.5px 的缓浮（.empty-float，data-motion=off 时被集中断闸）。
 */
function EmptyArt({ icon: Icon }: { icon?: typeof Inbox }) {
  return (
    <div className="empty-float relative h-12 w-28" aria-hidden="true">
      <svg
        viewBox="0 0 112 48"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        {/* 地面阴影：虚线椭圆，示意"这里本该有东西" */}
        <ellipse
          cx="56"
          cy="44"
          rx="24"
          ry="3.5"
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
        {/* 悬浮盒：panel2 填充 + faint 描边，微微倾斜打破呆板 */}
        <g transform="rotate(-3 56 22)">
          <rect
            x="38"
            y="9"
            width="36"
            height="26"
            rx="6"
            fill="var(--color-panel2)"
            stroke="var(--color-faint)"
            strokeWidth="1.5"
          />
        </g>
        {/* 环绕光点：一颗 accent 一颗 accent2，呼应主题强调色 */}
        <circle cx="18" cy="14" r="2" fill="var(--color-accent)" opacity="0.65" />
        <circle
          cx="96"
          cy="26"
          r="1.6"
          fill="var(--color-accent2, var(--color-accent))"
          opacity="0.55"
        />
        <circle cx="90" cy="8" r="1" fill="var(--color-faint)" />
      </svg>
      {Icon && (
        <Icon
          size={13}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%] text-accent opacity-80"
        />
      )}
    </div>
  );
}

export function Empty({
  children,
  icon: Icon,
  action,
}: {
  children: ReactNode;
  icon?: typeof Inbox;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-[6px] border border-dashed border-line/80 text-[12px] text-faint">
      <EmptyArt icon={Icon} />
      <span className="max-w-[46ch] px-3 text-center">{children}</span>
      {action}
    </div>
  );
}

/**
 * 错误状态：页面内联，而不是只弹一个会自动消失的 toast。
 *
 * 后端失败时（数据文件损坏、IPC 超时）用户需要看到「哪块坏了 + 重试」，
 * 而不是几秒后 toast 消失、页面继续显示空白。
 */
export function ErrorState({
  children,
  onRetry,
  retryLabel,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex h-32 flex-col items-center justify-center gap-2.5 rounded-[6px] border border-danger/40 bg-danger/8 px-4 text-[12px] text-danger"
    >
      <AlertTriangle size={18} className="opacity-80" />
      <span className="max-w-[52ch] text-center leading-relaxed">{children}</span>
      {onRetry && (
        <Btn variant="danger" onClick={onRetry} className="!px-2.5 !py-1 !text-[11px]">
          {retryLabel}
        </Btn>
      )}
    </div>
  );
}

/**
 * 骨架占位：形状与真实内容一致，避免「加载时一片空白、数据到了突然跳动」。
 *
 * 只在首次加载时用（数据已存在就不再显示），否则每次轮询都会闪一下。
 * 视觉 2.0 起用 shimmer（transform 位移的高光条）替代 animate-pulse：
 * 位移只在伪元素的合成层上跑，且能被 [data-motion="off"] 集中断闸。
 */
export function Skeleton({
  className = "",
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="shimmer h-3 rounded-[3px] bg-line/70"
          style={{ width: `${100 - (i % 3) * 18}%` }}
        />
      ))}
    </div>
  );
}

/** 卡片级骨架：标题条 + 若干行。 */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="t-card t-panel border border-line/90">
      <div className="shimmer mb-3 h-3 w-24 rounded-[3px] bg-line/80" />
      <Skeleton lines={rows} />
    </div>
  );
}

export function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-dim">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "w-full rounded-[var(--radius-btn)] border border-line bg-panel2/60 px-2.5 py-[6px] text-[12.5px] text-text outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus:bg-panel2";

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line/80 text-left">
            {head.map((h, i) => (
              <th key={i} className="col-head whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

type TrProps = HTMLAttributes<HTMLTableRowElement> & {
  /** 虚拟滚动实测高度用：@tanstack/react-virtual 按此值回读行高 */
  "data-index"?: number;
};

export const Tr = forwardRef<HTMLTableRowElement, TrProps>(function Tr(
  { children, className = "", onClick, ...rest },
  ref
) {
  return (
    <tr
      ref={ref}
      className={`border-b border-line/50 transition-colors hover:bg-panel2/60 ${onClick ? "cursor-pointer" : ""} ${className}`}
      onClick={onClick}
      {...rest}
    >
      {children}
    </tr>
  );
});

export function Td({
  children,
  className = "",
  mono = false,
  title,
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
  title?: string;
  colSpan?: number;
}) {
  return (
    <td
      className={`px-3 py-2 align-middle ${mono ? "font-mono text-xs" : ""} ${className}`}
      title={title}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

/**
 * 把 Tab / Shift+Tab 圈在对话框内。
 *
 * 三种情况：焦点跑到对话框外（点了正文）拉回第一个/最后一个；
 * 在末元素按 Tab 回绕到首元素；在首元素按 Shift+Tab 回绕到末元素。
 * 抽成函数是因为内联版本让 Modal 的复杂度到 11，而这段逻辑本身
 * 与 React 无关，tests 直接调用即可覆盖三个分支。
 */
function trapTab(event: KeyboardEvent, node: HTMLElement) {
  const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (!active || !node.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
