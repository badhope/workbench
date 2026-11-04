/**
 * 背景图导入的纯逻辑部分（便于单测）：尺寸计算与输出格式选择。
 * 实际的解码/绘制在 AppearancePanel 里走 Image + canvas（需要真实 DOM）。
 */

/** 背景图最长边上限：超过就等比缩小。1920px 在 1440p 屏足够，再大纯浪费。 */
export const BACKGROUND_MAX_EDGE = 1920;

/**
 * 等比缩放后的目标尺寸。不需要缩小时原样返回（不放大）。
 */
export function downscaleDimensions(
  width: number,
  height: number,
  maxEdge = BACKGROUND_MAX_EDGE
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 输出格式：JPEG 原样保留（不无谓转码）；其余（PNG/GIF/WebP/SVG/AVIF）
 * 经 canvas 重编码为 PNG——canvas 画 GIF 只落第一帧（顺手去动画），
 * PNG 保留透明通道（转 JPEG 会黑底）。
 */
export function pickOutputMime(sourceType: string): "image/jpeg" | "image/png" {
  return /jpe?g/i.test(sourceType) ? "image/jpeg" : "image/png";
}

/** dataURL 大小粗校验：localStorage 预算 5MB，给其它键留余量，图不超过 2.5MB。 */
export const BACKGROUND_MAX_BYTES = 2_500_000;

export function fitsLocalStorage(dataUrl: string): boolean {
  // base64 长度 ≈ 4/3 原始字节；这里直接量字符串（BMP 内每字符 2 字节，
  // base64 是 ASCII，length 即可）。
  return dataUrl.length <= BACKGROUND_MAX_BYTES;
}
