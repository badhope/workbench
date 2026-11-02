import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Tasks from "./Tasks";
import Projects from "./Projects";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/echarts", () => ({ EChart: () => null }));

it("keeps a task draft when saving is rejected", async () => {
  setLang("zh");
  useStore.setState({ data: { projects: [], tasks: [] }, addTask: () => false });
  render(<Tasks />);
  const input = screen.getAllByPlaceholderText("添加任务，回车确认")[0];
  await userEvent.type(input, "任务草稿{Enter}");
  expect(input).toHaveValue("任务草稿");
});

it("keeps a project draft when saving is rejected", async () => {
  setLang("zh");
  useStore.setState({ data: { projects: [], tasks: [] }, addProject: () => false });
  render(<Projects />);
  await userEvent.click(screen.getByRole("button", { name: "新建项目" }));
  const dialog = screen.getByRole("dialog");
  const input = dialog.querySelector("input")!;
  await userEvent.type(input, "项目草稿");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("dialog")).toContainElement(input);
  expect(input).toHaveValue("项目草稿");
});
