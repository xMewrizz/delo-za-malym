import { z } from "zod";
import { apiRequest } from "@/shared/api/client";

const operation = z.object({ operation_id:z.string(), request_id:z.string().optional(), kind:z.enum(["expense","receipt","auto_repayment"]), amount:z.string(), date:z.string(), drawn:z.string(), principal_paid:z.string(), interest_paid:z.string() });
const stateSchema = z.object({ application_id:z.string(), account_version:z.string(), version:z.number(), limit:z.string(), available_limit:z.string(), principal:z.string(), accrued_interest:z.string(), amount_to_repay:z.string(), annual_rate_percent:z.string(), interest_per_day:z.string(), cash_balance:z.string(), maturity_date:z.string(), repay_by:z.string().nullable(), max_debt_days:z.number(), blocked:z.boolean(), status:z.string(), today:z.string(), operations:z.array(operation) });
const quoteSchema = z.object({ kind:z.enum(["expense","receipt"]), amount:z.string(), purpose:z.enum(["supplier","payroll","tax","operating","revenue"]), own_money:z.string(), overdraft_used:z.string(), principal_paid:z.string(), interest_paid:z.string(), allocations:z.array(z.object({application_id:z.string(),principal_paid:z.string(),interest_paid:z.string()})), cash_after:z.string(), principal_after:z.string(), available_after:z.string(), account_version:z.string(), calculated_on:z.string() });
export const overdraftOperationSchema = z.object({ base_account_version:z.string(), kind:z.enum(["expense","receipt"]), amount:z.string(), purpose:z.enum(["supplier","payroll","tax","operating","revenue"]), request_id:z.string().uuid(), calculated_on:z.string(), confirmed:z.literal(true) });
export type OverdraftRequest = z.infer<typeof overdraftOperationSchema>;
export type OverdraftQuote = z.infer<typeof quoteSchema>;
export type OverdraftState = z.infer<typeof stateSchema>;
export const overdraftKey = (id:string) => ["overdraft",id] as const;
const path = (id:string): `/${string}` => `/applications/${encodeURIComponent(id)}/overdraft`;
export const getOverdraft = (id:string,signal?:AbortSignal) => apiRequest(path(id),stateSchema,{signal});
export const previewOverdraft = (id:string,request:Omit<OverdraftRequest,"request_id"|"calculated_on"|"confirmed">) => apiRequest(`${path(id)}/preview`,quoteSchema,{method:"POST",body:JSON.stringify(request)});
export const operateOverdraft = (id:string,request:OverdraftRequest) => apiRequest(`${path(id)}/operations`,z.object({state:stateSchema,receipt:quoteSchema}),{method:"POST",body:JSON.stringify(request)});
