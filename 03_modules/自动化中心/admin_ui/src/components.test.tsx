import { render, screen } from "@testing-library/react";
import { CostDisplay } from "./components";
import type { CostSummary } from "./types";

const base: CostSummary = {
  known_cost_subtotal: 12.45,
  cost_currency: "CNY",
  cost_completeness: "COMPLETE",
  unknown_cost_invocation_count: 0,
  mixed_currency: false,
  currency_subtotals: [{ currency: "CNY", amount: 12.45, invocation_count: 2 }],
};

describe("CostDisplay", () => {
  it("renders COMPLETE as an exact amount", () => {
    render(<CostDisplay summary={base} />);
    expect(screen.getByText(/¥12\.45/)).toBeInTheDocument();
  });
  it("renders PARTIAL with an explicit unknown warning and count", () => {
    render(<CostDisplay summary={{ ...base, cost_completeness: "PARTIAL", unknown_cost_invocation_count: 3 }} />);
    expect(screen.getByText(/部分成本未知/)).toBeInTheDocument();
    expect(screen.getByText(/另有 3 次成本未知/)).toBeInTheDocument();
  });
  it("renders UNAVAILABLE without converting it to zero", () => {
    render(<CostDisplay summary={{ ...base, known_cost_subtotal: null, cost_currency: null, cost_completeness: "UNAVAILABLE", unknown_cost_invocation_count: 1, currency_subtotals: [] }} />);
    expect(screen.getByText("成本未知")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });
  it("renders MIXED_CURRENCY on separate lines and no total", () => {
    render(<CostDisplay summary={{ ...base, known_cost_subtotal: null, cost_currency: null, cost_completeness: "MIXED_CURRENCY", mixed_currency: true, currency_subtotals: [{ currency: "CNY", amount: 10.2, invocation_count: 1 }, { currency: "USD", amount: 1.3, invocation_count: 1 }] }} />);
    expect(screen.getByText(/CNY ¥10\.20/)).toBeInTheDocument();
    expect(screen.getByText(/USD \$1\.30/)).toBeInTheDocument();
    expect(screen.getByText(/未计算合计/)).toBeInTheDocument();
  });
});
