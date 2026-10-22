import { describe, expect, it } from "vitest";
import { monthlyValue } from "./business-cashflow";

describe("banking history in the dashboard", () => {
  it("keeps missing history and expenses distinct from a zero cash flow", () => {
    expect(monthlyValue(undefined, "net")).toBeNull();
    expect(monthlyValue({ month: "2026-09", operating_inflow: "1000000", operating_outflow: null, taxes: "100000" }, "net")).toBeNull();
    expect(monthlyValue({ month: "2026-09", operating_inflow: "100", operating_outflow: "100", taxes: "0" }, "net")).toBe(0);
  });
  it("shows negative cash flow instead of clamping it to zero", () => {
    expect(monthlyValue({ month: "2026-09", operating_inflow: "1000000", operating_outflow: "1100000", taxes: "100000" }, "net")).toBe(-200000);
  });
  it("can show known inflows when expense history is incomplete", () => {
    expect(monthlyValue({ month: "2026-09", operating_inflow: "1000000", operating_outflow: null }, "inflow")).toBe(1000000);
    expect(monthlyValue({ month: "2026-09", operating_inflow: "" }, "inflow")).toBeNull();
  });
});
