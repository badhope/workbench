import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Tasks from "./Tasks";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/echarts", () => ({ EChart: () => null }));

it("adds a task from the list view with Enter", async () => {
  setLang("zh");
  const addTask = vi.fn(() => true);
  useStore.setState({
    data: { projects: [], tasks: [] },
    taskView: "list",
    taskScope: "all",
    taskProjectFilter: "",
    addTask,
  });
  render(<Tasks />);

  const input = screen.getByPlaceholderText("添加任务，回车确认");
  await userEvent.type(input, "列表新建任务{Enter}");

  expect(addTask).toHaveBeenCalledWith(
    expect.objectContaining({
      title: "列表新建任务",
      status: "todo",
      project_id: null,
    })
  );
});
