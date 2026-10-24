import type { Profile } from "@/features/applications";
import { isDebtObligation, type CalendarData } from "@/features/calendar/api";
import { portfolioProducts, sumDisplayAmounts } from "./portfolio-products";

export type BusinessMonth = NonNullable<Profile["financials"]["monthly"]>[number];
export const moneyValue = (value?: string | null) => value == null || value.trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export function monthTotals(row?: BusinessMonth) {
  const inflow = moneyValue(row?.operating_inflow);
  const expenses = moneyValue(row?.operating_outflow);
  const taxes = moneyValue(row?.taxes);
  const outflow = expenses == null || taxes == null ? null : (Math.round(expenses * 100) + Math.round(taxes * 100)) / 100;
  return { inflow, expenses, taxes, outflow, net: inflow == null || outflow == null ? null : (Math.round(inflow * 100) - Math.round(outflow * 100)) / 100 };
}

export function businessSnapshot(profile: Profile, calendar?: CalendarData) {
  const account = profile.accounts?.find(item => item.type === "settlement");
  const cash = moneyValue(account ? account.available_balance : profile.financials.cash_balance);
  const allProducts = calendar ? portfolioProducts(profile.financials, calendar) : [];
  const products = allProducts.filter(item => !["closed", "refinanced"].includes(item.status));
  const limits = products.filter(item => item.kind === "limit");
  const debt = calendar && products.every(item => item.principal != null) ? sumDisplayAmounts(products.map(item => ({ amount: item.principal! }))) : null;
  const unused = calendar && limits.every(item => item.available != null) ? sumDisplayAmounts(limits.map(item => ({ amount: item.available! }))) : null;
  const capacity = calendar && limits.every(item => item.limit != null) ? sumDisplayAmounts(limits.map(item => ({ amount: item.limit! }))) : null;
  const payments = calendar?.events.filter(item => isDebtObligation(item) && Number(item.amount) > 0).sort((a, b) => a.date.localeCompare(b.date)) || [];
  const due = payments[0]?.date;
  const nextPayments = payments.filter(item => item.date === due);
  const nextTotal = due ? sumDisplayAmounts(nextPayments) : null;
  const afterPayment = cash == null || nextTotal == null ? null : (Math.round(cash * 100) - Math.round(Number(nextTotal) * 100)) / 100;
  const operations = calendar?.events.filter(item => !item.forecast && item.direction !== "none" && item.date <= calendar.today)
    .map((item, index) => ({ ...item, index, productTitle: allProducts.find(product => product.applicationId ? product.applicationId === item.application_id : product.id === `loan:${item.loan_id}`)?.title || (item.kind === "supplier_payment" ? "Оплата поставщику" : "Финансирование") })).sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index) || [];
  return { account, cash, products, limits, debt, unused, capacity, due, overdue: Boolean(due && calendar && due < calendar.today), nextPayments, nextTotal, afterPayment, operations };
}
