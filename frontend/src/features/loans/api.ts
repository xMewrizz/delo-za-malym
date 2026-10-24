import { z } from "zod";
import { apiRequest } from "@/shared/api/client";

const paymentRow = z.object({ date: z.string(), total_payment: z.string(), principal_payment: z.string(), interest_payment: z.string() }).passthrough();
export const loanStateSchema = z.object({
  application_id: z.string(), version: z.number(), principal: z.string(), original_amount: z.string(),
  accrued_interest: z.string(), amount_to_close: z.string(), annual_rate_percent: z.string(),
  status: z.enum(["active", "closed"]), today: z.string(), schedule: z.array(paymentRow),
  operations: z.array(z.object({ operation_id: z.string(), request_id: z.string().optional(), date: z.string(), amount: z.string(), principal_paid: z.string(), interest_paid: z.string() })),
  orders: z.array(z.object({ order_id: z.string(), request_id: z.string().optional(), amount: z.string(), execution_date: z.string(),
    full_repayment: z.boolean().optional(), payment_kind: z.enum(["early", "regular"]), strategy: z.enum(["reduce_payment", "reduce_term"]),
    status: z.enum(["pending", "executed", "failed", "cancelled"]), error: z.string().optional() })).default([]),
  mode: z.literal("simulated"),
});
const previewSchema = z.object({
  amount: z.string(), principal_paid: z.string(), interest_paid: z.string(), remaining_principal: z.string(),
  remaining_interest: z.string(), cash_after: z.string(), can_pay: z.boolean(), schedule: z.array(paymentRow),
  base_loan_version: z.number(), calculated_on: z.string(), next_payment: paymentRow.nullable(),
  execution_date: z.string(), payment_kind: z.enum(["early", "regular"]), strategy: z.enum(["reduce_payment", "reduce_term"]), full_repayment: z.boolean(),
  mandatory_date: z.string().nullable(), mandatory_before: z.string(), mandatory_after: z.string(),
  interest_saving: z.string(), maturity_before: z.string().nullable(), maturity_after: z.string(),
});
export type LoanPreviewRequest = { amount: string; base_loan_version: number; execution_date: string; payment_kind: "early" | "regular"; strategy: "reduce_payment" | "reduce_term"; full_repayment: boolean };
export type LoanPaymentRequest = LoanPreviewRequest & { request_id: string; calculated_on: string; confirmed: true };
export const loanKey = (id: string) => ["loan-servicing", id] as const;
export const getLoan = (id: string, signal?: AbortSignal) => apiRequest(`/applications/${id}/loan`, loanStateSchema, { signal });
export const previewLoanPayment = (id: string, payload: LoanPreviewRequest) => apiRequest(`/applications/${id}/loan/preview`, previewSchema, { method: "POST", body: JSON.stringify(payload) });
export const payLoan = (id: string, payload: LoanPaymentRequest) => apiRequest(`/applications/${id}/loan/payments`, loanStateSchema, { method: "POST", body: JSON.stringify(payload) });
export const cancelLoanOrder = (id: string, orderId: string, version: number) => apiRequest(`/applications/${id}/loan/orders/${orderId}/cancel`, loanStateSchema, { method: "POST", body: JSON.stringify({ base_loan_version: version }) });

export const loanRequestSchema: z.ZodType<LoanPaymentRequest> = z.object({ amount: z.string(), base_loan_version: z.number(), execution_date: z.string(), payment_kind: z.enum(["early", "regular"]), strategy: z.enum(["reduce_payment", "reduce_term"]), full_repayment: z.boolean(), request_id: z.string().uuid(), calculated_on: z.string(), confirmed: z.literal(true) });
