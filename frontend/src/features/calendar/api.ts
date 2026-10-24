import { supplierReceiptSchema } from "@/features/supplier-payments/api";
import { z } from "zod";
import { calendarPenaltyTermsSchema } from "@/shared/lib/penalty-terms";
import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/client";
import { calendarKey } from "./keys";

export const eventSchema = z.object({
  supplier_payment: supplierReceiptSchema.optional(),
  event_id: z.string(), application_id: z.string(), loan_id: z.string().optional(), date: z.string(), amount: z.string(),
  principal_amount: z.string().optional(), interest_amount: z.string().optional(),
  direction: z.enum(["inflow", "outflow", "none"]), kind: z.string(), title: z.string(), forecast: z.boolean(),
});
export const calendarSchema = z.object({
  penalty_terms: z.array(z.unknown()).transform(items => items.flatMap(item => { const parsed = calendarPenaltyTermsSchema.safeParse(item); return parsed.success ? [parsed.data] : []; })).default([]),
  payment_orders: z.array(z.object({ order_id: z.string(), application_id: z.string(), product_id: z.string(), amount: z.string(), execution_date: z.string(), status: z.enum(["pending", "executed", "failed", "cancelled"]), error: z.string().optional() })).default([]),
  today: z.string(), events: z.array(eventSchema),
  plans: z.array(z.object({ application_id: z.string(), state: z.string(), amount: z.string().nullable(), events: z.array(eventSchema) })),
  accounts: z.array(z.object({ application_id: z.string(), product_id: z.string(), amount: z.string(), opened_at: z.string(), outstanding_principal: z.string(), annual_rate_percent: z.string().nullable().optional(), accrued_interest: z.string().nullable().optional(), available_limit: z.string().optional(), status: z.string().optional(), refinanced_by: z.string().nullable().optional(), maturity_date: z.string().nullable().optional() })),
});
export type CalendarEvent = z.infer<typeof eventSchema>;
export type CalendarData = z.infer<typeof calendarSchema>;
export const calendarQuery = queryOptions({ queryKey: calendarKey, refetchInterval: 30000, queryFn: ({ signal }) => apiRequest("/calendar", calendarSchema, { signal }) });

export function filterProductEvents(events: CalendarEvent[], product: string): CalendarEvent[] {
  if (product === "all") return events;
  if (product.startsWith("loan:")) return events.filter(event => event.loan_id === product.slice(5));
  if (product.startsWith("app:")) return events.filter(event => event.application_id === product.slice(4));
  return [];
}

const penaltyPaymentSchema = z.object({ event_id: z.string(), due_date: z.string(), amount: z.string(), days: z.number(), penalty: z.string() });
const penaltyPreviewSchema = z.object({
  from_date: z.string(), target_date: z.string(), missed_payments: z.string(), total_penalty: z.string(), total_with_penalty: z.string(),
  basis: z.enum(["user_defined_simple_daily_rate", "contract_simple_daily_rate", "mixed_simple_daily_rate"]), mode: z.literal("scenario"),
  products: z.array(z.object({ product_id: z.string(), daily_rate_percent: z.string(), rate_source: z.enum(["manual", "contract"]).default("manual"), terms_id: z.string().nullable().optional(), contract_source: z.enum(["demo_contract", "bank_contract", "demo_policy"]).nullable().optional(), missed_payments: z.string(), penalty: z.string(), payments: z.array(penaltyPaymentSchema) })),
});
export type PenaltyPreviewRequest = { from_date: string; target_date: string; products: ({ product_id: string } & ({ rate_source: "contract"; terms_id: string; daily_rate_percent?: never } | { rate_source?: "manual"; daily_rate_percent: string; terms_id?: never }))[] };
export const previewPenalty = (payload: PenaltyPreviewRequest) => apiRequest("/calendar/penalty-preview", penaltyPreviewSchema, { method: "POST", body: JSON.stringify(payload) });

const penaltyKinds = new Set(["loan_payment", "loan_final_payment", "existing_loan_payment", "line_interest", "line_final_payment", "overdraft_payment_due"]);
export const isDebtObligation = (event: CalendarEvent) => event.forecast && event.direction === "outflow" && penaltyKinds.has(event.kind);
export function penaltyCandidates(events: CalendarEvent[], from: string, to: string) {
  return events.filter(event => isDebtObligation(event) && event.date >= from && event.date < to && Number(event.amount) > 0);
}
export const eventProductKey = (event: CalendarEvent) => event.application_id ? `app:${event.application_id}` : `loan:${event.loan_id || ""}`;
