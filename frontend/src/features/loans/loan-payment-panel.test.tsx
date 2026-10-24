// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LoanPaymentPanel } from "./loan-payment-panel";
import { getLoan, payLoan, previewLoanPayment, cancelLoanOrder } from "./api";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), getLoan: vi.fn(), payLoan: vi.fn(), previewLoanPayment: vi.fn(), cancelLoanOrder: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const row = { date: "2026-11-23", total_payment: "40000.00", principal_payment: "30000.00", interest_payment: "10000.00" };
const state: Awaited<ReturnType<typeof getLoan>> = { application_id: "one", version: 1, principal: "500000.00", original_amount: "500000.00", accrued_interest: "0.00", amount_to_close: "500000.00", annual_rate_percent: "24.00", status: "active", today: "2026-10-23", schedule: [row], operations: [], orders: [], mode: "simulated" };
const quote: Awaited<ReturnType<typeof previewLoanPayment>> = { amount: "100000.00", principal_paid: "100000.00", interest_paid: "0.00", remaining_principal: "400000.00", remaining_interest: "0.00", cash_after: "700000.00", can_pay: true, schedule: [row], next_payment: row, base_loan_version: 1, calculated_on: "2026-10-23", execution_date: "2026-10-23", payment_kind: "early", strategy: "reduce_payment", full_repayment: false, mandatory_date: row.date, mandatory_before: "50000.00", mandatory_after: row.total_payment, interest_saving: "10000.00", maturity_before: row.date, maturity_after: row.date };
async function until(test: () => unknown) { for (let i = 0; i < 60; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); if (test()) return; } throw new Error("Payment UI did not reach the expected state"); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text)!;

