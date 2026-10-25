import { z } from 'zod'
import { apiRequest } from '@/shared/api/client'

const decimal = z.string().regex(/^\d+(\.\d+)?$/)
const common = {
  name: z.string(),
  policy_version: z.string(),
  rules_fingerprint: z.string().optional(),
  minimum_amount: decimal,
  maximum_amount: decimal,
  annual_rate_percent: decimal,
}

export const productsSchema = z.array(z.discriminatedUnion('product_id', [
  z.object({ ...common, product_id: z.literal('working_capital_loan'), terms: z.array(z.number().int().positive()) }),
  z.object({ ...common, product_id: z.literal('overdraft'), agreement_months: z.number().int().positive(), max_debt_days: z.number().int().positive() }),
  z.object({ ...common, product_id: z.literal('refinancing'), terms: z.array(z.number().int().positive()) }),
  z.object({ ...common, product_id: z.literal('revolving_credit_line'), terms: z.array(z.number().int().positive()) }),
  z.object({ ...common, product_id: z.literal('investment_loan'), terms: z.array(z.number().int().positive()) }),
]))

export type Product = z.infer<typeof productsSchema>[number]

export function getProducts(signal?: AbortSignal) {
  return apiRequest('/products', productsSchema, { signal })
}
