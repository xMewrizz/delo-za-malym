import { ArrowLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, FileText, History, Wallet } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/shared/ui/button";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { formatMoneyPrecise as money } from "@/shared/lib/format";
import type { OperationReceipt } from "@/shared/ui/operation-result";
import type { getLoan, previewLoanPayment } from "./api";

type Loan = Awaited<ReturnType<typeof getLoan>>;
type Quote = Awaited<ReturnType<typeof previewLoanPayment>>;
const dateLabel = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const orderStatus = { pending: "Запланирован", executed: "Исполнен", cancelled: "Отменён", failed: "Не исполнен" };

export function LoanPaymentSummary({ quote, busy, onEdit, onConfirm }: {quote: Quote; busy: boolean; onEdit: () => void; onConfirm: () => void}) {
  const future = quote.execution_date > quote.calculated_on;
  const full = Number(quote.remaining_principal) === 0 && Number(quote.remaining_interest) === 0;
  const early = quote.payment_kind === "early";
  return <>
    <div className="loan-review-heading"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onEdit}><ArrowLeft size={16} aria-hidden="true" />Изменить</Button><span><CalendarDays size={15} aria-hidden="true" />{future ? dateLabel(quote.execution_date) : "Сегодня"}</span></div>
    <div className="loan-review-total"><span>{full ? "Полное погашение" : early ? "Досрочный платёж" : "Платёж по графику"}</span><h3>{money(quote.amount)}</h3><p>{future ? "Спишем в выбранную дату. Сейчас деньги останутся на счёте." : "Спишем с расчётного счёта"}</p></div>
    <dl className="loan-review-allocation" aria-label="Состав платежа"><div><dt>Основной долг</dt><dd>{money(quote.principal_paid)}</dd></div><div><dt>Проценты</dt><dd>{money(quote.interest_paid)}</dd></div></dl>
    <div className="loan-review-cash"><Wallet size={19} aria-hidden="true" /><div><span>{future ? "Остаток при текущем балансе" : "Останется на счёте"}</span><strong>{money(quote.cash_after)}</strong></div></div>
    {full ? <section className="loan-close-outcome" aria-label="После полного погашения"><span className="loan-close-check"><Check size={19} aria-hidden="true" /></span><div><h4>Кредит будет закрыт</h4><p>{future ? `После списания ${dateLabel(quote.execution_date)}` : "Будущих платежей не останется"}</p></div>{Number(quote.interest_saving) > 0 && <div className="loan-interest-saving"><span>Экономия на процентах</span><strong>{money(quote.interest_saving)}</strong></div>}</section> : <>
      <div className="loan-review-changes"><div><span>Остаток долга после платежа</span><strong>{money(quote.remaining_principal)}</strong></div><div><span>Кредит до</span><strong>{dateLabel(quote.maturity_after)}</strong></div></div>
      {early && quote.mandatory_date && <div className="funding-mandatory-result loan-next-payment"><div><span>Платёж по графику · {dateLabel(quote.mandatory_date)}</span>{Number(quote.mandatory_after) > 0 ? <p>Его нужно внести отдельно от досрочного платежа.</p> : <p><Check size={14} aria-hidden="true" />Этот платёж будет погашен</p>}</div><div>{quote.mandatory_before !== quote.mandatory_after && <s>{money(quote.mandatory_before)}</s>}<strong>{Number(quote.mandatory_after) > 0 ? money(quote.mandatory_after) : "Погашен"}</strong></div></div>}
      {!early && quote.next_payment && <div className="loan-next-payment"><div><span>Следующий платёж</span><p>{dateLabel(quote.next_payment.date)}</p></div><strong>{money(quote.next_payment.total_payment)}</strong></div>}
      {early && Number(quote.interest_saving) > 0 && <p className="loan-review-saving">Экономия на процентах<strong>{money(quote.interest_saving)}</strong></p>}
    </>}
    {!quote.can_pay && <p role="alert" className="loan-review-error">{future ? "По текущему остатку денег не хватает. Пополните счёт к дате списания." : "На счёте не хватает денег. Пополните счёт или измените сумму."}</p>}
    {!full && quote.schedule.length > 0 && <details className="loan-review-details"><summary><CalendarDays size={17} aria-hidden="true" /><span>График после платежа<small>{quote.schedule.length} платежей</small></span><ChevronDown size={17} aria-hidden="true" /></summary><div className="funding-schedule-list">{quote.schedule.map(row => <div key={row.date}><span>{dateLabel(row.date)}</span><strong>{money(row.total_payment)}</strong></div>)}</div></details>}
    {future && <details className="loan-review-details"><summary><CalendarDays size={17} aria-hidden="true" /><span>Как исполнится платёж</span><ChevronDown size={17} aria-hidden="true" /></summary><p>Деньги не резервируются. В выбранную дату платёж обработается автоматически. Если денег не хватит или сумма полного погашения изменится, списания не будет — причина появится в истории.</p></details>}
    <div className="loan-review-actions"><ConfirmAction label={future ? "Запланировать платёж" : full ? "Погасить кредит" : "Внести платёж"} title={future ? "Запланировать платёж?" : full ? "Погасить кредит полностью?" : "Подтвердить платёж?"} description={`${money(quote.amount)} · ${dateLabel(quote.execution_date).replace(/\.$/, "")}. ${future ? "Деньги спишутся в выбранную дату." : full ? "Погасим долг и проценты. Кредит будет закрыт." : "После списания обновится график платежей."}`} confirmLabel={future ? "Запланировать" : "Подтвердить платёж"} onConfirm={onConfirm} disabled={(!future && !quote.can_pay) || busy} /></div>
  </>;
}

