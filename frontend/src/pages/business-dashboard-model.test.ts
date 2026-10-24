import { describe, expect, it } from "vitest";
import type { Profile } from "@/features/applications";
import type { CalendarData, CalendarEvent } from "@/features/calendar/api";
import { businessSnapshot, monthTotals } from "./business-dashboard-model";

const profile: Profile = { company_name: "ООО «Север»", business: { inn: "0000000000", activity: "Торговля", registered_at: "2023-01-15" }, financials: { cash_balance: "1200.00" } };
const event = (id: string, fields: Partial<CalendarEvent> = {}): CalendarEvent => ({ event_id: id, application_id: "loan", date: "2026-11-22", amount: "0.10", direction: "outflow", kind: "loan_payment", forecast: true, title: "Платёж", ...fields });
const calendar: CalendarData = { today: "2026-10-23", accounts: [], plans: [], penalty_terms: [], payment_orders: [], events: [] };

describe("business financial overview", () => {
  it("distinguishes missing values from zero and includes taxes in outgoing cash", () => {
    expect(monthTotals({ month: "2026-09", operating_inflow: "100.30", operating_outflow: "80.10", taxes: "0.20" })).toMatchObject({ inflow: 100.3, outflow: 80.3, net: 20 });
    expect(monthTotals({ month: "2026-09", operating_inflow: "0", operating_outflow: "0", taxes: "0" })).toMatchObject({ inflow: 0, outflow: 0, net: 0 });
    expect(monthTotals({ month: "2026-09", operating_inflow: "100", operating_outflow: "0" })).toMatchObject({ inflow: 100, outflow: null, net: null });
  });
  it("combines all real obligations on the earliest date without hypothetical overdraft spending", () => {
    const snapshot = businessSnapshot(profile, { ...calendar, events: [event("later", { date: "2026-12-22" }), event("b", { amount: "0.20" }), event("a"), event("hypothetical", { date: "2026-10-30", amount: "10000", kind: "overdraft_repayment" }), event("already-paid", { forecast: false, date: "2026-10-22" })] });
    expect(snapshot.due).toBe("2026-11-22");
    expect(snapshot.nextTotal).toBe("0.30");
    expect(snapshot.afterPayment).toBe(1199.7);
    expect(snapshot.nextPayments).toHaveLength(2);
  });
  it("surfaces overdue payments and does not replace an unknown available balance with ledger cash", () => {
    const withAccount = { ...profile, accounts: [{ account_id: "a", type: "settlement" as const, title: "Счёт", currency: "RUB" as const, balance: "1200", available_balance: null, number: null, mode: "simulated" as const }] };
    const data = { ...calendar, events: [event("overdue", { date: "2026-10-22", amount: "500" })] };
    expect(businessSnapshot(withAccount, data)).toMatchObject({ cash: null, afterPayment: null, overdue: true });
    expect(businessSnapshot({ ...withAccount, accounts: [{ ...withAccount.accounts[0], available_balance: "0" }] }, data)).toMatchObject({ cash: 0, afterPayment: -500 });
    expect(businessSnapshot(profile)).toMatchObject({ debt: null, unused: null });
  });
  it("keeps unused limits separate from cash and excludes closed debt", () => {
    const snapshot = businessSnapshot(profile, { ...calendar, accounts: [{ application_id: "line", product_id: "revolving_credit_line", amount: "10000", opened_at: "2026-10-20", outstanding_principal: "3000", available_limit: "7000" }, { application_id: "closed", product_id: "working_capital_loan", amount: "5000", outstanding_principal: "0", opened_at: "2026-10-20", status: "closed" }] });
    expect(snapshot).toMatchObject({ cash: 1200, debt: "3000.00", unused: "7000.00", capacity: "10000.00" });
    expect(snapshot.products).toHaveLength(1);
  });
  it("lists only completed monetary operations and retains product names after closure", () => {
    const events = [event("issued", { forecast: false, kind: "loan_received", direction: "inflow", date: "2026-10-22" }), event("paid", { forecast: false, kind: "loan_repayment", date: "2026-10-23" }), event("future-fact", { forecast: false, date: "2026-10-24" }), event("limit", { forecast: false, direction: "none" }), event("planned")];
    const snapshot = businessSnapshot(profile, { ...calendar, events, accounts: [{ application_id: "loan", product_id: "investment_loan", amount: "100", opened_at: "2026-10-22", outstanding_principal: "0", status: "closed" }] });
    expect(snapshot.operations.map(item => item.event_id)).toEqual(["paid", "issued"]);
    expect(snapshot.operations[0].productTitle).toBe("Инвестиционный кредит");
  });
});
