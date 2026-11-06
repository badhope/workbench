import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings from "./Settings";
import { useStore } from "../lib/store";
import { setLang } from "../lib/i18n";

vi.mock("../lib/api", async (original) => ({
  ...(await original<typeof import("../lib/api")>()),
  isTauri: () => true,
  isBackend: () => true,
}));
vi.mock("../components/AppearancePanel", () => ({ AppearancePanel: () => null }));
vi.mock("../components/AutostartCard", () => ({ AutostartCard: () => null }));
vi.mock("../components/BackupPanel", () => ({ BackupPanel: () => null }));
vi.mock("../components/DiagnosticsPanel", () => ({ DiagnosticsPanel: () => null }));

it("only discards pending changes after confirmation", async () => {
  setLang("zh");
  const discardUnsavedAndReload = vi.fn(async () => undefined);
  useStore.setState({
    discardUnsavedAndReload,
    loadCostSettings: vi.fn(async () => undefined),
  });
  render(<Settings />);
  await userEvent.click(screen.getByRole("button", { name: "放弃未保存更改并重新加载" }));
  expect(discardUnsavedAndReload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "放弃并重新加载" }));
  await waitFor(() => expect(discardUnsavedAndReload).toHaveBeenCalledOnce());
});

it("does not report imported before the write succeeds", async () => {
  setLang("zh");
  let reject!: (reason: Error) => void;
  const write = new Promise<boolean>((_, fail) => {
    reject = fail;
  });
  const setToast = vi.fn();
  useStore.setState({ persistDataNow: () => write, setToast });
  render(<Settings />);
  const file = new File(["{}"], "fixture.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify({ projects: [], tasks: [] }),
  });
  fireEvent.change(screen.getByLabelText("导入 JSON"), { target: { files: [file] } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setToast).not.toHaveBeenCalledWith(expect.stringContaining("已导入"));
  reject(new Error("disk denied"));
  await waitFor(() =>
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining("disk denied"))
  );
});

it("rejects imported projects missing required backend fields", async () => {
  setLang("zh");
  const persistDataNow = vi.fn(async () => true);
  const setToast = vi.fn();
  useStore.setState({ persistDataNow, setToast });
  render(<Settings />);
  const file = new File(["{}"], "fixture.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify({ projects: [{ id: "x", name: "X" }], tasks: [] }),
  });
  fireEvent.change(screen.getByLabelText("导入 JSON"), { target: { files: [file] } });
  await waitFor(() => expect(setToast).toHaveBeenCalled());
  expect(persistDataNow).not.toHaveBeenCalled();
  expect(setToast).toHaveBeenCalledWith(expect.stringContaining("导入失败"));
});

it("accepts backend-compatible optional fields and rejects invalid timestamps", async () => {
  setLang("zh");
  const persistDataNow = vi.fn(async () => true);
  const setToast = vi.fn();
  useStore.setState({ persistDataNow, setToast });
  render(<Settings />);
  const task = {
    id: "t",
    title: "T",
    status: "todo",
    priority: "normal",
    tags: [],
    created_at: 1,
    updated_at: 2,
  };
  const makeFile = (value: unknown) => {
    const file = new File(["{}"], "fixture.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(value) });
    return file;
  };
  const input = screen.getByLabelText("导入 JSON");
  fireEvent.change(input, {
    target: { files: [makeFile({ projects: [], tasks: [task] })] },
  });
  await waitFor(() => expect(persistDataNow).toHaveBeenCalledOnce());
  fireEvent.change(input, {
    target: { files: [makeFile({ projects: [], tasks: [{ ...task, created_at: -1 }] })] },
  });
  await waitFor(() =>
    expect(setToast).toHaveBeenCalledWith(expect.stringContaining("导入失败"))
  );
  expect(persistDataNow).toHaveBeenCalledOnce();
});

it("does not report imported when persistence rejects the import", async () => {
  setLang("zh");
  const persistDataNow = vi.fn(async () => false);
  const setToast = vi.fn();
  useStore.setState({ persistDataNow, setToast });
  render(<Settings />);
  const input = screen.getByLabelText("导入 JSON");
  const file = new File(["{}"], "fixture.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: async () => JSON.stringify({ projects: [], tasks: [] }),
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(persistDataNow).toHaveBeenCalledOnce());
  expect(setToast).not.toHaveBeenCalledWith(expect.stringContaining("已导入"));
});
