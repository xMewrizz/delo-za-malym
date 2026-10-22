import { z } from "zod";
import { apiRequest } from "@/shared/api/client";
import {
  flowDaysSchema,
  type ApplicationView,
  type Offer,
} from "./applications";

const flow = z.object({
  status: z.string(),
  daily: flowDaysSchema,
  minimum_cash: z.string().optional(),
  minimum_cash_without_financing: z.string().optional(),
  cash_reserve: z.string().optional(),
  closing_cash: z.string().optional(),
  issues: z.array(z.object({ message: z.string() })).optional(),
});
export const loanCashFlowSchema = z.object({
  funding_date: z.string(),
  schedule: z.array(
    z.object({
      date: z.string(),
      month_number: z.number(),
      total_payment: z.string(),
      principal_payment: z.string(),
      interest_payment: z.string(),
      closing_balance: z.string(),
    }),
  ),
  cash_flow: flow,
  scenario_cash_flow: flow.optional(),
  projected_plan: z.record(z.string(), z.unknown()).optional(),
  changes: z
    .array(z.object({ before: z.string(), after: z.string() }))
    .optional(),
});
export function getLoanCashFlow(
  view: ApplicationView,
  explorationId: string,
  option: Offer,
  delay?: { transaction_id: string; days: number },
) {
  const query = new URLSearchParams({
    base_application_version: String(view.application.application_version),
  });
  if (delay) {
    query.set("transaction_id", delay.transaction_id);
    query.set("delay_days", String(delay.days));
  }
  return apiRequest(
    `/applications/${view.application.application_id}/explorations/${explorationId}/options/${option.option_id}/cash-flow?${query}`,
    loanCashFlowSchema,
  );
}
