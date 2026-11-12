import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";
import Today from "./Today";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/echarts", () => ({ EChart: () => null }));

it("renders current project, today tasks and captures to inbox", async () => {
  setLang("zh");
  const addTask = vi.fn(() => true);
  const due = dayjs().format("YYYY-MM-DD");
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
          note: "迁移到新设计系统",
          created_at: 1,
        },
      ],
      tasks: [
        {
          id: "t1",
          title: "完成登录页改版",
          status: "doing",
          priority: "high",
          due,
          project_id: "p1",
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
    workModes: ["development", "project"],
    addTask,
  });
  render(<Today />);

  expect(screen.getByText("今天先推进什么？")).toBeInTheDocument();
  expect(screen.getAllByText("完成登录页改版").length).toBeGreaterThan(0);
  expect(screen.getAllByText("商城前端重构").length).toBeGreaterThan(0);

  const input = screen.getByPlaceholderText("记一件事，回车放进收件箱…");
  await userEvent.type(input, "整理周会纪要{Enter}");
  expect(addTask).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "整理周会纪要",
      status: "todo",
      project_id: null,
    })
  );
});

it("collapses and restores the rail", async () => {
  setLang("zh");
  useStore.setState({
    data: { projects: [], tasks: [] },
    workModes: ["development"],
    railCollapsed: false,
    railSections: { projects: true, inbox: true, system: true },
  });
  render(<Today />);

  const collapseButtons = screen.getAllByRole("button", { name: "收起侧栏" });
  expect(collapseButtons.length).toBeGreaterThan(0);
  await userEvent.click(collapseButtons[0]);
  expect(screen.queryByRole("button", { name: "侧栏内容" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "显示侧栏" }));
  expect(screen.getByRole("button", { name: "侧栏内容" })).toBeInTheDocument();
});
