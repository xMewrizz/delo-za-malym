// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { RefinancingBaseline, RefinancingEffect } from "./refinancing-comparison";
import type { Offer } from "../api/applications";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("refinancing comparison", () => {
  it("distinguishes a lower peak from an increase during the old grace period", async () => {
    const comparison = { payoff_amount: "800000.00", current_monthly_payment: "31000.00", current_total_repayment: "1000000.00",
      current_remaining_cost: "200000.00", monthly_payment_basis: "maximum_calendar_month", comparison_month: "2026-11",
      current_payment_in_comparison_month: "12000.00", new_payment_in_comparison_month: "30000.00", first_month_payment_change: "18000.00",
      monthly_payment_reduction: "1000.00", total_cost_change: "80000.00", loans: [] };
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<><RefinancingBaseline value={comparison} /><RefinancingEffect offer={{offer_id:"one", product_id:"refinancing", amount:"800000.00", refinancing:comparison} as Offer} /></>));
      expect(host.textContent).toContain("Максимальная нагрузка за месяц");
      expect(host.textContent).not.toContain("Платежи сейчас");
      expect(host.textContent).toContain("В первом месяце выплаты вырастут");
      expect(host.textContent).toContain("хотя максимальная нагрузка снизится");
      expect(host.textContent).toContain("Пиковая нагрузка меньше, но общая стоимость выше");
    } finally { await act(async () => root.unmount()); }
  });

  it("does not call zero difference a reduction", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<RefinancingEffect offer={{offer_id:"one", product_id:"refinancing", amount:"100000.00", refinancing:{monthly_payment_reduction:"0.00",total_cost_change:"0.00"}} as Offer} />));
      expect(host.textContent).toContain("Максимальная месячная нагрузка не изменится");
      expect(host.textContent).toContain("Все оставшиеся выплаты не изменятся");
      expect(host.textContent).not.toContain("ниже на");
    } finally { await act(async () => root.unmount()); }
  });
});