describe("loan payment flow", () => {
  it("shows a dedicated full repayment review without a new schedule or a zero mandatory payment, and pays only after confirmation", async () => {
    localStorage.clear(); vi.clearAllMocks();
    const fullState = {...state, accrued_interest: "258.06", amount_to_close: "500258.06"};
    vi.mocked(getLoan).mockResolvedValue(fullState);
    vi.mocked(previewLoanPayment).mockResolvedValue({...quote, amount: "500258.06", principal_paid: "500000.00", interest_paid: "258.06", remaining_principal: "0.00", cash_after: "299741.94", next_payment: null, schedule: [], full_repayment: true, mandatory_after: "0.00", maturity_after: state.today});
    vi.mocked(payLoan).mockImplementation(async (_id, payload) => ({...fullState, principal: "0.00", accrued_interest: "0.00", amount_to_close: "0.00", status: "closed", schedule: [], operations: [{operation_id: "full-close", request_id: payload.request_id, date: state.today, amount: payload.amount, principal_paid: "500000.00", interest_paid: "258.06"}]}));
    const host = document.createElement("div"); host.className = "cabinet-shell"; document.body.append(host);
    const root = createRoot(host), client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><LoanPaymentPanel applicationId="one" /></QueryClientProvider></MemoryRouter>));
      await until(() => host.querySelector('input[value="full"]'));
      await act(async () => host.querySelector<HTMLInputElement>('input[value="full"]')!.click());
      expect(button("Проверить сумму погашения")).toBeTruthy();
      expect(button("Рассчитать новый график")).toBeUndefined();
      expect(host.querySelector("#loan-payment-one")).toBeNull();
      await act(async () => button("Проверить сумму погашения").click());
      await until(() => host.querySelector(".loan-close-outcome"));
      expect(previewLoanPayment).toHaveBeenCalledExactlyOnceWith("one", expect.objectContaining({full_repayment: true, amount: "500258.06"}));
      expect(host.querySelector(".loan-review-allocation")?.textContent?.replace(/\s/g, "")).toContain("258,06");
      expect(host.querySelector(".loan-review-cash")?.textContent?.replace(/\s/g, "")).toContain("299741,94");
      expect(host.querySelector(".funding-mandatory-result")).toBeNull();
      expect(host.querySelector(".funding-schedule-list")).toBeNull();
      expect(host.querySelector(".funding-payment-preview")?.textContent).toContain("Кредит будет закрыт");
      expect(host.querySelector(".loan-resources")).toBeNull();
      expect(payLoan).not.toHaveBeenCalled();
      await act(async () => button("Погасить кредит").click());
      expect(payLoan).not.toHaveBeenCalled();
      await act(async () => button("Подтвердить платёж").click());
      await until(() => host.querySelector(".operation-result"));
      expect(payLoan).toHaveBeenCalledTimes(1);
      expect(host.querySelector(".operation-result")?.textContent).toContain("Кредит погашен");
      expect(host.querySelector(".funding-operation-form")).toBeNull();
    } finally {await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.clear(); vi.resetAllMocks();}
  });
  it("recovers a server-confirmed operation after remount without another POST", async () => {
    const requestId = crypto.randomUUID();
    const payload = { amount: "100000.00", base_loan_version: 1, execution_date: state.today, calculated_on: state.today, payment_kind: "early", strategy: "reduce_payment", full_repayment: false, request_id: requestId, confirmed: true };
    localStorage.setItem("delo-pending-operation:loan:one", JSON.stringify(payload));
    vi.mocked(payLoan).mockClear();
    vi.mocked(getLoan).mockResolvedValue({ ...state, principal: "400000.00", operations: [{ operation_id: "receipt-one", request_id: requestId, date: state.today, amount: payload.amount, principal_paid: payload.amount, interest_paid: "0.00" }] });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><LoanPaymentPanel applicationId="one" /></QueryClientProvider></MemoryRouter>));
      await until(() => document.querySelector(".operation-result"));
      expect(document.body.textContent).toContain("Платёж выполнен");
      expect(vi.mocked(payLoan)).not.toHaveBeenCalled();
      expect(localStorage.getItem("delo-pending-operation:loan:one")).toBeNull();
      expect(document.querySelector(".funding-operation-form")).toBeNull();
      await act(async () => button("Другая операция").click());
      const history = document.querySelector<HTMLButtonElement>('[aria-controls="loan-history-one"]')!;
      await act(async () => history.click());
      expect(history.getAttribute("aria-expanded")).toBe("true");
      await act(async () => button("Квитанция").click());
      expect(document.querySelector(".operation-result")?.textContent).toContain("receipt-one");
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); localStorage.removeItem("delo-pending-operation:loan:one"); }
  });
  it("distinguishes a future instruction from a completed payment and acknowledges cancellation", async () => {
    vi.mocked(getLoan).mockResolvedValue(state);
    vi.mocked(previewLoanPayment).mockResolvedValue({ ...quote, execution_date: "2026-10-24" });
    const order = { order_id: "order-one", request_id: "", amount: "100000.00", execution_date: "2026-10-24", payment_kind: "early" as const, strategy: "reduce_payment" as const, status: "pending" as const };
    vi.mocked(payLoan).mockImplementation(async (_id, payload) => ({ ...state, version: 2, orders: [{ ...order, request_id: payload.request_id }] }));
    vi.mocked(cancelLoanOrder).mockResolvedValue({ ...state, version: 3, orders: [{ ...order, status: "cancelled" }] });
    const host = document.createElement("div"); host.className = "cabinet-shell"; document.body.append(host);
    const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><LoanPaymentPanel applicationId="one" /></QueryClientProvider></MemoryRouter>));
      await until(() => document.querySelector("#loan-payment-one"));
      await act(async () => document.querySelector<HTMLButtonElement>("#loan-date-one")!.click());
      await act(async () => document.querySelector<HTMLButtonElement>('[data-date="2026-10-24"]')!.click());
      const input = document.querySelector<HTMLInputElement>("#loan-payment-one")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "100000"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await until(() => button("Запланировать платёж"));
      await act(async () => button("Запланировать платёж").click());
      await act(async () => button("Запланировать").click());
      await until(() => document.querySelector(".operation-result"));
      expect(document.querySelector(".operation-result")?.textContent).toContain("Платёж запланирован");
      expect(document.querySelector(".operation-result")?.textContent).not.toContain("Платёж выполнен");
      expect(document.querySelector("#loan-payment-one")).toBeNull();
      await act(async () => button("Показать запланированный платёж").click());
      expect(document.querySelector(".funding-pending-order")).toBeTruthy();
      await act(async () => button("Отменить платёж").click());
      await until(() => document.querySelector(".operation-result")?.textContent?.includes("Платёж отменён"));
      expect(cancelLoanOrder).toHaveBeenCalledWith("one", "order-one", 2);
      expect(document.querySelector(".operation-result")?.textContent).toContain("Деньги не списывались");
      expect(vi.mocked(payLoan).mock.calls).toHaveLength(1);
    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.resetAllMocks(); }
  });
  it("previews before confirmation and retries an uncertain payment with the same request ID", async () => {
    vi.mocked(getLoan).mockResolvedValue(state);
    vi.mocked(previewLoanPayment).mockResolvedValue(quote);
    vi.mocked(payLoan).mockRejectedValueOnce(new TypeError("Lost response")).mockResolvedValueOnce({ ...state, version: 2, principal: "400000.00", amount_to_close: "400000.00", operations: [{ operation_id: "paid", date: "2026-10-23", amount: "100000.00", principal_paid: "100000.00", interest_paid: "0.00" }] });
    const host = document.createElement("div"); host.className = "cabinet-shell"; document.body.append(host);
    const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const done = vi.fn();
    try {
      await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><Dialog.Root defaultOpen><Dialog.Portal><Dialog.Content><Dialog.Title>Кредит</Dialog.Title><Dialog.Description>Управление продуктом</Dialog.Description><LoanPaymentPanel applicationId="one" onDone={done} /></Dialog.Content></Dialog.Portal></Dialog.Root></QueryClientProvider></MemoryRouter>));
      await until(() => document.querySelector("#loan-payment-one"));
      const input = document.querySelector<HTMLInputElement>("#loan-payment-one")!;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "100 000"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await until(() => document.querySelector(".funding-payment-preview"));
      expect(previewLoanPayment).toHaveBeenCalledWith("one", { amount: "100000.00", base_loan_version: 1, execution_date: "2026-10-23", payment_kind: "early", strategy: "reduce_payment", full_repayment: false });
      expect(document.querySelector("form")?.hidden).toBe(true);
      expect(document.querySelector(".funding-mandatory-result")?.textContent).toContain("Его нужно внести отдельно");
      expect(payLoan).not.toHaveBeenCalled();
      await act(async () => button("Внести платёж").click());
      expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
      expect(payLoan).not.toHaveBeenCalled();
      await act(async () => button("Подтвердить платёж").click());
      await until(() => button("Проверить и повторить этот платёж"));
      expect(input.disabled).toBe(true);
      await act(async () => button("Проверить и повторить этот платёж").click());
      await until(() => document.querySelector(".funding-success"));
      expect(vi.mocked(payLoan).mock.calls).toHaveLength(2);
      expect(vi.mocked(payLoan).mock.calls[1]).toEqual(vi.mocked(payLoan).mock.calls[0]);
      expect(document.querySelector("#loan-payment-one")).toBeNull();
      expect(document.querySelector(".funding-payment-preview")).toBeNull();
      expect(document.querySelector(".operation-result")?.textContent?.replaceAll(/\s/g, "")).toContain("400000,00");
      expect(document.activeElement).toBe(document.querySelector(".operation-result"));
      await act(async () => button("Готово").click());
      expect(done).toHaveBeenCalledTimes(1);
      await act(async () => button("Другая операция").click());
      expect(document.querySelector<HTMLInputElement>("#loan-payment-one")?.value).toBe("");
      expect(vi.mocked(payLoan).mock.calls).toHaveLength(2);

    } finally { await act(async () => root.unmount()); client.clear(); host.remove(); vi.clearAllMocks(); }
  });
});
