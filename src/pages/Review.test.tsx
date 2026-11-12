import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Review from "./Review";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/echarts", () => ({ EChart: () => null }));

it("shows current project and task stats", () => {
  setLang("zh");
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
          title: "完成登录页",
          status: "doing",
          priority: "high",
          due: null,
          project_id: "p1",
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
        {
          id: "t2",
          title: "迁移路由",
          status: "done",
          priority: "normal",
          due: null,
          project_id: "p1",
          tags: [],
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
  });
  render(<Review />);

  expect(screen.getByRole("heading", { name: "回顾" })).toBeInTheDocument();
  expect(screen.getByText("商城前端重构")).toBeInTheDocument();
  expect(screen.getAllByText("1/2").length).toBeGreaterThan(0);
});