export function LoanPaymentResources({state, applicationId, open, onToggle, onReceipt}: {state: Loan; applicationId: string; open: boolean; onToggle: () => void; onReceipt: (receipt: OperationReceipt) => void}) {
  const orders = state.orders.filter(order => !order.request_id || !state.operations.some(operation => operation.request_id === order.request_id));
  const count = state.operations.length + orders.length;
  return <section className="loan-resources" aria-label="История и документы кредита">
    <button type="button" className="loan-resource-control" aria-expanded={open} aria-controls={`loan-history-${applicationId}`} onClick={onToggle}><History size={20} aria-hidden="true" /><span><strong>История платежей</strong><small>{count ? `Операций: ${count}` : "Платежей пока нет"}</small></span><ChevronDown size={18} aria-hidden="true" /></button>
    <div id={`loan-history-${applicationId}`} className="loan-history-list" hidden={!open}>
      {count === 0 && <p>Здесь появятся списания и запланированные платежи.</p>}
      {[...orders].reverse().map(order => <article key={order.order_id}><div><strong>{dateLabel(order.execution_date)}</strong><span>{order.payment_kind === "regular" ? "По графику" : order.full_repayment ? "Полное погашение" : "Досрочный платёж"}</span>{order.error && <p className="loan-review-error">{order.error}</p>}</div><div><strong>{money(order.amount)}</strong><small data-status={order.status}>{orderStatus[order.status]}</small></div></article>)}
      {[...state.operations].reverse().map(operation => <article key={operation.operation_id}><div><strong>{dateLabel(operation.date)}</strong><span>{money(operation.principal_paid)} — долг · {money(operation.interest_paid)} — проценты</span><Button variant="ghost" size="sm" onClick={() => onReceipt({title: "Квитанция об операции", description: "Платёж по кредиту", amount: money(operation.amount), facts: [{label: "Дата списания", value: dateLabel(operation.date)}, {label: "Основной долг погашен", value: money(operation.principal_paid)}, {label: "Уплачено процентов", value: money(operation.interest_paid)}, {label: "Номер операции", value: operation.operation_id}], anotherLabel: "Вернуться к истории"})}>Квитанция<ArrowUpRight size={13} aria-hidden="true" /></Button></div><div><strong>{money(operation.amount)}</strong><small>Списано</small></div></article>)}
    </div>
    <Link className="loan-resource-control" to={`/cabinet?mode=applications&application=${applicationId}`}><FileText size={20} aria-hidden="true" /><span><strong>Документы кредита</strong><small>Условия и исходная заявка</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
  </section>;
}
