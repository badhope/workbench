import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 测试专用配置：jsdom 环境 + 全局 DOM 断言。
// 与 vite.config.ts 分开，避免把 tauri 特有设置带进测试。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/lib/**", "src/ui.tsx", "src/ErrorBoundary.tsx"],
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
