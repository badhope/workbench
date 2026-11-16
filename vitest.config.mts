import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// 测试与构建共用同一个版本号来源（package.json），否则 `APP_VERSION`
// 在测试里变成未定义常量——vitest 不会执行 vite.config.ts 的 define。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// 测试专用配置：jsdom 环境 + 全局 DOM 断言。
// 与 vite.config.ts 分开，避免把 tauri 特有设置带进测试。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/ui.tsx", "src/ErrorBoundary.tsx"],
      // 图表渲染层排除在单元测试之外，理由具体到可核对：
      // `echartsImpl` 与 `echarts` 入口做的事是「注册 ECharts 模块、init
      // canvas、随主题 dispose 重建」，jsdom 没有 canvas 实现，测出来只能是
      // 一堆 mock 断言 mock（零真实信号）。它们的行为由 E2E 覆盖：
      // `e2e/visual.spec.ts` 的「图表不重叠」断言每个 canvas 都有实际尺寸，
      // 「十六种主题」用例验证换肤后图表仍然渲染。
      exclude: ["src/lib/echarts.tsx", "src/lib/echartsImpl.tsx"],
      // 阈值取 2026-11-02 实测值（stmts 92.56 / branch 87.61 / funcs 92.16
      // / lines 93.79）的保守下沿：足以拦住覆盖率回退，又不会因为无关的
      // 一两行新增代码就红。
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
