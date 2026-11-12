import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import MiniWorkbench from "./MiniWorkbench";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/useAppRuntime", () => ({ useAppRuntime: () => {} }));

it("shows current work and captures a task", async () => {
  setLang("zh");
  const addTask = vi.fn(() => true);
  useStore.setState({
    data: {
      projects: [
        {
          id: "p1",
          name: "商城前端重构",
          path: "",
          status: "active",
          tags: [],
          pinned: true,
          note: "",
          created_at: 1,
        },
      ],
      tasks: [
        {
          id: "t1",
          title: "登录页改版",
          status: "doing",
          priority: "high",
          due: dayjs().format("YYYY-MM-DD"),
          project_id: "p1",
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
    addTask,
  });
  render(<MiniWorkbench />);

  expect(screen.getByText("工作台小窗")).toBeInTheDocument();
  expect(screen.getByText("商城前端重构")).toBeInTheDocument();
  expect(screen.getAllByText("登录页改版").length).toBeGreaterThan(0);

  const input = screen.getByPlaceholderText("记一件事…");
  await userEvent.type(input, "小窗记录");
  await userEvent.click(screen.getByRole("button", { name: "记录" }));
  expect(addTask).toHaveBeenCalledWith(
    expect.objectContaining({ title: "小窗记录", project_id: "p1" })
  );
});
