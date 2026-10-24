import type { Profile } from "@/features/applications";
import type { CalendarData, CalendarEvent } from "@/features/calendar/api";
import { financingName } from "@/shared/lib/product-directions";

export type PortfolioProduct = {
  id: string;
  applicationId?: string;
  title: string;
  productId?: string;
  originalPrincipal?: string;
  kind: "loan" | "limit";
  status: string;
  source: string;
  principal: string | null;
  limit?: string;
  available?: string;
  maturity?: string;
  annualRate?: string;
  accruedInterest?: string;
  nextPayment?: { date: string; amount: string; principal?: string; interest?: string };
  pendingPayment?: { date: string; amount: string };
  upcomingPayments?: {date:string;amount:string}[];
  principalStartsOn?:string;
};

// Display calculations only; financial decisions remain on the server.
export const sumDisplayAmounts = (rows: { amount: string }[]) =>
  (rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100).toFixed(2);

function futurePayments(events:CalendarEvent[],today:string) {
  return [...new Map(events.filter(event=>event.forecast&&event.direction==="outflow"&&event.date>=today&&event.kind!=="loan_payment_order").map(event=>[event.event_id,event])).values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function nextPayment(events: CalendarEvent[], today: string) {
  const future = futurePayments(events,today);
  const date = future[0]?.date;
  const rows = future.filter(event => event.date === date);
  return date ? { date, amount: sumDisplayAmounts(rows),
    ...(rows.every(event => event.principal_amount !== undefined && event.interest_amount !== undefined) ? {
      principal: sumDisplayAmounts(rows.map(event => ({ amount: event.principal_amount! }))),
      interest: sumDisplayAmounts(rows.map(event => ({ amount: event.interest_amount! }))),
    } : {}) } : undefined;
}

function schedulePreview(events:CalendarEvent[],today:string) {
  const future=futurePayments(events,today);
  const dates=[...new Set(future.map(event=>event.date))].slice(0,3);
  return {upcomingPayments:dates.map(date=>({date,amount:sumDisplayAmounts(future.filter(event=>event.date===date))})),
    principalStartsOn:future[0]?.principal_amount==="0.00" ? future.find(event=>Number(event.principal_amount)>0)?.date : undefined};
}

export function portfolioProducts(financials: Profile["financials"], calendar: CalendarData): PortfolioProduct[] {
  const loans = financials.existing_loans || [];
  const accountIds = new Set(calendar.accounts.map(account => account.application_id));
  const existing: PortfolioProduct[] = loans.filter(loan => !loan.application_id || !accountIds.has(loan.application_id)).map(loan => ({
    id: `loan:${loan.loan_id}`, applicationId: loan.application_id,
    title: loan.product_id ? financingName(loan.product_id) : "Кредит",
    productId: loan.product_id,
    originalPrincipal: typeof loan.original_principal === "string" ? loan.original_principal : undefined,
    kind: "loan", status: "active", source: "Из банковского профиля",
    annualRate: typeof loan.annual_rate_percent === "string" ? loan.annual_rate_percent : undefined,
    accruedInterest: typeof loan.accrued_interest === "string" ? loan.accrued_interest : undefined,
    principal: loan.outstanding_principal ?? null, maturity: loan.maturity_date,
    ...schedulePreview(calendar.events.some(event=>event.loan_id===loan.loan_id)
      ? calendar.events.filter(event=>event.loan_id===loan.loan_id)
      : (loan.schedule||[]).map((row,index)=>({event_id:`${loan.loan_id}:${index}`,application_id:"",date:row.date,amount:row.total_payment,direction:"outflow",forecast:true,kind:"existing_loan_payment",title:"Платёж"})),calendar.today),
    nextPayment: nextPayment(calendar.events.filter(event => event.loan_id === loan.loan_id), calendar.today)
      || nextPayment((loan.schedule || []).map((row, index) => ({
        event_id: `${loan.loan_id}:${index}`, application_id: "", date: row.date, amount: row.total_payment,
        direction: "outflow", forecast: true, kind: "existing_loan_payment", title: "Платёж по кредиту",
      })), calendar.today),
  }));
  return [...existing, ...calendar.accounts.map((account): PortfolioProduct => {
    const loan = loans.find(item => item.application_id === account.application_id);
    const limit = ["overdraft", "revolving_credit_line"].includes(account.product_id);
    const closed = ["closed", "refinanced"].includes(account.status || "");
    return {
      id: `app:${account.application_id}`, applicationId: account.application_id,
      title: financingName(account.product_id), kind: limit ? "limit" : "loan",
      productId: account.product_id, originalPrincipal: limit ? undefined : account.amount,
      status: account.status || "active", source: "Оформлен в кабинете",
      annualRate: account.annual_rate_percent ?? undefined, accruedInterest: account.accrued_interest ?? undefined,
      principal: account.outstanding_principal, maturity: loan?.maturity_date || account.maturity_date || undefined,
      limit: limit ? account.amount : undefined,
      available: limit ? closed ? "0.00" : account.available_limit || (Number(account.amount) - Number(account.outstanding_principal)).toFixed(2) : undefined,
      pendingPayment: calendar.events.find(event => event.application_id === account.application_id && event.kind === "loan_payment_order" && event.forecast),
      ...(!closed && !(account.product_id==="overdraft"&&Number(account.outstanding_principal)===0)
        ? schedulePreview(calendar.events.filter(event=>event.application_id===account.application_id),calendar.today) : {}),
      nextPayment: closed || (account.product_id === "overdraft" && Number(account.outstanding_principal) === 0)
        ? undefined : nextPayment(calendar.events.filter(event => event.application_id === account.application_id), account.product_id === "overdraft" ? "0000-01-01" : calendar.today),
    };
  })];
}
