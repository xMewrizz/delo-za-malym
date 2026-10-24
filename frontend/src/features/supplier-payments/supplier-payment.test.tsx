// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, it, expect, vi } from "vitest";
import { SupplierPaymentForm } from "./supplier-payment";
import { emptySupplier, paySupplier, previewSupplier, requisiteErrors, supplierAccountKey, type SupplierReceipt } from "./api";
vi.mock("./api", async original => ({...await original<typeof import("./api")>(), paySupplier: vi.fn(), previewSupplier: vi.fn()}));
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const fields = {...emptySupplier, recipient_name: "ООО Поставка", recipient_inn: "7707083893", recipient_account: "40702810200000000001", recipient_bik: "044525225", amount: "400000.00", invoice_number: "148", purpose: "Оплата товара без НДС"};
const quote = {amount: fields.amount, own_money: "300000.00", overdraft_used: "100000.00", shortfall: "0.00", can_pay: true, cash_after: "0.00", upcoming_total: "5000.00", upcoming_until: "2026-11-22", cash_after_upcoming: "-5000.00", upcoming_payments: [{date: "2026-11-10", amount: "5000.00", title: "Платёж по кредиту"}], account_version: "a".repeat(64), calculated_on: "2026-10-23", overdraft_application_id: "od-one", overdraft_rate: "24.00", overdraft_daily_interest: "65.75", overdraft_repay_by: "2026-12-22"};
const receipt: SupplierReceipt = {payment_id: "payment-one", request_id: "11223344-1234-4234-8234-112233445566", request: fields, date: "2026-10-23", created_at: "2026-10-23T12:00:00+03:00", quote, mode: "simulated"};
async function until(check: () => unknown) {for (let i = 0; i < 80; i++) {await act(async () => {await new Promise(resolve => setTimeout(resolve, 10));}); if (check()) return;} throw new Error("UI did not update");}

describe("supplier payment flow", () => {
  it("checks recipient account and INN, including their control digits", () => {
    expect(requisiteErrors(fields)).toEqual({});
    expect(requisiteErrors({...fields, recipient_inn: "0000000000"}).recipient_inn).toBeTruthy();
    expect(requisiteErrors({...fields, recipient_account: "40702810000000000001"}).recipient_account).toContain("БИК");
  });
  it.each([false, true])("guides through the invoice and requisites, blocks insufficient funds=%s and requires confirmation", async insufficient => {
    localStorage.clear(); vi.mocked(paySupplier).mockReset(); vi.mocked(previewSupplier).mockReset();
    vi.mocked(previewSupplier).mockResolvedValue(insufficient ? {...quote, shortfall: "50000.00", can_pay: false} : quote);
    vi.mocked(paySupplier).mockImplementation(async payload => ({...receipt, request_id: payload.request_id}));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({defaultOptions: {queries: {enabled: false, retry: false}}});
    client.setQueryData(supplierAccountKey, {cash_balance: "300000.00", account_version: quote.account_version, today: quote.calculated_on, overdraft: {application_id: "od-one", available_limit: "150000.00", annual_rate_percent: "24.00"}, payments: []});
    const fill = (id: string, value: string) => act(async () => {const input = host.querySelector<HTMLInputElement>(`#${id}`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", {bubbles: true}));});
    const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
    const click = (text: string) => act(async () => button(text).click());
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><SupplierPaymentForm /></QueryClientProvider></MemoryRouter>));
      expect(host.querySelectorAll(".supplier-steps li")).toHaveLength(3);
      expect(host.querySelector("#supplier-account")).toBeNull();
      await click("Далее: реквизиты"); expect(host.querySelector('[role="alert"]')).toBeTruthy();
      await fill("supplier-name", fields.recipient_name); await fill("supplier-amount", "400 000"); await fill("supplier-number", fields.invoice_number); await fill("supplier-purpose", fields.purpose);
      await click("Далее: реквизиты");
      expect(host.querySelector("h3")?.textContent).toBe("Куда перевести деньги");
      await click("Проверить платёж"); expect(previewSupplier).not.toHaveBeenCalled();
      await fill("supplier-inn", fields.recipient_inn); await fill("supplier-account", fields.recipient_account); await fill("supplier-bik", fields.recipient_bik);
      await click("Назад"); expect(host.querySelector<HTMLInputElement>("#supplier-name")?.value).toBe(fields.recipient_name);
      await click("Далее: реквизиты"); await click("Проверить платёж"); await until(() => host.querySelector(".supplier-review"));
      expect(previewSupplier).toHaveBeenCalledExactlyOnceWith(fields, quote.account_version);
      expect(paySupplier).not.toHaveBeenCalled();
      expect(host.textContent).toContain("65,75"); if (!insufficient) expect(host.textContent).toContain("К этим платежам нужно добавить");
      if (insufficient) {
        expect(button("Подобрать финансирование")).toBeTruthy();
        expect([...host.querySelectorAll("button")].some(item => item.textContent?.startsWith("Оплатить "))).toBe(false);
        expect(localStorage.getItem("delo-supplier-invoice")).toContain(fields.recipient_name);
      } else {
        const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.startsWith("Оплатить "))!;
        await act(async () => confirm.click()); await until(() => host.querySelector(".operation-result"));
        expect(paySupplier).toHaveBeenCalledTimes(1);
        expect(vi.mocked(paySupplier).mock.calls[0][0]).toEqual(expect.objectContaining({...fields, confirmed: true, calculated_on: quote.calculated_on}));
        expect(host.textContent).toContain("Демо-платёж выполнен"); expect(host.textContent).toContain(fields.recipient_account);
        expect(host.querySelector("form")).toBeNull();
        expect(localStorage.getItem("delo-supplier-invoice")).toBeNull();
      }
    } finally {await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.clear();}
  });
  it.each([true, false])("recovers the exact request after an interrupted response, already recorded=%s", async recorded => {
    localStorage.clear(); vi.mocked(paySupplier).mockReset(); vi.mocked(paySupplier).mockResolvedValue(receipt);
    const request = {...fields, base_account_version: quote.account_version, request_id: receipt.request_id, calculated_on: quote.calculated_on, confirmed: true};
    localStorage.setItem("delo-pending-operation:supplier-payment", JSON.stringify(request));
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({defaultOptions: {queries: {enabled: false, retry: false}}});
    client.setQueryData(supplierAccountKey, {cash_balance: "0.00", account_version: quote.account_version, today: quote.calculated_on, overdraft: null, payments: recorded ? [receipt] : []});
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><SupplierPaymentForm /></QueryClientProvider></MemoryRouter>));
      if (!recorded) {expect(host.querySelector("form")).toBeNull(); await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === "Повторить тот же запрос")!.click());}
      await until(() => host.querySelector(".operation-result"));
      if (recorded) expect(paySupplier).not.toHaveBeenCalled(); else expect(paySupplier).toHaveBeenCalledExactlyOnceWith(request, expect.anything());
      expect(localStorage.getItem("delo-pending-operation:supplier-payment")).toBeNull();
    } finally {await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.clear();}
  });
});
