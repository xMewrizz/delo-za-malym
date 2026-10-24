import { z } from "zod";
import { apiRequest } from "@/shared/api/client";

export const lineSchema = z.object({
  application_id: z.string(), limit: z.string(), principal: z.string(), accrued_interest: z.string(),
  amount_to_close: z.string(), available_limit: z.string(), capacity_reserve: z.string(),
  annual_rate_percent: z.string(), maturity_date: z.string(), version: z.number(),
  status: z.enum(["active", "closed", "expired"]), matured: z.boolean(), overdue_interest: z.boolean(),
  interest_due: z.string(), interest_due_date: z.string().nullable(),
  schedule: z.array(z.object({ date: z.string(), total_payment: z.string(), principal: z.string(), interest: z.string() })),
  operations: z.array(z.object({ operation_id: z.string(), request_id: z.string(), kind: z.string(), date: z.string(), amount: z.string(), principal_paid: z.string(), interest_paid: z.string() })),
});
export type LineOperation = { kind: "draw" | "repay" | "close"; amount?: string; base_line_version: number; request_id: string };
export const lineKey = (id: string) => ["credit-line", id] as const;
export const getLine = (id: string, signal?: AbortSignal) => apiRequest(`/applications/${id}/credit-line`, lineSchema, { signal });
export const postLineOperation = (id: string, operation: LineOperation) => apiRequest(`/applications/${id}/credit-line/operations`, lineSchema,
  { method: "POST", body: JSON.stringify({ ...operation, confirmed: true }) });

export const lineOperationSchema: z.ZodType<LineOperation> = z.object({ kind: z.enum(["draw", "repay", "close"]), amount: z.string().optional(), base_line_version: z.number(), request_id: z.string().uuid() });
