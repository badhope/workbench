import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetail } from "./TaskDetail";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

it("edits an existing task and saves the patch", async () => {
  setLang("zh");
  const updateTask = vi.fn(() => true);
  useStore.setState({
    taskDetailId: "t1",
    data: {
      projects: [],
      tasks: [
        {
          id: "t1",
          title: "旧标题",
          status: "todo",
          priority: "normal",
          due: null,
          project_id: null,
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
    updateTask,
  });
  render(<TaskDetail />);

  expect(screen.getByRole("dialog")).toBeInTheDocument();
  const title = screen.getByDisplayValue("旧标题");
  await userEvent.clear(title);
  await userEvent.type(title, "新标题");
  await userEvent.click(screen.getByRole("button", { name: "保存修改" }));

  expect(updateTask).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({
      title: "新标题",
      status: "todo",
      priority: "normal",
      project_id: null,
    })
  );
});
