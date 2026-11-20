import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { check } from "@tauri-apps/plugin-updater";
import { setLang } from "../lib/i18n";
import { UpdateCard } from "./UpdateCard";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

function makeUpdate() {
  return {
    version: "1.1.0",
    body: "Release notes",
    close: vi.fn(async () => undefined),
    downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 50 } });
    }),
  };
}

beforeEach(() => {
  setLang("en");
  vi.mocked(check).mockReset();
});

it("shows the available version and installs it", async () => {
  const update = makeUpdate();
  vi.mocked(check).mockResolvedValueOnce(update as never);

  render(<UpdateCard />);
  expect(await screen.findByText("Version 1.1.0 is available")).toBeInTheDocument();
  expect(screen.getByText("Release notes")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Download & install" }));
  expect(await screen.findByText("Installed — restart to finish")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restart now" })).toBeInTheDocument();
  expect(update.downloadAndInstall).toHaveBeenCalledOnce();
});

it("reports an up-to-date state", async () => {
  vi.mocked(check).mockResolvedValueOnce(null);

  render(<UpdateCard />);
  expect(await screen.findByText("You are up to date")).toBeInTheDocument();
});

it("hides automatic check failures but shows manual ones", async () => {
  vi.mocked(check).mockRejectedValue(new Error("offline"));

  render(<UpdateCard />);
  await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Update check failed/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(
    await screen.findByText(/Update check failed: Error: offline/)
  ).toBeInTheDocument();
});
