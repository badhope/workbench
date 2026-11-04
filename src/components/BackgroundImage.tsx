/**
 * 自定义背景图层。
 *
 * 图片经 AppearancePanel 压缩成 dataURL 存本机（localStorage），CSP 的
 * img-src data: 放行；渲染上垫一层 78% 主题底色遮罩——任何壁纸都要给
 * 监控数据让路，可读性优先。z-0 与光晕/粒子同层，内容(#root z-1)在其上。
 */
export function BackgroundImage({ dataUrl }: { dataUrl: string | null }) {
  if (!dataUrl) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${dataUrl}")` }}
      />
      {/* 遮罩用主题底色：明暗主题自动适配，换主题无需重新调参 */}
      <div
        className="absolute inset-0"
        style={{
          background: "color-mix(in srgb, var(--color-bg) 78%, transparent)",
        }}
      />
    </div>
  );
}
