import {Dialog} from "radix-ui";
import {ArrowDownLeft,ArrowUpRight,History,X} from "lucide-react";
import {Button} from "@/shared/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { Profile } from "@/features/applications";
import { calendarQuery } from "@/features/calendar/api";
import { formatMoneyPrecise } from "@/shared/lib/format";
import { financingName } from "@/shared/lib/product-directions";
import "./financing-portfolio.css";
import "./cash-balance-breakdown.css";

export function CashBalanceBreakdown({ profile }: { profile: Profile }) {
  const calendar = useQuery(calendarQuery);
  const { cash_balance: balance, portfolio_cash_total: net } = profile.financials;
  if (balance == null || net == null) return null;
  const opening = ((Math.round(Number(balance) * 100) - Math.round(Number(net) * 100)) / 100).toFixed(2);
  const movements = calendar.data?.events.filter(event => !event.forecast && ["loan_received", "loan_repayment", "line_draw", "line_repay", "overdraft_expense", "overdraft_receipt", "overdraft_draw", "overdraft_auto_repayment", "supplier_payment"].includes(event.kind)) || [];
  const ordered = movements.toReversed().sort((a,b)=>b.date.localeCompare(a.date));
  function rows(events: typeof movements) {
    return <ol className="account-history-list">{events.map(event=><li key={event.event_id}>
      <span className="account-history-direction" data-inflow={event.direction==="inflow"}>{event.direction==="inflow"?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</span>
      <div><strong>{event.title}</strong><span><time dateTime={event.date}>{new Date(event.date+"T12:00:00").toLocaleDateString("ru-RU")}</time> · {event.kind==="supplier_payment"?"Расчётный счёт":financingName(calendar.data?.accounts.find(account=>account.application_id===event.application_id)?.product_id)}</span></div>
      <b data-inflow={event.direction==="inflow"}>{event.direction==="inflow"?"+":"−"}{formatMoneyPrecise(event.amount)}</b>
    </li>)}</ol>;
  }
  return <Dialog.Root><Dialog.Trigger asChild><Button variant="ghost" size="sm" className="account-history-trigger"><History size={14} aria-hidden="true"/>История операций</Button></Dialog.Trigger><Dialog.Portal>
      <Dialog.Overlay className="account-history-overlay"/>
      <Dialog.Content className="account-history-dialog"><header><div><Dialog.Title>История по счёту</Dialog.Title><Dialog.Description>Поступления и списания, от новых к старым</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Закрыть историю операций"><X size={20}/></Button></Dialog.Close></header>
        <div className="account-history-scroll" tabIndex={0} aria-label="Операции по счёту">{calendar.isPending?<p className="account-history-empty" role="status">Загружаем операции…</p>:calendar.error?<div className="account-history-empty" role="alert"><p>Не удалось загрузить историю.</p><Button variant="outline" size="sm" onClick={()=>void calendar.refetch()}>Повторить</Button></div>:ordered.length?rows(ordered):<p className="account-history-empty">Операций пока нет.</p>}</div>
        <footer><span>Начальный остаток<strong>{formatMoneyPrecise(opening)}</strong></span><span>Сейчас на счёте<strong>{formatMoneyPrecise(balance)}</strong></span></footer>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>;
}
