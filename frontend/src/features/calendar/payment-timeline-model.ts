import type { Profile } from "@/features/applications";
import { financingName } from "@/shared/lib/product-directions";
import { eventProductKey, isDebtObligation, type CalendarData, type CalendarEvent } from "./api";

const DAY = 86400000;
const stamp = (value: string) => Date.parse(value + "T12:00:00Z");
export const shiftDay = (value: string, amount: number) => new Date(Math.min(stamp("9999-12-31"), Math.max(stamp("0001-01-01"), stamp(value) + amount * DAY))).toISOString().slice(0, 10);
export function shiftTimelineMonth(value: string, amount: number) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const ordinal = Math.max(0, Math.min(9999 * 12 - 1, (year - 1) * 12 + month - 1 + amount));
  return `${String(Math.floor(ordinal / 12) + 1).padStart(4, "0")}-${String(ordinal % 12 + 1).padStart(2, "0")}-01`;
}
export function timelineDays(start: string, months: number) {
  const end = new Date(stamp(start)); end.setUTCMonth(end.getUTCMonth() + months);
  const count = Math.round((Math.min(end.getTime(), stamp("9999-12-31") + DAY) - stamp(start)) / DAY);
  return Array.from({ length: count }, (_, index) => shiftDay(start, index));
}
export const sumTimelineAmounts = (events: CalendarEvent[]) => (events.reduce((sum, event) => sum + Math.round(Number(event.amount) * 100), 0) / 100).toFixed(2);

export type TimelineProduct = {
  id: string; title: string; reference: string; opened?: string; maturity?: string; status: string;
  principal: string | null; limit?: string; available?: string; applicationId?: string; productId?: string; planned?: boolean; events: CalendarEvent[];
};
export function timelineProducts(calendar: CalendarData, profile: Profile | undefined, events: CalendarEvent[], scope: string): TimelineProduct[] {
  const rows: TimelineProduct[] = [
    ...(profile?.financials.existing_loans || []).filter(loan => !loan.application_id).map((loan, index) => ({
      id: `loan:${loan.loan_id}`, title: loan.product_id ? financingName(loan.product_id) : "Кредит", reference: `Договор банка ${index + 1}`,
      maturity: loan.maturity_date, status: "active", principal: loan.outstanding_principal ?? null, events: [],
    })),
    ...calendar.accounts.map(account => ({
      id: `app:${account.application_id}`, title: financingName(account.product_id), reference: `№ ${account.application_id.slice(0, 6)}`,
      opened: account.opened_at.slice(0, 10), maturity: account.refinanced_by
        ? calendar.accounts.find(replacement => replacement.application_id === account.refinanced_by)?.opened_at.slice(0, 10)
        : account.maturity_date || profile?.financials.existing_loans?.find(loan => loan.application_id === account.application_id)?.maturity_date,
      status: account.status || "active", principal: account.outstanding_principal, applicationId: account.application_id, productId: account.product_id,
      ...(["overdraft", "revolving_credit_line"].includes(account.product_id) ? { limit: account.amount, available: account.available_limit } : {}), events: [],
    })),
  ];
  const byId = new Map(rows.map(row => [row.id, row]));
  const plan: TimelineProduct = { id: "plan:cashflow", title: "План бизнеса", reference: "Поступления и расходы", status: "planned", planned: true, principal: null, events: [] };
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const row = event.kind.startsWith("planned_") || (event.forecast && event.kind.startsWith("overdraft_") && event.kind !== "overdraft_payment_due") ? undefined : byId.get(eventProductKey(event));
    (row || plan).events.push(event);
  }
  return [...rows.filter(row => scope === "all" || row.id === scope).sort((a, b) => (a.opened || "").localeCompare(b.opened || "") || a.id.localeCompare(b.id)), ...(scope === "all" && plan.events.length ? [plan] : [])];
}

export function contractSegment(row: TimelineProduct, days: string[]) {
  if (!days.length || (row.opened && row.opened > days.at(-1)!) || (row.maturity && row.maturity < days[0]) || row.planned || (["closed", "refinanced"].includes(row.status) && !row.maturity)) return null;
  const from = row.opened ? Math.max(0, Math.round((stamp(row.opened) - stamp(days[0])) / DAY)) : 0;
  const to = row.maturity ? Math.min(days.length - 1, Math.round((stamp(row.maturity) - stamp(days[0])) / DAY)) : days.length - 1;
  return { left: from / days.length * 100, width: (to - from + 1) / days.length * 100, continuesBefore: !row.opened || row.opened < days[0], continuesAfter: !row.maturity || row.maturity > days.at(-1)! };
}
export function productDays(row: TimelineProduct, days: string[]) {
  const visible = new Set(days);
  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of row.events) if (visible.has(event.date)) grouped.set(event.date, [...(grouped.get(event.date) || []), event]);
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, events]) => ({ date, events, payment: sumTimelineAmounts(events.filter(isDebtObligation)) }));
}

export function timelineMarkerLanes(dates: string[], minimumGap: number) {
  const lastDay = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  return dates.map(date => {
    const day = stamp(date) / DAY;
    const lane = Math.max(0, lastDay.findIndex(previous => day - previous >= minimumGap));
    lastDay[lane] = day;
    return [0, -1, 1][lane];
  });
}
