import { describe, expect, it, vi } from "vitest";
import { csvCell, downloadText, toCsv } from "./export";

describe("csvCell", () => {
  it("leaves plain values alone", () => {
    expect(csvCell("chrome.exe")).toBe("chrome.exe");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a"b,c')).toBe('"a""b,c"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises formula injection", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and ends with a newline", () => {
    expect(
      toCsv([
        ["a", "b"],
        [1, 2],
      ])
    ).toBe("a,b\r\n1,2\r\n");
  });
});

describe("downloadText", () => {
  it("创建 Blob 链接触发下载并回收 URL", async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => {
          const u = `blob:fake-${created.length}`;
          created.push(u);
          return u;
        }),
        revokeObjectURL: vi.fn((u: string) => revoked.push(u)),
      })
    );
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = () =>
          clicks.push((el as HTMLAnchorElement).download);
      }
      return el;
    });

    downloadText("costs.csv", "a,b\r\n", "text/csv");

    expect(created).toHaveLength(1);
    expect(clicks).toEqual(["costs.csv"]);
    await new Promise((r) => setTimeout(r, 1100));
    expect(revoked).toEqual(created);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
