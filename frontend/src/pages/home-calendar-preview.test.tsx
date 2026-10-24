// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {describe,expect,it} from "vitest";
import {HomeCalendarPreview} from "./home-calendar-preview";
import {openingCash,promoDay,promoMonth} from "./home-cashflow-example";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
describe("cash flow promo",()=>{
 it("reconciles income, expenses and balances, including a day without operations",()=>{
  expect(promoMonth).toEqual({income:386000,expense:321240,closingCash:184760});
  expect(openingCash+promoMonth.income-promoMonth.expense).toBe(promoMonth.closingCash);
  expect(promoDay(18)).toMatchObject({income:0,expense:102240,balance:168360});
  expect(promoDay(18).operations).toHaveLength(2);
  expect(promoDay(19).balance).toBe(promoDay(18).balance);
 });
 it("shows both directions and the actual closing balance for the selected day",async()=>{
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<MemoryRouter><HomeCalendarPreview/></MemoryRouter>));
   expect(host.querySelectorAll(".ep-payment-day")).toHaveLength(30);
   expect(host.querySelectorAll(".ep-payment-empty")).toHaveLength(6);
   expect(host.querySelector('.ep-payment-day[aria-pressed="true"]')?.getAttribute("aria-label")).toContain("18 ноября");
   expect(host.querySelector('.ep-flow-day-balance')?.textContent).toBe("168 360 ₽");
   expect(host.querySelectorAll('.ep-flow-operation')).toHaveLength(2);
   expect(host.querySelector('.ep-flow-operations')?.textContent).toContain("30 240 ₽ — долг");
   const income=host.querySelector<HTMLButtonElement>('.ep-payment-day[aria-label^="17 ноября"]')!;
   await act(async()=>income.click());
   expect(host.querySelector('.ep-flow-day-balance')?.textContent).toBe("270 600 ₽");
   expect(host.querySelector('.ep-flow-operations')?.textContent).toContain("+120 000 ₽");
   expect(host.querySelector('.ep-payment-day-card a')?.getAttribute('href')).toBe('/cabinet?mode=calendar&view=calendar&date=2026-11-17');
  }finally{await act(async()=>root.unmount());}
 });
 it("switches in place to three real tracks and preserves the selected date on return",async()=>{
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<MemoryRouter><HomeCalendarPreview/></MemoryRouter>));
   const toggle=[...host.querySelectorAll<HTMLButtonElement>('.ep-payment-view-toggle button')];
   await act(async()=>toggle[1].click());
   expect(host.querySelector('.ep-payment-preview')?.getAttribute('data-view')).toBe('timeline');
   expect(host.querySelector<HTMLElement>('.ep-payment-preview-grid')?.closest<HTMLElement>('[hidden]')).toBeTruthy();
   expect(host.querySelector<HTMLElement>('.ep-payment-timeline')?.hidden).toBe(false);
   expect(host.querySelectorAll('.ep-flow-timeline-row')).toHaveLength(3);
   const payment=host.querySelector<HTMLButtonElement>('.ep-payment-timeline button[aria-label^="27 ноября"]')!;
   await act(async()=>payment.click());
   expect(host.querySelector('.ep-flow-day-heading')?.textContent).toContain('27 ноября');
   expect(host.querySelector('.ep-flow-operations')?.textContent).toContain('Кредитная линия');
   expect(host.querySelector('.ep-payment-day-card a')?.getAttribute('href')).toContain('view=timeline');
   await act(async()=>toggle[0].click());
   expect(host.querySelector<HTMLElement>('.ep-payment-timeline')?.hidden).toBe(true);
   expect(host.querySelector('.ep-payment-day[aria-pressed="true"]')?.getAttribute('aria-label')).toContain('27 ноября');
  }finally{await act(async()=>root.unmount());}
 });
 it("keeps the mobile week consistent and never replaces a balance with zero on an empty day",async()=>{
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<MemoryRouter><HomeCalendarPreview/></MemoryRouter>));
   const week=[...host.querySelectorAll<HTMLButtonElement>('.ep-payment-preview-week button')];
   expect(week).toHaveLength(7);
   await act(async()=>week[3].click());
   expect(host.querySelector('.ep-flow-day-heading')?.textContent).toContain('19 ноября');
   expect(host.querySelector('.ep-payment-no-events')?.textContent).toContain('На эту дату операций нет');
   expect(host.querySelector('.ep-flow-day-balance')?.textContent).toBe('168 360 ₽');
   expect(host.querySelector('.ep-flow-day-totals')?.textContent).toBe('Пришло0 ₽Ушло0 ₽');
  }finally{await act(async()=>root.unmount());}
 });
});
