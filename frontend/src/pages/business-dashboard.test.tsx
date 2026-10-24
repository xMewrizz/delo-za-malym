// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { calendarQuery } from "@/features/calendar/api";
import type { Profile } from "@/features/applications";
import { BusinessDashboard } from "./business-accounts";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("business dashboard controls", () => {
  it("changes the selected month and range, retaining negative cash flow without counting forecasts as operations", async () => {
    const profile: Profile = { company_name: "ООО «Север»", business: { inn: "0000000000", activity: "Торговля", registered_at: "2023-01-15", legal_form: "ooo" }, financials: { cash_balance: "1200000.00", monthly: [
      { month: "2026-04", operating_inflow: "800000", operating_outflow: "600000", taxes: "40000" },
      { month: "2026-05", operating_inflow: "900000", operating_outflow: "700000", taxes: "50000" },
      { month: "2026-06", operating_inflow: "800000", operating_outflow: "810000", taxes: "30000" },
      { month: "2026-07", operating_inflow: "1000000", operating_outflow: "800000", taxes: "50000" },
      { month: "2026-08", operating_inflow: "1100000", operating_outflow: "850000", taxes: "50000" },
      { month: "2026-09", operating_inflow: "1200000", operating_outflow: "900000", taxes: "50000" },
    ] } };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
    client.setQueryData(calendarQuery.queryKey, { today: "2026-10-23", accounts: [], plans: [], payment_orders: [], penalty_terms: [], events: [{ event_id: "f", application_id: "loan", date: "2026-11-01", amount: "10000", direction: "outflow", forecast: true, kind: "loan_payment", title: "Платёж" }] });
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><BusinessDashboard profile={profile} /></MemoryRouter></QueryClientProvider>));
      expect(host.querySelectorAll(".business-month")).toHaveLength(6);
      const june = host.querySelector<HTMLButtonElement>('.business-month[aria-label^="июнь"]')!;
      await act(async () => june.click());
      expect(june.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector('.business-month-summary [data-negative="true"]')?.textContent?.replace(/\s/g, "")).toContain("-40000");
      await act(async () => host.querySelector<HTMLButtonElement>(".business-range button")!.click());
      expect(host.querySelectorAll(".business-month")).toHaveLength(3);
      expect(host.querySelector('.business-month[aria-pressed="true"]')?.getAttribute("aria-label")).toContain("сентябрь");
      expect(host.querySelector(".business-operation-list")).toBeNull();
      expect(host.querySelector(".business-next-payment")?.textContent).toContain("1 ноября");
      expect(host.querySelectorAll(".company-profile-requisites dt")).toHaveLength(3);
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });
});
