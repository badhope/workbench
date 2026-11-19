import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Knowledge from "./Knowledge";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

const emptyStatus = {
  sources: [],
  doc_count: 0,
  last_indexed_at: 0,
  db_path: "/tmp/knowledge.db",
};
const withSource = {
  ...emptyStatus,
  sources: [{ path: "/notes", name: "notes" }],
  doc_count: 3,
};

vi.mock("../lib/api", () => ({
  isTauri: () => false,
  knowledgeStatus: vi.fn(),
  knowledgeSearch: vi.fn(),
  knowledgeAddSource: vi.fn(),
  knowledgeRemoveSource: vi.fn(),
  knowledgeReindex: vi.fn(),
  knowledgeRead: vi.fn(),
  knowledgeOpen: vi.fn(),
  pickKnowledgeFolder: vi.fn(async () => null),
}));

import * as api from "../lib/api";

const statusMock = vi.mocked(api.knowledgeStatus);
const searchMock = vi.mocked(api.knowledgeSearch);
const addMock = vi.mocked(api.knowledgeAddSource);
const readMock = vi.mocked(api.knowledgeRead);

beforeEach(() => {
  setLang("zh");
  useStore.setState({ setToast: vi.fn() });
  statusMock.mockReset().mockResolvedValue(emptyStatus);
  searchMock.mockReset().mockResolvedValue([]);
  addMock.mockReset().mockResolvedValue(withSource);
  readMock.mockReset().mockResolvedValue({
    path: "/notes/demo.md",
    title: "Demo note",
    body: "# Demo note\n\nhello",
    project_id: "p1",
    tags: ["demo"],
    mtime: 1,
  });
});

describe("Knowledge page", () => {
  it("加载来源与最近笔记，空目录时给出明确入口", async () => {
    render(<Knowledge />);
    await screen.findByText("还没有知识目录");
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("", 30);
  });

  it("点击项目标签跳到任务页并按项目筛选", async () => {
    statusMock.mockResolvedValue(withSource);
    useStore.setState({
      data: {
        projects: [
          {
            id: "p1",
            name: "Demo",
            path: "",
            status: "active",
            tags: [],
            pinned: false,
            note: "",
            created_at: 1,
          },
        ],
        tasks: [],
      },
      view: "knowledge",
    });
    searchMock.mockResolvedValue([
      {
        path: "/notes/demo.md",
        title: "Demo note",
        project_id: "p1",
        tags: ["demo"],
        snippet: "hello",
      },
    ]);
    render(<Knowledge />);
    await userEvent.click(await screen.findByText("Demo note"));
    const badge = await screen.findByTitle("项目");
    await userEvent.click(badge);
    expect(useStore.getState().view).toBe("tasks");
    expect(useStore.getState().taskProjectFilter).toBe("p1");
  });

  it("添加目录后写回状态并刷新搜索", async () => {
    render(<Knowledge />);
    await screen.findByText("还没有知识目录");

    const input = screen.getByPlaceholderText("绝对目录路径，例如 ~/notes");
    await userEvent.type(input, "/notes");
    await userEvent.click(screen.getByRole("button", { name: /添加/ }));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith("/notes"));
    expect(await screen.findByText("3 篇笔记")).toBeInTheDocument();
    expect(searchMock).toHaveBeenLastCalledWith("", 30);
  });
});
