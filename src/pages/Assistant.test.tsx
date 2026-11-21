import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Assistant from "./Assistant";
import { setLang } from "../lib/i18n";
import { DEFAULT_ASSISTANT_CONFIG } from "../lib/assistant";

/**
 * 助手页的契约：探活 → 展示状态 → 用建议问题发起一轮对话并渲染回答。
 * 模型本身的质量归 bench 脚本管；这里只保证接线不断。
 */
const api = vi.hoisted(() => ({
  assistantConfig: vi.fn(),
  assistantSaveConfig: vi.fn(),
  assistantStatus: vi.fn(),
  assistantChat: vi.fn(),
  assistantChatStream: vi.fn(),
  assistantCancel: vi.fn(),
  assistantStartService: vi.fn(),
  assistantStopService: vi.fn(),
}));

vi.mock("../lib/api", () => api);

beforeEach(() => {
  setLang("zh");
  api.assistantConfig.mockResolvedValue(DEFAULT_ASSISTANT_CONFIG);
  api.assistantSaveConfig.mockImplementation(async (config) => config);
  api.assistantStatus.mockResolvedValue({
    ok: true,
    base_url: DEFAULT_ASSISTANT_CONFIG.base_url,
    model: DEFAULT_ASSISTANT_CONFIG.model,
    latency_ms: 12,
    models: ["minicpm5-2b"],
    error: "",
  });
  api.assistantChat.mockResolvedValue({
    content: "先处理登录页的报错，它今天到期。",
    steps: [],
    usage: { prompt_tokens: 20, completion_tokens: 10 },
    model: "minicpm5-2b",
  });
  api.assistantChatStream.mockImplementation(async (_messages, _config, _id, onEvent) => {
    onEvent({ kind: "delta", text: "先处理登录页的报错", step: null, reply: null });
    onEvent({
      kind: "done",
      text: "",
      step: null,
      reply: {
        content: "先处理登录页的报错，它今天到期。",
        steps: [],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
        model: "minicpm5-2b",
      },
    });
  });
});

it("探活后展示已连接，并能用建议问题完成一轮对话", async () => {
  render(<Assistant />);

  await screen.findByText("已连接");
  await waitFor(() => expect(api.assistantStatus).toHaveBeenCalledTimes(1));

  await userEvent.click(screen.getByRole("button", { name: "今天最该先处理什么？" }));

  await screen.findByText("先处理登录页的报错，它今天到期。");
  expect(api.assistantChatStream).toHaveBeenCalledWith(
    [{ role: "user", content: "今天最该先处理什么？" }],
    DEFAULT_ASSISTANT_CONFIG,
    expect.any(String),
    expect.any(Function),
    expect.anything()
  );
  expect(screen.getByText("20 输入 / 10 输出 token")).toBeInTheDocument();
});

it("生成中可以停止，停止请求带同一个 request id", async () => {
  let release: (() => void) | undefined;
  api.assistantChatStream.mockImplementationOnce(
    async () =>
      await new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  render(<Assistant />);
  await screen.findByText("已连接");
  await userEvent.click(screen.getByRole("button", { name: "今天最该先处理什么？" }));
  const stop = await screen.findByRole("button", { name: "停止" });
  const requestId = api.assistantChatStream.mock.calls.at(-1)?.[2];
  await userEvent.click(stop);
  expect(api.assistantCancel).toHaveBeenCalledWith(requestId);
  await screen.findByText(/已停止生成/);
  release?.();
});

it("服务不可达时给出未连接与启动提示，不假装能用", async () => {
  api.assistantStatus.mockResolvedValue({
    ok: false,
    base_url: DEFAULT_ASSISTANT_CONFIG.base_url,
    model: DEFAULT_ASSISTANT_CONFIG.model,
    latency_ms: 0,
    models: [],
    error: "connection refused",
  });

  render(<Assistant />);
  await screen.findByText("未连接");
  await userEvent.click(screen.getByTitle("模型设置"));
  expect(screen.getByText(/先在终端启动本地服务/)).toBeInTheDocument();
});
