import { afterEach, describe, expect, it } from "vitest";
import {
  demoKnowledgeRead,
  demoKnowledgeSearch,
  demoKnowledgeStatus,
} from "./knowledgeDemo";
import { getLang, setLang } from "./i18n";

const original = getLang();

afterEach(() => setLang(original));

describe("demo knowledge", () => {
  it("reports a stable demo source and index count", () => {
    const status = demoKnowledgeStatus();
    expect(status.sources[0]?.name).toBe("notes");
    expect(status.doc_count).toBe(6);
    expect(status.last_indexed_at).toBeGreaterThan(0);
    expect(status.db_path).toBe("demo://knowledge.db");
  });

  it("returns every note for an empty query and respects the limit", () => {
    expect(demoKnowledgeSearch("")).toHaveLength(6);
    expect(demoKnowledgeSearch("   ", 2)).toHaveLength(2);
  });

  it("searches titles, tags and snippets case-insensitively", () => {
    expect(demoKnowledgeSearch("MCP").map((hit) => hit.path)).toContain(
      "~/workbench/notes/mcp-boundary.md"
    );
    expect(demoKnowledgeSearch("security").map((hit) => hit.path)).toContain(
      "~/workbench/notes/mcp-boundary.md"
    );
    expect(demoKnowledgeSearch("zzz-no-such-note")).toHaveLength(0);
    expect(demoKnowledgeSearch("design").map((hit) => hit.tags)).toContainEqual([
      "design",
      "ui",
    ]);
  });

  it("localises search and read output", () => {
    setLang("zh");
    expect(demoKnowledgeSearch("成本")[0]?.title).toBe("成本计量");
    expect(demoKnowledgeRead("~/workbench/notes/cost-metering.md").body).toContain(
      "用量来自本地"
    );

    setLang("ja");
    expect(demoKnowledgeSearch("コスト")[0]?.title).toBe("コスト計測");
    expect(demoKnowledgeRead("~/workbench/notes/cost-metering.md").body).toContain(
      "使用量はローカル"
    );
  });

  it("reads a known note and rejects an unknown path", () => {
    setLang("en");
    const doc = demoKnowledgeRead("~/workbench/notes/architecture.md");
    expect(doc.title).toBe("Workbench architecture");
    expect(doc.tags).toEqual(["architecture", "rust"]);
    expect(doc.project_id).toBe("demo-p1");
    expect(() => demoKnowledgeRead("~/workbench/notes/missing.md")).toThrow(
      "demo note not found"
    );
  });
});
