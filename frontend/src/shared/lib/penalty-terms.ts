import { z } from "zod";
export const penaltyTermsSchema = z.object({
  terms_id: z.string(), version: z.literal("simple-daily-v1"), daily_rate_percent: z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/).refine(value => Number(value) <= 100),
  source: z.enum(["demo_contract", "bank_contract", "demo_policy"]), basis: z.literal("overdue_installment"),
  start_rule: z.literal("day_after_due"), day_count: z.literal("calendar"), capitalization: z.literal(false),
}).strict();
export const calendarPenaltyTermsSchema = penaltyTermsSchema.extend({ product_id: z.string() });
export const penaltySourceLabel = (source?: string | null) => source === "demo_contract" ? "Условия демо-договора" : source === "bank_contract" ? "Условия договора банка" : source === "demo_policy" ? "Условия симулятора" : "Ставка задана вами";
export const penaltyRateLabel = (value: string) => `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 6 })}% в день`;
