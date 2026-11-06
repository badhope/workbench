import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionFilesPanel } from "./SessionFilesPanel";
import { useStore } from "../../lib/store";
import { setLang } from "../../lib/i18n";
import { opencodeSessions, recentSessions } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  isTauri: () => true,
  isBackend: () => true,
  opencodeSessions: vi.fn(),
  recentSessions: vi.fn(),
}));

vi.mock("../../lib/echarts", () => ({ EChart: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  setLang("zh");
  useStore.setState({
    sessionFiles: [],
    sessionFilesErr: "",
    sessions: [],
    sessionsErr: "",
  });
  vi.mocked(opencodeSessions).mockResolvedValue({ port: 4096, sessions: [] });
});

describe("本地会话文件", () => {
  it("读取失败显示错误而非空态，重试成功后显示文件", async () => {
    vi.mocked(recentSessions)
      .mockRejectedValueOnce(new Error("C:\\Users\\private\\secret.jsonl: disk denied"))
      .mockResolvedValueOnce([
        {
          path: "a.jsonl",
          tool: "Claude",
          project: "demo",
          message_count: 2,
          modified: 1,
          size: 10,
          first_line: "",
          last_line: "",
          human_preview: "",
        },
      ]);
    render(<SessionFilesPanel />);
    await act(async () => {
      await useStore.getState().refreshAi();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("读取会话文件失败");
    expect(screen.getByRole("alert")).not.toHaveTextContent("private");
    expect(screen.getByRole("alert")).not.toHaveTextContent("disk denied");
    expect(screen.queryByText(/没有找到/)).not.toBeInTheDocument();
    expect(screen.queryByText("无数据")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("a.jsonl")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("成功返回空数组时显示空态而非错误", async () => {
    vi.mocked(recentSessions).mockResolvedValue([]);
    render(<SessionFilesPanel />);
    await act(async () => {
      await useStore.getState().refreshAi();
    });
    expect(screen.getByText(/没有找到/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
