import {z} from "zod";
import {apiRequest} from "@/shared/api/client";

const capacitySchema=z.object({
  calculated_at:z.string(), preliminary:z.literal(true), products:z.array(z.object({
    product_id:z.string(),status:z.enum(["available","unavailable","plan_required","selection_required"]),
    maximum_amount:z.string().nullable(),available_monthly_payment:z.string().nullable(),
    terms:z.array(z.object({term_months:z.number(),maximum_amount:z.string()})),
    reasons:z.array(z.object({message:z.string()})), rules_fingerprint:z.string(),
  })),
});
export type FinancingCapacity=z.infer<typeof capacitySchema>;
export type ProductCapacity=FinancingCapacity["products"][number];
export const getFinancingCapacity=(signal?:AbortSignal,grace=0)=>apiRequest(`/profile/financing-capacity?principal_grace_months=${grace}`,capacitySchema,{signal});
