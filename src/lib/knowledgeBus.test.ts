import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestKnowledge,
  subscribeKnowledge,
  takeKnowledgeRequest,
} from "./knowledgeBus";

describe("knowledgeBus", () => {
  beforeEach(() => {
    takeKnowledgeRequest();
  });

  it("请求只消费一次，避免页面切换后重复搜索", () => {
    requestKnowledge({ query: "mcp", path: "/notes/mcp.md" });
    expect(takeKnowledgeRequest()).toEqual({ query: "mcp", path: "/notes/mcp.md" });
    expect(takeKnowledgeRequest()).toBeNull();
  });

  it("订阅者收到实时请求，退订后不再收到", () => {
    const fn = vi.fn();
    const off = subscribeKnowledge(fn);
    requestKnowledge({ query: "fts5" });
    expect(fn).toHaveBeenCalledWith({ query: "fts5" });
    off();
    requestKnowledge({ query: "later" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
