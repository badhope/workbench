import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CostDashboard } from "./CostDashboard";
import { useStore } from "../../lib/store";
import { setLang } from "../../lib/i18n";
import { getPricing, savePricing, scanSessionCosts } from "../../lib/api";
import type { CostOverview, PricingRow, PricingView } from "../../types";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  isTauri: () => true,
  getPricing: vi.fn(),
  savePricing: vi.fn(),
  scanSessionCosts: vi.fn(),
}));

vi.mock("../../lib/echarts", () => ({ EChart: () => null }));

const row = (over: Partial<PricingRow> = {}): PricingRow => ({
  model: "gpt-test",
  builtin_input: 1,
  builtin_output: 2,
  override_input: null,
  override_output: null,
  ...over,
});

const view = (rows: PricingRow[]): PricingView => ({
  rows,
  problems: [],
  path: "C:\\data\\pricing_overrides.json",
});

const overview = (cost: number): CostOverview => ({
  today_cost: cost,
  today_input_tokens: 1000,
  today_output_tokens: 1000,
  today_cache_read_tokens: 0,
  today_cache_creation_tokens: 0,
  month_cost: cost,
  month_input_tokens: 1000,
  month_output_tokens: 1000,
  month_cache_read_tokens: 0,
  month_cache_creation_tokens: 0,
  total_cost: cost,
  total_input_tokens: 1000,
  total_output_tokens: 1000,
  total_cache_read_tokens: 0,
  total_cache_creation_tokens: 0,
  record_count: 1,
  measured_count: 1,
  estimated_count: 0,
  zero_pricing_count: 0,
  daily_budget: 0,
  monthly_budget: 0,
  alert_threshold_pct: 80,
  daily_pct: 0,
  monthly_pct: 0,
  budget_exceeded: false,
});

/** 点开唯一一行的编辑态，把输出单价改成 4，再点「应用」。 */
async function editAndSavePrice() {
  const tableRow = screen.getByText("gpt-test").closest("tr");
  if (!tableRow) throw new Error("row not rendered");
  await userEvent.click(within(tableRow).getByTitle("修改价格"));
  const inputs = within(tableRow).getAllByRole("textbox");
  await userEvent.clear(inputs[1]);
  await userEvent.type(inputs[1], "4");
  await userEvent.click(within(tableRow).getByTitle("应用"));
}

beforeEach(() => {
  vi.resetAllMocks();
  setLang("zh");
  useStore.setState({
    costOverview: null,
    costTrend: [],
    costModelBreakdown: [],
    costLoading: false,
    costNotified: false,
    toast: "",
  });
  // 挂载时编辑器和摘要 hook 都会读价格；保存成功后才应返回带覆盖的行。
  // 用状态化 mock，避免按调用次数猜测（那会让“保存前不应有角标”失真）。
  let saved = false;
  vi.mocked(getPricing).mockImplementation(async () =>
    view([row(saved ? { override_input: 1, override_output: 4 } : {})])
  );
  vi.mocked(savePricing).mockImplementation(async () => {
    saved = true;
    return view([row({ override_input: 1, override_output: 4 })]);
  });
  vi.mocked(scanSessionCosts).mockResolvedValue({
    new_records: 0,
    total_scanned: 1,
    overview: overview(12.34),
    trend: [],
    model_breakdown: [],
  });
});

describe("保存价格后重算账单", () => {
  it("保存成功后自动扫描并用新价刷新账单与覆盖角标", async () => {
    render(<CostDashboard />);
    expect(await screen.findByText("gpt-test")).toBeInTheDocument();
    // 保存前没有覆盖角标
    expect(screen.queryByText(/已覆盖 .* 个型号的价格/)).not.toBeInTheDocument();

    await editAndSavePrice();

    // 账单本身重算：界面出现扫描返回的新金额，而不是只触发一次调用。
    // 今日/本月/总计三张卡都取同一个 overview 字段，所以用 getAllByText。
    await waitFor(() => expect(screen.getAllByText("$12.34").length).toBeGreaterThan(0));
    expect(scanSessionCosts).toHaveBeenCalledTimes(1);
    expect(savePricing).toHaveBeenCalledWith({ "gpt-test": [1, 4] });

    // 覆盖角标由 pricing.refresh() 重新读取 getPricing 得到
    expect(await screen.findByText("已覆盖 1 个型号的价格")).toBeInTheDocument();
  });

  it("保存失败时展示错误且不触发扫描、不刷新角标", async () => {
    vi.mocked(savePricing).mockRejectedValue(new Error("invalid price"));
    render(<CostDashboard />);
    expect(await screen.findByText("gpt-test")).toBeInTheDocument();
    const callsBeforeSave = vi.mocked(getPricing).mock.calls.length;

    await editAndSavePrice();

    expect(await screen.findByText(/invalid price/)).toBeInTheDocument();
    expect(scanSessionCosts).not.toHaveBeenCalled();
    expect(vi.mocked(getPricing).mock.calls.length).toBe(callsBeforeSave);
    expect(screen.queryByText(/已覆盖 .* 个型号的价格/)).not.toBeInTheDocument();
  });
});
