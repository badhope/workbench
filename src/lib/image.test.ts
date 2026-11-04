import { describe, expect, it } from "vitest";
import {
  downscaleDimensions,
  fitsLocalStorage,
  pickOutputMime,
  BACKGROUND_MAX_EDGE,
} from "./image";

describe("背景图缩放计算", () => {
  it("不超过上限时原样返回（不放大）", () => {
    expect(downscaleDimensions(1280, 800)).toEqual({ width: 1280, height: 800 });
    expect(downscaleDimensions(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("长边超限等比缩小，短边跟随", () => {
    expect(downscaleDimensions(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(downscaleDimensions(2160, 3840)).toEqual({ width: 1080, height: 1920 });
    // 竖图极端比例：缩完仍 ≥1px
    expect(downscaleDimensions(10000, 100)).toEqual({
      width: BACKGROUND_MAX_EDGE,
      height: 19,
    });
  });

  it("非法尺寸给 0-0，不抛错", () => {
    expect(downscaleDimensions(0, 100)).toEqual({ width: 0, height: 0 });
    expect(downscaleDimensions(-5, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("输出格式选择", () => {
  it("JPEG 原样保留（不无谓转码）", () => {
    expect(pickOutputMime("image/jpeg")).toBe("image/jpeg");
  });

  it("PNG/GIF/WebP/SVG 统一重编码为 PNG（保透明、去动画）", () => {
    expect(pickOutputMime("image/png")).toBe("image/png");
    expect(pickOutputMime("image/gif")).toBe("image/png");
    expect(pickOutputMime("image/webp")).toBe("image/png");
    expect(pickOutputMime("image/svg+xml")).toBe("image/png");
  });
});

describe("localStorage 容量守卫", () => {
  it("2.5MB 以内放行，超出的拒绝", () => {
    expect(fitsLocalStorage("data:image/png;base64," + "a".repeat(1000))).toBe(true);
    expect(fitsLocalStorage("data:image/png;base64," + "a".repeat(3_000_000))).toBe(
      false
    );
  });
});
