// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { PenaltyPlanner } from "./penalty-planner";
import { penaltyCandidates, previewPenalty, type CalendarData, type CalendarEvent } from "./api";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), previewPenalty: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const payment = (id: string, date: string, amount: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ event_id: id, application_id: id, date, amount, forecast: true, direction: "outflow", kind: "loan_payment", title: "Платёж", ...extra });

describe("payment delay planner", () => {
  it("excludes executed movements, expenses, same-day payments and overdraft forecasts", () => {
    const rows = [payment("yes", "2026-10-31", "40000.00"), payment("paid", "2026-10-31", "40000.00", { forecast: false }), payment("expense", "2026-10-31", "40000.00", { kind: "planned_expense" }), payment("od", "2026-10-31", "40000.00", { kind: "overdraft_interest" }), payment("future", "2026-11-20", "40000.00")];
    expect(penaltyCandidates(rows, "2026-10-23", "2026-11-20").map(row => row.event_id)).toEqual(["yes"]);
  });

  it.each([false, true])("uses automatic conditions and asks only for missing scenario rates: mixed=%s", async mixed => {
    const terms = { terms_id:"terms-first", version:"simple-daily-v1" as const, daily_rate_percent:"0.05", source:"demo_contract" as const, basis:"overdue_installment" as const, start_rule:"day_after_due" as const, day_count:"calendar" as const, capitalization:false as const };
    const data:CalendarData={penalty_terms:[{product_id:"app:first",...terms},...(!mixed ? [{product_id:"app:second",...terms,terms_id:"terms-second",source:"demo_policy" as const}] : [])],payment_orders:[],today:"2026-10-23",accounts:[],plans:[],events:[payment("first","2026-10-31","40000.00"),payment("second","2026-11-15","10000.00")]};
    const mock=vi.mocked(previewPenalty);mock.mockResolvedValue({from_date:"2026-10-23",target_date:"2026-11-20",missed_payments:"50000.00",total_penalty:"450.00",total_with_penalty:"50450.00",basis:mixed ? "mixed_simple_daily_rate" : "contract_simple_daily_rate",mode:"scenario",products:[{product_id:"app:first",daily_rate_percent:"0.05",rate_source:"contract",contract_source:"demo_contract",terms_id:terms.terms_id,missed_payments:"40000.00",penalty:"400.00",payments:[]}]});
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host),client=new QueryClient();
    try {
      await act(async()=>root.render(<QueryClientProvider client={client}><PenaltyPlanner calendar={data} targetDate="2026-11-20" productScope="all" products={[{id:"app:first",title:"Первый кредит",reference:"1"},{id:"app:second",title:"Второй кредит",reference:"2"}]}/></QueryClientProvider>));
      await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
      const submit=document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(document.querySelector(".penalty-contract-rates")?.textContent).toContain("Условия демо-договора");
      if(mixed) {
        expect(submit.disabled).toBe(true);
        const input=document.querySelector<HTMLInputElement>("#penalty-rate")!;
        await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"0,1");input.dispatchEvent(new Event("input",{bubbles:true}));});
      } else {
        expect(document.querySelector("#penalty-rate")).toBeNull();
        expect(document.querySelector(".penalty-contract-rates")?.textContent).toContain("Условия симулятора");
      }
      expect(submit.disabled).toBe(false);
      await act(async()=>{document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,25));});
      expect(mock).toHaveBeenCalledExactlyOnceWith({from_date:"2026-10-23",target_date:"2026-11-20",products:[{product_id:"app:first",rate_source:"contract",terms_id:"terms-first"},mixed ? {product_id:"app:second",daily_rate_percent:"0.1"} : {product_id:"app:second",rate_source:"contract",terms_id:"terms-second"}]});
      expect(document.querySelector(".penalty-result")?.textContent).toContain("условия демо-договора");
      await act(async()=>{ [...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent === "Изменить расчёт")!.click(); await new Promise(resolve=>setTimeout(resolve,25)); });
      await act(async()=>document.querySelector<HTMLInputElement>(".penalty-custom-toggle input")!.click());
      expect(document.querySelector(".penalty-result")).toBeNull();
      expect(document.querySelector("#penalty-rate")).toBeTruthy();
      if(!mixed) expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    } finally {await act(async()=>root.unmount());client.clear();host.remove();vi.clearAllMocks();}
  });
  it("requires an explicit rate, submits only checked products and clears stale results", async () => {
    const data: CalendarData = { penalty_terms: [], payment_orders: [], today: "2026-10-23", accounts: [], plans: [], events: [payment("first", "2026-10-31", "40000.00"), payment("second", "2026-11-15", "10000.00")] };
    const mock = vi.mocked(previewPenalty);
    mock.mockResolvedValue({ from_date: "2026-10-23", target_date: "2026-11-20", missed_payments: "40000.00", total_penalty: "400.00", total_with_penalty: "40400.00", basis: "user_defined_simple_daily_rate", mode: "scenario", products: [{ product_id: "app:first", daily_rate_percent: "0.05", rate_source: "manual", missed_payments: "40000.00", penalty: "400.00", payments: [{ event_id: "first", due_date: "2026-10-31", amount: "40000.00", days: 20, penalty: "400.00" }] }] });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    async function input(value: string) {
      const element = document.querySelector<HTMLInputElement>("#penalty-rate")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><PenaltyPlanner calendar={data} targetDate="2026-11-20" productScope="all" products={[{ id: "app:first", title: "Оборотный кредит", reference: "№ first" }, { id: "app:second", title: "Инвестиционный кредит", reference: "№ second" }]} /></QueryClientProvider>));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      expect(document.querySelector<HTMLInputElement>("#penalty-rate")!.value).toBe("");
      await act(async () => document.querySelectorAll<HTMLInputElement>('.penalty-product-option input')[1].click());
      await input("0,05");
      expect(submit.disabled).toBe(false);
      await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 25)); });
      expect(mock).toHaveBeenCalledWith({ from_date: "2026-10-23", target_date: "2026-11-20", products: [{ product_id: "app:first", daily_rate_percent: "0.05" }] });
      expect(document.querySelector(".penalty-result")?.textContent).toContain("20 дн.");
      expect(document.activeElement).toBe(document.querySelector(".penalty-result"));
      expect(document.querySelector(".penalty-result")?.textContent?.replaceAll(/\s/g, "")).toContain("+400,00");
      expect(document.querySelector("#penalty-rate")).toBeNull();
      await act(async () => { [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Изменить расчёт")!.click(); await new Promise(resolve=>setTimeout(resolve,25)); });
      expect(document.activeElement).toBe(document.querySelector("#penalty-target"));
      await input("0,1");
      expect(document.querySelector(".penalty-result")).toBeNull();
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.clearAllMocks(); }
  });
  it("includes already overdue obligations while excluding paid and closed products from the initial period", async () => {
    const data: CalendarData = { today: "2026-10-23", plans: [], penalty_terms: [], payment_orders: [], accounts: [{ application_id: "closed", product_id: "working_capital_loan", amount: "1000", opened_at: "2026-01-01", outstanding_principal: "0", status: "closed" }], events: [payment("first", "2026-10-10", "1000"), payment("closed", "2026-10-05", "1000"), payment("paid", "2026-10-01", "1000", { forecast: false })] };
    const host = document.createElement("div");document.body.append(host);const root = createRoot(host),client = new QueryClient();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><PenaltyPlanner calendar={data} targetDate="2026-11-20" productScope="all" products={[{ id: "app:first", title: "Кредит", reference: "first" },{ id: "app:closed", title: "Закрыт", reference: "closed" }]} /></QueryClientProvider>));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector("#penalty-from")?.textContent).toContain("10 октября");
      expect(document.querySelectorAll(".penalty-product-option")).toHaveLength(1);
      expect(document.querySelector(".penalty-product-option")?.textContent).toContain("first");
    } finally { await act(async () => root.unmount());client.clear();host.remove(); }
  });

  it("offers the first overdue day when opened on the payment date without making a calculation", async () => {
    const data: CalendarData = { today: "2026-10-23", plans: [], penalty_terms: [], payment_orders: [], accounts: [], events: [payment("first", "2026-10-31", "40000")] };
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), client = new QueryClient();
    const mock = vi.mocked(previewPenalty); mock.mockClear();
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><PenaltyPlanner calendar={data} targetDate="2026-10-31" productScope="app:first" products={[{ id: "app:first", title: "Кредит", reference: "first" }]} /></QueryClientProvider>));
      await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector('button[type="submit"]')).toBeNull();
      await act(async () => document.querySelector<HTMLButtonElement>(".penalty-no-payments button")!.click());
      expect(document.querySelector("#penalty-target")?.textContent).toContain("1 ноября");
      expect(document.querySelectorAll(".penalty-product-option")).toHaveLength(1);
      expect(mock).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });

});
