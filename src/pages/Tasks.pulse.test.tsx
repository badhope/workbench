import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Tasks from "./Tasks";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";
import type { Task } from "../types";

function task(partial: Pick<Task, "id" | "title" | "status" | "priority">): Task {
  return {
    due: null,
    project_id: null,
    tags: [],
    created_at: 1,
    updated_at: 1,
    ...partial,
  };
}

it("keeps the task pulse visible and filters by its status segments", async () => {
  setLang("zh");
  useStore.setState({
    data: {
      projects: [],
      tasks: [
        task({ id: "t1", title: "待办任务", status: "todo", priority: "high" }),
        task({ id: "t2", title: "进行中任务", status: "doing", priority: "normal" }),
        task({ id: "t3", title: "已完成任务", status: "done", priority: "low" }),
      ],
    },
    taskView: "list",
    taskScope: "all",
    taskProjectFilter: "",
  });
  render(<Tasks />);

  expect(screen.getByLabelText("任务分布")).toBeInTheDocument();
  expect(screen.getByText("待办任务")).toBeInTheDocument();
  expect(screen.getByText("进行中任务")).toBeInTheDocument();
  expect(screen.getByText("已完成任务")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "待办: 1" }));

  expect(screen.getByText("待办任务")).toBeInTheDocument();
  expect(screen.queryByText("进行中任务")).not.toBeInTheDocument();
  expect(screen.queryByText("已完成任务")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "清除筛选" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));

  expect(screen.getByText("进行中任务")).toBeInTheDocument();
  expect(screen.getByText("已完成任务")).toBeInTheDocument();
});
