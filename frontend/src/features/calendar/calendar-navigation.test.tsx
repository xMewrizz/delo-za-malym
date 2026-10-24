// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PaymentCalendar } from "./payment-calendar";

vi.mock("@/shared/api/client", async original => ({ ...await original<typeof import("@/shared/api/client")>(), apiRequest: vi.fn(async (path: string) => path === "/profile" ? { company_name: "Компания", financials: { existing_loans: [] } } : {
  today: "2026-10-23", accounts: [{ application_id: "one", product_id: "working_capital_loan", amount: "500000.00", opened_at: "2026-10-23", outstanding_principal: "500000.00", status: "active" }], plans: [],
  events: [
    { application_id: "one", event_id: "payment", date: "2026-11-22", amount: "40000.00", direction: "outflow", forecast: true, kind: "loan_payment", title: "Платёж по кредиту" },
    { application_id: "overdraft", event_id: "prediction", date: "2026-10-31", amount: "200000.00", direction: "outflow", forecast: true, kind: "overdraft_repayment", title: "Прогноз использования овердрафта" },
  ],
}) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Location() { return <output id="test-location">{useLocation().search}</output>; }
async function until(test: () => unknown) { for (let i = 0; i < 60; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (test()) return; } throw new Error("Calendar did not settle"); }
describe("calendar navigation", () => {
  it("automatically switches between the week list and month grid without losing the date or product", async () => {
    const media = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal("matchMedia", () => media);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={["/cabinet?mode=calendar&date=2026-11-01&product=app:one&view=month"]}><QueryClientProvider client={client}><PaymentCalendar/><Location/></QueryClientProvider></MemoryRouter>));
      await until(() => document.querySelector(".calendar-week-list"));
      expect(document.querySelectorAll(".calendar-week-list>section")).toHaveLength(7);
      expect(document.querySelector(".calendar-week-list")?.textContent).toContain("26 октября");
      expect(document.querySelector(".payment-calendar-grid")).toBeNull();
      expect(document.querySelector('[aria-label="Вид календаря"]')).toBeNull();
      expect(document.querySelector(".calendar-selection-strip")).toBeNull();
      expect(document.querySelectorAll(".calendar-week-selected .calendar-penalty-entry button")).toHaveLength(1);
      await act(async () => { media.matches = false; media.dispatchEvent(new Event("change")); });
      expect(document.querySelector('[data-date="2026-11-01"][aria-pressed="true"]')).toBeTruthy();
      expect(document.querySelector(".calendar-week-list")).toBeNull();
      expect(document.querySelector(".calendar-day-details .calendar-penalty-entry button")?.textContent).toBe("Рассчитать штраф");
      expect(new URLSearchParams(document.querySelector("#test-location")?.textContent || "").get("product")).toBe("app:one");
      await act(async () => { media.matches = true; media.dispatchEvent(new Event("change")); });
      expect(document.querySelector(".calendar-week-selected>button")?.getAttribute("aria-pressed")).toBe("true");
      expect(document.querySelector(".calendar-week-selected>button")?.textContent).toContain("1 ноября");
      const penalty=document.querySelector<HTMLButtonElement>(".calendar-week-selected .calendar-penalty-entry button")!;
      await act(async()=>penalty.click());
      expect(document.querySelector('[role="dialog"]')).toBeTruthy();
      expect(document.querySelector("#penalty-target")?.textContent).toContain("1 ноября");
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); }
  });
  it("uses a month grid on desktop even for an old list link", async () => {
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const client=new QueryClient();
    try {
      await act(async()=>root.render(<MemoryRouter initialEntries={["/cabinet?mode=calendar&date=2026-11-22&view=list"]}><QueryClientProvider client={client}><PaymentCalendar/></QueryClientProvider></MemoryRouter>));
      await until(()=>document.querySelector(".payment-calendar-grid"));
      expect(document.querySelector(".calendar-week-list")).toBeNull();
      expect(document.querySelectorAll(".calendar-day-details .calendar-penalty-entry button")).toHaveLength(1);
      expect(document.querySelector('[data-date="2026-11-22"][aria-pressed="true"]')).toBeTruthy();
    } finally {await act(async()=>root.unmount());client.clear();host.remove();}
  });
  it.each(["2026-12-15", "2026-02-30"])("opens an exact linked date or rejects an impossible date: %s", async date => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () => root.render(<MemoryRouter initialEntries={[`/cabinet?mode=calendar&product=app:one&date=${date}`]}><QueryClientProvider client={client}><PaymentCalendar /><Location /></QueryClientProvider></MemoryRouter>));
      await until(() => document.querySelector('button[data-date="' + (date === "2026-12-15" ? date : "2026-11-22") + '"][aria-pressed="true"]'));
      expect(document.body.textContent).not.toContain("Invalid Date");
      const closest = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "К ближайшему платежу")!;
      await act(async () => closest.click());
      expect(document.querySelector('[data-date="2026-11-22"][aria-pressed="true"]')).toBeTruthy();
      expect(document.querySelector("#test-location")?.textContent).toContain("date=2026-11-22");
      expect(document.querySelector(".calendar-day-details")?.textContent).toContain("Платёж по кредиту");
      expect(document.querySelector(".payment-calendar-grid")?.textContent).not.toContain("Прогноз использования овердрафта");
      const link = document.querySelector<HTMLAnchorElement>(".calendar-detail-event a");
      expect(link?.getAttribute("href")).toContain("manage=one&action=repay");
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
  });
});
