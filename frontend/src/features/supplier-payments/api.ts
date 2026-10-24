import { z } from "zod";
import { apiRequest } from "@/shared/api/client";
import { applicationViewSchema } from "@/features/applications/api/applications";

export const supplierFieldsSchema = z.object({
  recipient_name: z.string(), recipient_inn: z.string(), recipient_account: z.string(), recipient_bik: z.string(),
  amount: z.string(), purpose: z.string(), invoice_number: z.string(),
});
export type SupplierFields = z.infer<typeof supplierFieldsSchema>;
export const emptySupplier: SupplierFields = { recipient_name: "", recipient_inn: "", recipient_account: "", recipient_bik: "", amount: "", purpose: "", invoice_number: "" };
const quoteSchema = z.object({
  amount: z.string(), own_money: z.string(), overdraft_used: z.string(), shortfall: z.string(), can_pay: z.boolean(),
  cash_after: z.string(), upcoming_total: z.string(), upcoming_until: z.string(), cash_after_upcoming: z.string(),
  upcoming_payments: z.array(z.object({date: z.string(), amount: z.string(), title: z.string()})),
  account_version: z.string(), calculated_on: z.string(), overdraft_application_id: z.string().nullable(),
  overdraft_rate: z.string().nullable(), overdraft_daily_interest: z.string(), overdraft_repay_by: z.string().nullable(),
});
export const supplierOperationSchema = supplierFieldsSchema.extend({overdraft_application_id: z.string().optional(), base_account_version: z.string(), request_id: z.string().uuid(), calculated_on: z.string(), confirmed: z.literal(true)});
export type SupplierOperation = z.infer<typeof supplierOperationSchema>;
export const supplierReceiptSchema = z.object({payment_id: z.string(), request_id: z.string(), request: supplierFieldsSchema, date: z.string(), created_at: z.string(), quote: quoteSchema, mode: z.literal("simulated")});
export type SupplierReceipt = z.infer<typeof supplierReceiptSchema>;
const accountSchema = z.object({cash_balance: z.string(), account_version: z.string(), today: z.string(), overdraft: z.object({application_id: z.string(), available_limit: z.string(), annual_rate_percent: z.string()}).nullable(), payments: z.array(supplierReceiptSchema)});
export const supplierAccountKey = ["supplier-account"] as const;
export const supplierAccountQuery = {queryKey: supplierAccountKey, queryFn: ({signal}: {signal: AbortSignal}) => apiRequest("/account/payments", accountSchema, {signal}), refetchOnMount: "always" as const};
export const supplierAccountOptions = (id?: string) => ({...supplierAccountQuery, queryKey: id ? [...supplierAccountKey, id] : [...supplierAccountKey], queryFn: ({signal}: {signal: AbortSignal}) => apiRequest(`/account/payments${id ? `?overdraft_application_id=${encodeURIComponent(id)}` : ""}`, accountSchema, {signal})});
export const previewSupplier = (fields: SupplierFields, version: string, id?: string) => apiRequest("/account/payments/preview", quoteSchema, {method: "POST", body: JSON.stringify({...fields, base_account_version: version, ...(id ? {overdraft_application_id: id} : {})})});
export const paySupplier = (payload: SupplierOperation) => apiRequest("/account/payments", supplierReceiptSchema, {method: "POST", body: JSON.stringify(payload)});
export const importSupplierInvoice = (file: File) => apiRequest("/account/invoice", z.object({fields: supplierFieldsSchema.partial(), review_required: z.literal(true)}), {method: "POST", body: file, headers: {"Content-Type": "application/pdf"}});
export const financeSupplier = (amount: string, date: string) => apiRequest("/applications", applicationViewSchema, {method: "POST", body: JSON.stringify({need: {purpose: "working_capital", requested_amount: amount, needed_by: date}})});

export function requisiteErrors(fields: SupplierFields): Partial<Record<keyof SupplierFields, string>> {
  const errors: Partial<Record<keyof SupplierFields, string>> = {};
  const inn = fields.recipient_inn;
  const weights = inn.length === 10 ? [[2,4,10,3,5,9,4,6,8]] : [[7,2,4,10,3,5,9,4,6,8], [3,7,2,4,10,3,5,9,4,6,8]];
  if (!/^(\d{10}|\d{12})$/.test(inn) || /^0+$/.test(inn) || weights.some(row => row.reduce((sum, weight, index) => sum + Number(inn[index]) * weight, 0) % 11 % 10 !== Number(inn[row.length]))) errors.recipient_inn = "Проверьте ИНН: нужны 10 или 12 цифр с верными контрольными цифрами.";
  if (!/^04\d{7}$/.test(fields.recipient_bik)) errors.recipient_bik = "Укажите БИК: 9 цифр, начинается с 04.";
  if (!/^40\d{18}$/.test(fields.recipient_account)) errors.recipient_account = "Укажите расчётный счёт получателя: 20 цифр.";
  else if (!errors.recipient_bik && [...fields.recipient_bik.slice(-3) + fields.recipient_account].reduce((sum, digit, index) => sum + Number(digit) * [7,1,3][index % 3], 0) % 10 !== 0) errors.recipient_account = "Счёт не соответствует БИК. Проверьте оба реквизита.";
  return errors;
}
