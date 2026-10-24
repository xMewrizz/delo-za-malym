// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { Profile } from "@/features/applications";
import type { CalendarData, CalendarEvent } from "@/features/calendar/api";
import { portfolioProducts, sumDisplayAmounts } from "./portfolio-products";
import { LimitUtilization, PortfolioProductCard } from "./financing-portfolio";

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
  it("previews three real payment dates and derives the end of principal grace from the schedule",()=>{
    const events=[
      event("first","6000.00",{event_id:"nov",date:"2026-11-14",principal_amount:"0.00",interest_amount:"6000.00"}),
      event("first","6000.00",{event_id:"dec",date:"2026-12-14",principal_amount:"0.00",interest_amount:"6000.00"}),
      event("first","18000.00",{event_id:"jan",date:"2027-01-14",principal_amount:"12000.00",interest_amount:"6000.00"}),
      event("first","18000.00",{event_id:"feb",date:"2027-02-14"}),
      event("first","999.00",{event_id:"order",date:"2026-11-01",kind:"loan_payment_order"}),
    ];
    const product=portfolioProducts(financials,{...calendar,events:[...events,events[0]]}).find(item=>item.applicationId==="first")!;
    expect(product.upcomingPayments).toEqual([{date:"2026-11-14",amount:"6000.00"},{date:"2026-12-14",amount:"6000.00"},{date:"2027-01-14",amount:"18000.00"}]);
    expect(product.principalStartsOn).toBe("2027-01-14");
    expect(product.nextPayment).toMatchObject({date:"2026-11-14",amount:"6000.00"});
    const html=renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={product}/></MemoryRouter>);
    const host=document.createElement("div");host.innerHTML=html;
    expect(host.querySelector(".funding-card-details")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector(".funding-card-summary .funding-upcoming")).toBeNull();
    expect(host.querySelector(".funding-card-facts")?.textContent).toContain("Ближайший платёж");
    expect(html).toContain("Сейчас — только проценты");
    expect(html).toContain("Ближайшие платежи");
    expect(html).not.toContain("Состав платежа");
    expect(renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={{...product,status:"closed"}}/></MemoryRouter>)).not.toContain("Ближайшие платежи");
  });
  it("shows utilization in rubles only for limits, without opposite percentage meanings", () => {
    const loan = { id: "app:loan", title: "Кредит", kind: "loan" as const, status: "active", source: "Кабинет", originalPrincipal: "500000.00", principal: "400000.00" };
    expect(renderToStaticMarkup(<LimitUtilization product={loan} />)).toBe("");
    const line = { ...loan, kind: "limit" as const, limit: "500000.00", principal: "100000.00", available: "400000.00" };
    const lineHtml = renderToStaticMarkup(<LimitUtilization product={line} />);
    expect(lineHtml).toContain('aria-valuenow="100000"');
    expect(lineHtml).toContain('aria-valuemax="500000"');
    expect(lineHtml).toContain('aria-label="Использовано из лимита"');
    expect(lineHtml).not.toContain("<svg");
    expect(renderToStaticMarkup(<LimitUtilization product={{ ...line, principal: "0.00" }} />)).toContain('style="width:0%"');
    expect(renderToStaticMarkup(<LimitUtilization product={{ ...line, principal: "500000.00" }} />)).toContain('style="width:100%"');
    const unknown = renderToStaticMarkup(<LimitUtilization product={{ ...line, principal: null }} />);
    expect(unknown).toContain("Уточняется");
    expect(unknown).not.toContain('role="meter"');
    expect(renderToStaticMarkup(<LimitUtilization product={{ ...line, status: "closed" }} />)).toBe("");
    const host=document.createElement("div");
    host.innerHTML=renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={line}/></MemoryRouter>);
    expect(host.querySelector('[role="meter"]')?.closest("details")).toBeNull();
    expect(host.querySelector('.funding-card-balance [role="meter"]')).not.toBeNull();
    expect(host.querySelector('.funding-card-amount small')?.textContent?.replace(/\s/g," ")).toBe('/ 500 000 ₽');
  });

  it("explains issued refinancing without suggesting that the money was credited to the account", () => {
    const product = { id: "app:refi", applicationId: "refi", title: "Рефинансирование", productId: "refinancing", kind: "loan" as const, status: "active", source: "Кабинет", originalPrincipal: "152890.13", principal: "152890.13" };
    const html = renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={product} /></MemoryRouter>);
    expect(html).toContain("на рефинансирование");
    expect(html).toContain("Сумма направлена на погашение прежних кредитов");
    expect(html).toContain("На расчётный счёт зачислено 0 ₽");
    expect(html).not.toContain("полученных");
    expect(html).not.toContain('role="meter"');
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
    expect(labels[0]).toEqual(["Ставка", "Проценты на сегодня", "Ближайший платёж", "Дата платежа", "Окончание договора"]);
    expect(products.find(product => product.id === "app:overdraft")).toMatchObject({ limit: "190000.00", principal: "0.00", available: "190000.00", nextPayment: undefined });
  });

  it("combines payments due on the same date and excludes historical payments", () => {
    const combined = portfolioProducts(financials, { ...calendar, events: [
      event("first", "500.00", { event_id:"past",date: "2026-09-15" }),
      event("first", "47279.80"), event("first", "0.35", { event_id:"interest",kind: "interest" }),
      event("first", "1000.00", { event_id:"december",date: "2026-12-15" }),
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
    expect(html).not.toContain("Состав платежа");
    expect(html).toContain("Проценты на сегодня");
    expect(html.replaceAll(/\s/g, "")).toContain("328,77");

    expect(portfolioProducts(financials, calendar).find(item => item.id === "loan:bank")?.annualRate).toBeUndefined();
  });

});
