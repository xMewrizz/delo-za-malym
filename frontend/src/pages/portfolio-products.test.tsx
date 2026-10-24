import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Profile } from "@/features/applications";
import type { CalendarData, CalendarEvent } from "@/features/calendar/api";
import { portfolioProducts, sumDisplayAmounts } from "./portfolio-products";
import { FundingLiquid, PortfolioProductCard } from "./financing-portfolio";

const financials: Profile["financials"] = {
  cash_balance: "1200000.00", portfolio_cash_total: "900000.00",
  existing_loans: [
    { loan_id: "bank", product_id: "working_capital_loan", outstanding_principal: "700000.00", monthly_payment: "35000.00", maturity_date: "2027-05-15" },
    { loan_id: "first", application_id: "first", product_id: "working_capital_loan", outstanding_principal: "500000.00", monthly_payment: "47279.80", maturity_date: "2027-10-22" },
    { loan_id: "second", application_id: "second", product_id: "working_capital_loan", outstanding_principal: "400000.00", monthly_payment: "21148.44", maturity_date: "2028-10-22" },
  ],
};
const event = (id: string, amount: string, fields: Partial<CalendarEvent> = {}): CalendarEvent => ({
  event_id: id, application_id: id, date: "2026-11-15", amount, direction: "outflow", forecast: true, kind: "loan_payment", title: "Платёж", ...fields,
});
const calendar: CalendarData = {
  penalty_terms: [], payment_orders: [], today: "2026-10-23", plans: [],
  events: [event("bank", "35000.00", { loan_id: "bank" }), event("first", "47279.80"), event("second", "21148.44"), event("overdraft", "2000.00", { kind: "overdraft_interest" })],
  accounts: [
    { application_id: "first", product_id: "working_capital_loan", amount: "500000.00", opened_at: "2026-10-22", outstanding_principal: "500000.00" },
    { application_id: "second", product_id: "working_capital_loan", amount: "400000.00", opened_at: "2026-10-22", outstanding_principal: "400000.00" },
    { application_id: "overdraft", product_id: "overdraft", amount: "190000.00", opened_at: "2026-10-21", outstanding_principal: "0.00" },
  ],
};

describe("portfolio product consistency", () => {
  it("distinguishes repaid principal from available revolving capacity", () => {
    const loan = { id: "app:loan", title: "Кредит", kind: "loan" as const, status: "active", source: "Кабинет", originalPrincipal: "500000.00", principal: "400000.00" };
    const loanHtml = renderToStaticMarkup(<FundingLiquid product={loan} />);
    expect(loanHtml).toContain('aria-valuenow="20"');
    expect(loanHtml).toContain('aria-label="Погашено основного долга"');
    const lineHtml = renderToStaticMarkup(<FundingLiquid product={{ ...loan, kind: "limit", limit: "500000.00", principal: "100000.00", available: "400000.00" }} />);
    expect(lineHtml).toContain('aria-valuenow="80"');
    expect(lineHtml).toContain('aria-label="Лимит свободен"');
  });

  it("does not invent progress without the original amount or show liquid at zero", () => {
    const product = { id: "loan:bank", title: "Кредит", kind: "loan" as const, status: "active", source: "Банк", principal: "700000.00" };
    expect(renderToStaticMarkup(<FundingLiquid product={product} />)).not.toContain('role="meter"');
    expect(renderToStaticMarkup(<FundingLiquid product={{ ...product, originalPrincipal: "700000.00" }} />)).not.toContain('class="funding-liquid-fill"');
  });
  it("shows each debt once and gives imported and cabinet loans the same fields", () => {
    const products = portfolioProducts(financials, calendar);
    expect(products).toHaveLength(4);
    const loans = products.filter(product => product.kind === "loan");
    expect(loans.map(loan => loan.principal)).toEqual(["700000.00", "500000.00", "400000.00"]);
    const labels = loans.map(product => {
      const html = renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={product} /></MemoryRouter>);
      expect(html).toContain("Остаток основного долга");
      return [...html.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]);
    });
    expect(labels[0]).toEqual(labels[1]);
    expect(labels[1]).toEqual(labels[2]);
    expect(labels[0]).toEqual(["Ставка", "Начислено процентов", "Ближайший платёж", "Дата платежа", "Окончание договора"]);
    expect(products.find(product => product.id === "app:overdraft")).toMatchObject({ limit: "190000.00", principal: "0.00", available: "190000.00", nextPayment: undefined });
  });

  it("combines payments due on the same date and excludes historical payments", () => {
    const combined = portfolioProducts(financials, { ...calendar, events: [
      event("first", "500.00", { date: "2026-09-15" }),
      event("first", "47279.80"), event("first", "0.35", { kind: "interest" }),
      event("first", "1000.00", { date: "2026-12-15" }),
    ] });
    expect(combined.find(product => product.id === "app:first")?.nextPayment).toEqual({ date: "2026-11-15", amount: "47280.15" });
    expect(sumDisplayAmounts([{ amount: "0.10" }, { amount: "0.20" }])).toBe("0.30");
  });
  it("shows contract interest separately from principal without inventing missing rates", () => {
    const enriched = { ...calendar, accounts: calendar.accounts.map(account => ({ ...account, annual_rate_percent: "24.00", accrued_interest: "328.77" })), events: [event("first", "47279.80", { principal_amount: "37279.80", interest_amount: "10000.00" })] };
    const product = portfolioProducts(financials, enriched).find(item => item.id === "app:first")!;
    expect(product.nextPayment).toMatchObject({ amount: "47279.80", principal: "37279.80", interest: "10000.00" });
    const html = renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={product} /></MemoryRouter>);
    expect(html).toContain("24% годовых");
    expect(html).toContain("Начислено процентов");
    expect(html.replaceAll(/\s/g, "")).toContain("328,77");
    expect(html.replaceAll(/\s/g, "")).toContain("10000,00");
    expect(portfolioProducts(financials, calendar).find(item => item.id === "loan:bank")?.annualRate).toBeUndefined();
  });

});
