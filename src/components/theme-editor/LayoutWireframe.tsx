// 版面线框图：用灰阶矩形表达概览页的排布差异。

export function LayoutWireframe({ id }: { id: string }) {
  const rows: Record<string, React.ReactNode> = {
    bento: (
      <div className="flex h-full flex-col gap-1">
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-3 flex-1 rounded-[2px] bg-current opacity-70" />
          ))}
        </div>
        <div className="flex flex-1 gap-1">
          <div className="w-2/3 rounded-[2px] bg-current opacity-45" />
          <div className="flex-1 rounded-[2px] bg-current opacity-55" />
        </div>
        <div className="flex h-3 gap-1">
          <div className="flex-1 rounded-[2px] bg-current opacity-35" />
          <div className="flex-1 rounded-[2px] bg-current opacity-35" />
        </div>
      </div>
    ),
    ledger: (
      <div className="flex h-full flex-col gap-1">
        {[70, 55, 62, 48].map((w, i) => (
          <div
            key={i}
            className="h-3 rounded-[2px] bg-current opacity-50"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    ),
    orbit: (
      <div className="relative h-full">
        <div className="absolute left-1/2 top-1/2 h-3/4 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-current opacity-30" />
        <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current opacity-75" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <div
            key={deg}
            className="absolute h-2.5 w-2.5 rounded-[2px] bg-current opacity-50"
            style={{
              left: `calc(50% + ${Math.cos((deg * Math.PI) / 180) * 38}% - 5px)`,
              top: `calc(50% + ${Math.sin((deg * Math.PI) / 180) * 34}% - 5px)`,
            }}
          />
        ))}
      </div>
    ),
    dense: (
      <div className="grid h-full grid-cols-2 gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-[2px] bg-current opacity-45" />
        ))}
      </div>
    ),
    zen: (
      <div className="flex h-full flex-col gap-1 items-center justify-center">
        <div className="h-3 w-2/3 rounded-[2px] bg-current opacity-70" />
        <div className="h-8 w-full rounded-[2px] bg-current opacity-40" />
      </div>
    ),
    timeline: (
      <div className="relative h-full pl-3">
        <div className="absolute bottom-0.5 left-[2px] top-0.5 w-px bg-current opacity-30" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative mb-1 flex items-center">
            <span className="absolute -left-[6.5px] h-[9px] w-[9px] rounded-full bg-current opacity-70" />
            <div
              className="h-3 rounded-[2px] bg-current opacity-45"
              style={{ width: ["100%", "82%", "64%"][i] }}
            />
          </div>
        ))}
      </div>
    ),
    board: (
      <div className="grid h-full grid-cols-3 gap-1.5">
        {[3, 2, 2].map((n, c) => (
          <div key={c} className="flex flex-col gap-1 border-t border-current/50 pt-1">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="h-2.5 rounded-[2px] bg-current opacity-45" />
            ))}
          </div>
        ))}
      </div>
    ),
  };
  return (
    <div className="h-20 rounded-[var(--radius-btn)] border border-line/70 bg-panel2/40 p-2 text-text">
      {rows[id] ?? rows.bento}
    </div>
  );
}
