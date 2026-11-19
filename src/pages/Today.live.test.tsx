import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Today from "./Today";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";
import type { CostOverview } from "../types";

const history = [
  { t: 1, cpu: 18, memGb: 4.2 },
  { t: 2, cpu: 31, memGb: 4.4 },
  { t: 3, cpu: 24, memGb: 4.3 },
];

const overview = {
  today_cost: 1.28,
  daily_budget: 5,
  daily_pct: 26,
  alert_threshold_pct: 80,
} as CostOverview;

it("renders live cards from real store slices and exposes navigation", async () => {
  setLang("zh");
  const setView = vi.fn();
  useStore.setState({
    data: {
      projects: [],
      tasks: [
        {
          id: "t1",
          title: "进行中的任务",
          status: "doing",
          priority: "normal",
          due: null,
          project_id: null,
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
        {
          id: "t2",
          title: "已完成任务",
          status: "done",
          priority: "low",
          due: null,
          project_id: null,
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
    workModes: ["development", "project"],
    history,
    costOverview: overview,
    ais: [],
    sessions: [],
    procs: [],
    ports: [],
    sysinfo: null,
    setView,
  });
  render(<Today />);

  expect(screen.getByText("系统脉搏")).toBeInTheDocument();
  expect(screen.getByText("任务流")).toBeInTheDocument();
  expect(screen.getByText("今日成本")).toBeInTheDocument();
  expect(screen.getByText("$1.28")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "打开: 系统脉搏" }));
  expect(setView).toHaveBeenCalledWith("overview");

  const memory = screen.getByRole("button", { name: "内存占用" });
  expect(memory).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(memory);
  expect(memory).toHaveAttribute("aria-pressed", "false");
});
