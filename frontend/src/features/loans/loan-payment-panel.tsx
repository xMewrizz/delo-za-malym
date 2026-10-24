import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, RefreshCw } from "lucide-react";
import { useOperationJournal } from "@/shared/lib/operation-journal";
import { OperationRecovery } from "@/shared/ui/operation-recovery";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { normalizeMoneyInput } from "@/features/applications/model/need";
import { formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { DatePicker } from "@/shared/ui/date-picker";
import { FormField } from "@/shared/ui/form-field";
import { OperationResult, type OperationReceipt } from "@/shared/ui/operation-result";
import { cancelLoanOrder, getLoan, loanKey, loanRequestSchema, payLoan, previewLoanPayment, type LoanPaymentRequest, type LoanPreviewRequest } from "./api";

const dateLabel = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
import { LoanPaymentResources, LoanPaymentSummary } from "./loan-payment-ui";
import "./loan-payment.css";

type Action = "early" | "regular" | "full";


export function LoanPaymentPanel({ applicationId, onDone }: { applicationId: string; onDone?: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ refetchOnMount: "always", queryKey: loanKey(applicationId), queryFn: ({ signal }) => getLoan(applicationId, signal) });
  const [amount, setAmount] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [action, setAction] = useState<Action>("early");
  const [strategy, setStrategy] = useState<"reduce_payment" | "reduce_term">("reduce_payment");
  const [date, setDate] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<OperationReceipt | null>(null);
  const journal = useOperationJournal(`loan:${applicationId}`, loanRequestSchema);
  const [restoring] = useState(() => Boolean(journal.pending));
  const request = useRef<LoanPaymentRequest | null>(journal.pending);
  const quoteElement = useRef<HTMLDivElement>(null);
  const preview = useMutation({ mutationFn: (payload: LoanPreviewRequest) => previewLoanPayment(applicationId, payload) });
  useEffect(() => {
    const element = quoteElement.current;
    if (!preview.data || !element) return;
    element.focus({ preventScroll: true });
    const panel = element.closest<HTMLElement>(".funding-dialog-body");
    if (panel) panel.scrollTo?.({ top: panel.scrollTop + element.getBoundingClientRect().top - panel.getBoundingClientRect().top, behavior: "auto" });
  }, [preview.data]);
  async function refresh(data: Awaited<ReturnType<typeof getLoan>>) {
    client.setQueryData(loanKey(applicationId), data); preview.reset();
    await Promise.all([client.invalidateQueries({ queryKey: ["profile"] }), client.invalidateQueries({ queryKey: ["payment-calendar"] }), client.invalidateQueries({ queryKey: ["applications"] })]);
  }
  async function completePayment(data: Awaited<ReturnType<typeof getLoan>>, payload: LoanPaymentRequest) {
      const order = data.orders.find(item => item.request_id === payload.request_id);
      const operation = data.operations.find(item => item.request_id === payload.request_id);
      const deferred = order?.status === "pending";
      const failed = order?.status === "failed";
      const cancelled = order?.status === "cancelled";
      const next = data.schedule[0];
      setReceipt({
        title: deferred ? "Платёж запланирован" : failed ? "Платёж не исполнен" : cancelled ? "Платёж отменён" : data.status === "closed" ? "Кредит погашен" : "Платёж выполнен",
        description: deferred ? "Деньги пока остаются на счёте. Запланированный платёж можно отменить до исполнения." : failed ? order.error || "Откройте запланированный платёж и проверьте причину." : cancelled ? "Запланированное списание отменено." : data.status === "closed" ? "Долг погашен полностью. Будущих платежей по этому кредиту нет." : "Долг уменьшен. Новый график уже действует.",
        amount: formatMoneyPrecise(payload.amount), tone: deferred ? "scheduled" : failed ? "error" : cancelled ? "neutral" : "success",
        facts: [
          { label: deferred ? "Запланированная дата" : failed || cancelled ? "Планировалось списать" : "Дата списания", value: dateLabel(operation?.date || order?.execution_date || payload.execution_date) },
          { label: deferred ? "Основной долг сейчас" : "Основной долг", value: formatMoneyPrecise(data.principal) },
          ...(!deferred && !failed && !cancelled && operation ? [{ label: "Уплачено процентов", value: formatMoneyPrecise(operation.interest_paid) }] : []),
          ...(next ? [{ label: `Следующий платёж · ${dateLabel(next.date)}`, value: formatMoneyPrecise(next.total_payment) }] : []),
        ],
        calendarHref: deferred && order ? `/cabinet?mode=calendar&product=app:${applicationId}&date=${order.execution_date}` : next ? `/cabinet?mode=calendar&product=app:${applicationId}&date=${next.date}` : undefined,
        anotherLabel: deferred || failed ? "Показать запланированный платёж" : "Другая операция",
      });
      journal.clear(); request.current = null; setAmount(""); setDate(null); await refresh(data);
  }
  const payment = useMutation({ mutationFn: (payload: LoanPaymentRequest) => payLoan(applicationId, payload), onSuccess: completePayment,
    onError: error => {
      if (error instanceof ApiError && error.status < 500) {
        journal.clear(); request.current = null; preview.reset();
        if (error.status === 409) void query.refetch();
      }
    },
  });
  const cancellation = useMutation({ mutationFn: ({ id, version }: { id: string; version: number }) => cancelLoanOrder(applicationId, id, version), onSuccess: async (data, payload) => {
    const order = data.orders.find(item => item.order_id === payload.id);
    setReceipt({ title: "Платёж отменён", description: "Деньги не списывались. Платежи по кредиту остаются в графике.", tone: "neutral", amount: order ? formatMoneyPrecise(order.amount) : undefined,
      facts: [{ label: "Основной долг", value: formatMoneyPrecise(data.principal) }], anotherLabel: "Новая операция" });
    await refresh(data);
  }, onError: () => { void query.refetch(); } });
  useEffect(() => {
    if (!restoring || !journal.pending || !query.data || payment.isPending || receipt) return;
    const id = journal.pending.request_id;
    if (!query.data.operations.some(item => item.request_id === id) && !query.data.orders.some(item => item.request_id === id)) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) void completePayment(query.data!, journal.pending!); });
    return () => { active = false; };
  });
  const state = query.data;
  const uncertain = payment.isError && !(payment.error instanceof ApiError && payment.error.status < 500);
  const locked = payment.isPending || uncertain || preview.isPending || cancellation.isPending;
  const nearest = state?.schedule[0];
  const pending = state?.orders?.find(order => order.status === "pending");
  const regularDate = state ? nearest && nearest.date > state.today ? nearest.date : state.today : "";
  const execution = action === "regular" ? regularDate : date || state?.today || "";
  const regularAmount = nearest && state ? nearest.date < state.today ? (Number(nearest.principal_payment) + Number(state.accrued_interest)).toFixed(2) : nearest.total_payment : "";
  const input = action === "regular" ? regularAmount : action === "full" ? state?.amount_to_close || "" : amount;
  let normalized: string | null = null;
  try { normalized = normalizeMoneyInput(input); } catch { /* Validation is shown beside the field. */ }
  const amountError = amount && (!normalized || Number(normalized) <= 0) ? "Укажите положительную сумму, до двух знаков после запятой." : undefined;
  function clear() { preview.reset(); payment.reset(); request.current = null; }
  function changeAmount(value: string) { setAmount(value); clear(); }
  function confirm() {
    const quote = preview.data;
    if (!quote) return;
    const payload: LoanPaymentRequest = request.current || {
      amount: quote.amount, base_loan_version: quote.base_loan_version, execution_date: quote.execution_date,
      payment_kind: quote.payment_kind, strategy: quote.strategy, full_repayment: quote.full_repayment,
      calculated_on: quote.calculated_on, request_id: crypto.randomUUID(), confirmed: true,
    };
    if (!journal.save(payload)) return;
    request.current = payload; payment.mutate(payload);
  }
  if (receipt) return <OperationResult receipt={receipt} onDone={onDone} onAnother={state?.status !== "closed" || receipt.title === "Квитанция об операции" ? () => { setReceipt(null); payment.reset(); cancellation.reset(); } : undefined} />;
  if (restoring && journal.pending) return <OperationRecovery checking={query.isFetching} busy={payment.isPending} error={payment.error ? getErrorMessage(payment.error) : query.error ? getErrorMessage(query.error) : undefined} onCheck={() => void query.refetch()} onRetry={() => payment.mutate(journal.pending!)} />;
  return <section className="funding-operation loan-payment-panel" aria-label="Погашение кредита">
    {journal.error && <p role="alert" className="text-destructive">{journal.error}</p>}
    {query.isPending && <p role="status">Получаем актуальные условия…</p>}
    {query.error && <div role="alert"><p>{getErrorMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()}><RefreshCw />Повторить</Button></div>}
    {state && <>
      {!preview.data && <div className="funding-loan-overview"><div className="funding-operation-balance"><span>{state.status === "closed" ? "Кредит погашен" : "Остаток основного долга"}</span><strong>{formatMoneyPrecise(state.principal)}</strong><small>Начислено процентов: {formatMoneyPrecise(state.accrued_interest)}</small></div><div className="funding-next-due"><CalendarClock size={20} /><span>Ближайший платёж</span><strong>{nearest ? formatMoneyPrecise(nearest.total_payment) : "Нет платежей"}</strong><small>{nearest ? dateLabel(nearest.date) : "Кредит закрыт"}</small></div></div>}
      {pending && <div className="funding-pending-order" role="status"><CalendarClock size={21} /><div><strong>Платёж на {dateLabel(pending.execution_date)}</strong><p>{formatMoneyPrecise(pending.amount)} · {pending.full_repayment ? "полное погашение" : pending.payment_kind === "regular" ? "по графику" : "досрочное погашение"}</p><small>Деньги ещё не списаны и не зарезервированы. До исполнения платёж можно отменить.</small></div><Button type="button" variant="outline" size="sm" disabled={locked} onClick={() => cancellation.mutate({ id: pending.order_id, version: state.version })}>Отменить платёж</Button></div>}
      {state.status !== "closed" && !pending && <>
        <form hidden={Boolean(preview.data)} onSubmit={event => { event.preventDefault(); if (normalized && !amountError && !locked) preview.mutate({ amount: normalized, base_loan_version: state.version, execution_date: execution, payment_kind: action === "regular" ? "regular" : "early", strategy, full_repayment: action === "full" }); }} className="funding-operation-form">
          <fieldset className="funding-operation-choices" disabled={locked}><legend>Что хотите сделать?</legend>{([
            ["regular", "По графику", "Оплатить ближайший платёж"], ["early", "Досрочно", "Внести дополнительную сумму"], ["full", "Закрыть кредит", "Погасить весь долг с процентами"],
          ] as const).map(([value, title, description]) => <label key={value} data-selected={action === value}><input type="radio" name={`loan-action-${applicationId}`} value={value} checked={action === value} onChange={() => { setAction(value); setDate(null); clear(); }} /><strong>{title}</strong><small>{description}</small></label>)}</fieldset>
          {action === "early" ? <FormField id={`loan-payment-${applicationId}`} label="Сколько внести, ₽" value={amount} inputMode="decimal" placeholder="Например, 70 000" disabled={locked} onChange={event => changeAmount(event.target.value)} error={amountError} /> : <div className="funding-fixed-amount"><span>{action === "full" ? "К полному погашению сегодня" : "Сумма ближайшего платежа"}</span><strong>{formatMoneyPrecise(input || "0")}</strong>{action === "full" && execution > state.today && <small>Сумму на выбранную дату уточним на следующем шаге.</small>}</div>}
          {action === "regular" ? <p className="funding-operation-hint">Спишем {dateLabel(regularDate)}. До исполнения деньги остаются на счёте.</p> : <DatePicker id={`loan-date-${applicationId}`} label="Когда списать деньги" value={execution} min={state.today} max={nearest && nearest.date >= state.today ? nearest.date : state.today} disabled={locked} onChange={value => { setDate(value); clear(); }} hint={nearest ? `Можно выбрать дату до ${dateLabel(nearest.date)}` : undefined} />}
          {action === "early" && <fieldset className="funding-strategy" disabled={locked}><legend>Что изменить после погашения?</legend><label data-selected={strategy === "reduce_payment"}><input type="radio" name={`loan-strategy-${applicationId}`} checked={strategy === "reduce_payment"} onChange={() => { setStrategy("reduce_payment"); clear(); }} /><span><strong>Уменьшить платёж</strong><small>Дата окончания останется прежней</small></span></label><label data-selected={strategy === "reduce_term"}><input type="radio" name={`loan-strategy-${applicationId}`} checked={strategy === "reduce_term"} onChange={() => { setStrategy("reduce_term"); clear(); }} /><span><strong>Сократить срок</strong><small>Сохраним размер платежа, погасите раньше</small></span></label></fieldset>}
          <div className="loan-form-actions"><Button type="submit" disabled={!normalized || Boolean(amountError) || locked || (action === "regular" && !nearest)}>{preview.isPending ? "Проверяем сумму…" : action === "full" ? "Проверить сумму погашения" : action === "regular" ? "Проверить платёж" : "Рассчитать новый график"}<ArrowRight size={16} aria-hidden="true" /></Button></div>
        </form>
        {preview.error && <p role="alert" className="text-destructive">{getErrorMessage(preview.error)}</p>}
        {preview.data && <div className="funding-payment-preview" ref={quoteElement} tabIndex={-1} aria-label="Расчёт перед подтверждением">
          <LoanPaymentSummary quote={preview.data} busy={locked} onEdit={clear} onConfirm={confirm} />
        </div>}
      </>}
      {payment.isPending && <p role="status">Обрабатываем подтверждение…</p>}
      {payment.error && <div role="alert" className="text-destructive">{getErrorMessage(payment.error)}{uncertain && payment.variables && <Button variant="outline" onClick={() => payment.mutate(payment.variables!)}>Проверить и повторить этот платёж</Button>}</div>}
      {cancellation.error && <p role="alert" className="text-destructive">{getErrorMessage(cancellation.error)}</p>}
      {!preview.data && <LoanPaymentResources state={state} applicationId={applicationId} open={historyOpen} onToggle={() => setHistoryOpen(value => !value)} onReceipt={setReceipt} />}
    </>}
  </section>;
}
