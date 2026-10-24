import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@/features/applications";
import { calendarQuery } from "@/features/calendar/api";
import { formatMoneyPrecise } from "@/shared/lib/format";
import { financingName } from "@/shared/lib/product-directions";
import "./financing-portfolio.css";

export function CashBalanceBreakdown({ profile }: { profile: Profile }) {
  const calendar = useQuery(calendarQuery);
  const { cash_balance: balance, portfolio_cash_total: net } = profile.financials;
  if (balance == null || net == null) return null;
  const opening = ((Math.round(Number(balance) * 100) - Math.round(Number(net) * 100)) / 100).toFixed(2);
  const movements = calendar.data?.events.filter(event => !event.forecast && ["loan_received", "loan_repayment", "line_draw", "line_repay", "overdraft_expense", "overdraft_receipt", "overdraft_draw", "overdraft_auto_repayment", "supplier_payment"].includes(event.kind)) || [];
  return <details className="cash-balance-breakdown">
    <summary>Откуда остаток на счёте</summary>
    <dl>
      <div><dt>До операций в кабинете</dt><dd>{formatMoneyPrecise(opening)}</dd></div>
      {movements.map(event => <div key={event.event_id}><dt>{event.title}<span>{new Date(event.date + "T12:00:00").toLocaleDateString("ru-RU")} · {event.kind === "supplier_payment" ? "Расчётный счёт" : financingName(calendar.data?.accounts.find(account => account.application_id === event.application_id)?.product_id)}</span></dt><dd>{event.direction === "inflow" ? "+" : "−"}{formatMoneyPrecise(event.amount)}</dd></div>)}
      {!calendar.data && <div><dt>Изменение по выданным продуктам</dt><dd>{formatMoneyPrecise(net)}</dd></div>}
      <div className="cash-balance-total"><dt>Текущий остаток</dt><dd>{formatMoneyPrecise(balance)}</dd></div>
    </dl>
    <p>Открытые лимиты не зачисляются на счёт. Плановые расходы и платежи по графику показаны как прогноз: они не означают, что деньги уже списаны.</p>
  </details>;
}
