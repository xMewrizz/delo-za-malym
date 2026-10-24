// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PaymentCalendar } from "./payment-calendar";
import { calendarQuery, previewPenalty, type CalendarData } from "./api";
import { applicationKeys } from "@/features/applications/model/queries";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), previewPenalty: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const terms = { version: "simple-daily-v1" as const, daily_rate_percent: "0.05", source: "demo_contract" as const, basis: "overdue_installment" as const, start_rule: "day_after_due" as const, day_count: "calendar" as const, capitalization: false as const };
const data: CalendarData = { today: "2026-10-23", plans: [], payment_orders: [], penalty_terms: ["first", "second"].map(id => ({ ...terms, product_id: `app:${id}`, terms_id: `terms-${id}` })), accounts: ["first", "second"].map(id => ({ application_id: id, product_id: "working_capital_loan", amount: "500000.00", opened_at: "2026-10-22", outstanding_principal: "500000.00", maturity_date: "2027-10-22", status: "active" })), events: [
  { event_id: "a", application_id: "first", date: "2026-10-31", amount: "40000.00", direction: "outflow", kind: "loan_payment", title: "Первый платёж", forecast: true },
  { event_id: "b", application_id: "second", date: "2026-11-15", amount: "10000.00", direction: "outflow", kind: "loan_payment", title: "Второй платёж", forecast: true },
] };
function Location() { return <output id="timeline-location">{useLocation().search}</output>; }
async function renderTimeline(url: string, calendarData: CalendarData = data) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(calendarQuery.queryKey, calendarData);
  client.setQueryData(applicationKeys.profile, { company_name: "Компания", financials: { existing_loans: [] } });
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={client}><PaymentCalendar /><Location /></QueryClientProvider></MemoryRouter>));
  return { host, dispose: async () => { await act(async () => root.unmount()); client.clear(); host.remove(); } };
}
describe("timeline interactions", () => {
  it("opens contract details and calculates penalties from an empty selected day, preserving the date across views", async () => {
    const mock = vi.mocked(previewPenalty); mock.mockClear(); mock.mockResolvedValue({ from_date: "2026-10-23", target_date: "2026-11-20", missed_payments: "40000.00", total_penalty: "400.00", total_with_penalty: "40400.00", mode: "scenario", basis: "contract_simple_daily_rate", products: [] });
    const { host, dispose } = await renderTimeline("/cabinet?mode=calendar&view=timeline&date=2026-11-20");
    try {
      await act(async () => host.querySelector<HTMLButtonElement>(".payment-timeline-contract")!.click());
      expect(document.querySelector(".payment-timeline-product-facts")?.textContent).toContain("Основной долг");
      expect(document.querySelector(".timeline-inspector")?.textContent).toContain("№ first");
      const track = host.querySelector<HTMLElement>(".payment-timeline-track")!;
      track.getBoundingClientRect = () => ({ left: 100, width: 10980, right: 11080, top: 0, bottom: 100, height: 100, x: 100, y: 0, toJSON: () => ({}) });
      await act(async () => track.querySelector(".payment-timeline-contract")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 3965 })));
      expect(host.querySelector("#timeline-location")?.textContent).toContain("date=2026-11-20");
      await act(async () => track.querySelector(".payment-timeline-date-hit")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, clientX: 3965 })));
      expect(host.querySelector("#timeline-location")?.textContent).toContain("date=2026-11-21");
      await act(async () => host.querySelector<HTMLButtonElement>('[data-timeline-date="2026-11-20"]')!.click());
      expect(document.querySelector(".payment-timeline-event-list")?.textContent).toContain("событий нет");
      await act(async () => document.querySelector<HTMLButtonElement>(".payment-timeline-detail-actions button")!.click());
      expect(document.querySelectorAll(".penalty-product-option")).toHaveLength(2);
      await act(async () => document.querySelectorAll<HTMLInputElement>(".penalty-product-option input")[1].click());
      await act(async () => { document.querySelector(".penalty-form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30)); });
      expect(mock).toHaveBeenCalledExactlyOnceWith({ from_date: "2026-10-23", target_date: "2026-11-20", products: [{ product_id: "app:first", rate_source: "contract", terms_id: "terms-first" }] });
      expect(document.querySelector(".penalty-result-total")?.textContent?.replace(/\s/g, "")).toContain("400,00");
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть расчёт штрафа"]')!.click());
      await act(async () => host.querySelectorAll<HTMLButtonElement>(".calendar-presentation-switch button")[0].click());
      expect(host.querySelector('[data-date="2026-11-20"][aria-pressed="true"]')).toBeTruthy();
      expect(host.querySelector("#timeline-location")?.textContent).toContain("date=2026-11-20");
      await act(async () => host.querySelectorAll<HTMLButtonElement>(".calendar-presentation-switch button")[1].click());
      expect(host.querySelector('[data-timeline-date="2026-11-20"][aria-pressed="true"]')).toBeTruthy();
    } finally { await dispose(); }
  });
  it("moves across month boundaries by keyboard and keeps a three-month window stable when selecting days inside it", async () => {
    const { host, dispose } = await renderTimeline("/cabinet?mode=calendar&view=timeline&date=2026-11-30");
    try {
      const last = host.querySelector<HTMLButtonElement>('[data-timeline-date="2026-11-30"]')!; last.focus();
      await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(document.activeElement?.getAttribute("data-timeline-date")).toBe("2026-12-01");
      await act(async () => host.querySelectorAll<HTMLButtonElement>(".payment-timeline-range button")[1].click());
      expect(host.querySelectorAll("[data-timeline-date]")).toHaveLength(1098);
      await act(async () => host.querySelector<HTMLButtonElement>('[data-timeline-date="2027-02-20"]')!.click());
      expect(host.querySelector('[data-timeline-date="2026-12-01"]')).toBeTruthy();
      expect(host.querySelector('[data-timeline-date="2027-02-20"][aria-pressed="true"]')).toBeTruthy();
      expect(host.querySelector("#timeline-location")?.textContent).toContain("date=2027-02-20");
    } finally { await dispose(); }
  });
  it("keeps every row mounted across historical date windows and rebases offscreen dates without moving the visible date", async () => {
    const historical = {...data, accounts:[{...data.accounts[0],status:"refinanced",outstanding_principal:"0.00"},data.accounts[1]]};
    const { host, dispose } = await renderTimeline("/cabinet?mode=calendar&view=timeline&date=2026-11-20", historical);
    try {
      const scroll=host.querySelector<HTMLElement>(".payment-timeline-scroll")!;
      const ids=()=>[...host.querySelectorAll<HTMLElement>(".payment-timeline-row")].map(row=>row.dataset.productId);
      const original=ids(),node=host.querySelector('.payment-timeline-row');
      Object.defineProperties(scroll,{clientWidth:{value:1085},scrollWidth:{value:34025}});
      host.querySelector<HTMLElement>(".payment-timeline-days")!.getBoundingClientRect=()=>({width:32940} as DOMRect);
      // The leftmost visible day is ten days into the old buffer. Prepending a year
      // must add 10980px, retaining the same date on screen and the same row nodes.
      const firstBefore=host.querySelector<HTMLElement>("[data-timeline-date]")!.dataset.timelineDate!;
      scroll.scrollLeft=300;
      await act(async()=>scroll.dispatchEvent(new Event("scroll")));
      expect(scroll.scrollLeft).toBe(11280);
      expect(host.querySelector<HTMLElement>("[data-timeline-date]")!.dataset.timelineDate).not.toBe(firstBefore);
      expect(ids()).toEqual(original);
      expect(host.querySelector('.payment-timeline-row')).toBe(node);
      expect(host.querySelector('.payment-timeline-product')?.textContent).toContain("Погашен рефинансированием");
      expect(host.querySelector("#timeline-location")?.textContent).toContain("date=2026-11-20");
      await act(async()=>host.querySelector<HTMLButtonElement>('[data-timeline-date="2026-10-31"]')!.click());
      expect(host.querySelector('[data-timeline-date="2026-10-31"][aria-pressed="true"]')).toBeTruthy();
    } finally { await dispose(); }
  });
  it("opens the exact clicked product among twenty rows, and scopes day events and penalties to that row", async () => {
    const accounts = Array.from({ length: 20 }, (_, index) => ({ ...data.accounts[0], application_id: `product-${index}`, product_id: index === 19 ? "overdraft" : "working_capital_loan", amount: `${(index + 1) * 10000}.00`, outstanding_principal: index === 19 ? "0.00" : `${(index + 1) * 10000}.00` }));
    const calendarData = { ...data, accounts, events: [{ ...data.events[1], application_id: "product-18", title: "Платёж девятнадцатого кредита" }, { ...data.events[1], event_id: "other", application_id: "product-0", title: "Платёж другого кредита" }], penalty_terms: [] };
    const { host, dispose } = await renderTimeline("/cabinet?mode=calendar&view=timeline&date=2026-11-15", calendarData);
    try {
      const labels = host.querySelectorAll<HTMLButtonElement>(".payment-timeline-product");
      expect(labels).toHaveLength(20);
      expect([...labels].every(button => !button.textContent?.includes("№"))).toBe(true);
      expect(host.querySelector(".payment-timeline-open-details")).toBeNull();
      const overdraft = [...labels].find(button => button.getAttribute("aria-label")?.includes("Овердрафт"))!;
      await act(async () => overdraft.click());
      expect(document.querySelector(".timeline-inspector h2")?.textContent).toBe("Овердрафт");
      expect(document.querySelector(".timeline-inspector")?.textContent).toContain("200");
      expect(document.querySelector(".timeline-inspector")?.textContent).not.toContain("Платёж девятнадцатого кредита");
      const marker = host.querySelector<HTMLButtonElement>('[data-product-id="app:product-18"] .payment-timeline-milestone')!;
      await act(async () => marker.click());
      expect(document.querySelector(".timeline-inspector")?.textContent).toContain("Платёж девятнадцатого кредита");
      expect(document.querySelector(".timeline-inspector")?.textContent).not.toContain("Овердрафт");
      expect(document.querySelector(".timeline-inspector")?.textContent).not.toContain("Платёж другого кредита");
      const close = document.querySelector<HTMLButtonElement>('[aria-label="Закрыть подробности"]')!;
      await act(async () => { close.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(document.querySelector(".timeline-inspector")).toBeNull();
      for (let attempt=0; attempt<50 && document.activeElement !== marker; attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(document.activeElement).toBe(marker);
      await act(async () => overdraft.click());
      expect(document.querySelector(".timeline-inspector h2")?.textContent).toBe("Овердрафт");
    } finally { await dispose(); }
  });

});
