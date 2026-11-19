import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiAccessCard } from "./AiAccessCard";
import { setLang } from "../../lib/i18n";

const configMock = vi.fn(async () => ({ allow_writes: false }));
const actionsMock = vi.fn(async () => [
  {
    id: "a1",
    at: 1,
    tool: "task_create",
    target: "t1",
    summary: "创建任务：示例",
    undone: false,
  },
]);
const setWritesMock = vi.fn(async (allow: boolean) => ({ allow_writes: allow }));
const undoMock = vi.fn(async (_id: string) => ({
  id: "a1",
  at: 1,
  tool: "task_create",
  target: "t1",
  summary: "创建任务：示例",
  undone: true,
}));

vi.mock("../../lib/api", () => ({
  isBackend: () => true,
  aiConfig: () => configMock(),
  aiActions: () => actionsMock(),
  aiSetWrites: (allow: boolean) => setWritesMock(allow),
  aiUndo: (id: string) => undoMock(id),
}));

beforeEach(() => {
  setLang("en");
  configMock.mockClear();
  actionsMock.mockClear();
  setWritesMock.mockClear();
  undoMock.mockClear();
});

describe("AiAccessCard", () => {
  it("默认关闭，开启后才能撤销并显示已撤销状态", async () => {
    render(<AiAccessCard />);
    const sw = await screen.findByRole("switch");
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    await waitFor(() => expect(actionsMock).toHaveBeenCalled());

    await userEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(setWritesMock).toHaveBeenCalledWith(true);

    const undo = screen.getByRole("button", { name: "Undo" });
    await userEvent.click(undo);
    await waitFor(() => expect(undoMock).toHaveBeenCalledWith("a1"));
    await waitFor(() => expect(screen.getByText("Undone")).toBeInTheDocument());
  });
});
