import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useOperationJournal } from "@/shared/lib/operation-journal";
import { OperationRecovery } from "@/shared/ui/operation-recovery";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { normalizeMoneyInput } from "@/features/applications/model/need";
import { Button } from "@/shared/ui/button";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { FormField } from "@/shared/ui/form-field";
import { Disclosure } from "@/shared/ui/disclosure";
import "./revolving-terms.css";
import { OperationResult, type OperationReceipt } from "@/shared/ui/operation-result";
import { getLine, postLineOperation, lineKey, lineOperationSchema, type LineOperation } from "./api";

export function RevolvingTerms({ value }: { value: unknown }) {
  const data = z.object({ capacity_reserve: z.string(), interest_30_days_full_limit: z.string() }).safeParse(value);
  if (!data.success) return null;
  return <section className="revolving-terms" aria-label="Использование кредитной линии">
    <div className="revolving-terms-intro"><h4>Берите частями. Используйте снова.</h4><p>Погашение основного долга восстанавливает доступный лимит.</p></div>
    <dl className="revolving-payment-rules"><div><dt>Проценты на использованный долг</dt><dd>Ежемесячно</dd></div><div><dt>За неиспользованный лимит</dt><dd>0 ₽</dd></div></dl>
    <div className="revolving-cost-example"><div><span>Пример стоимости</span><strong>{formatMoney(data.data.interest_30_days_full_limit)}</strong><small>за 30 дней использования всего лимита</small></div><p>Расчёт на 365 дней в году. Если использовать меньше денег или вернуть их раньше, процентов будет меньше.</p></div>
    <Disclosure title="Что банк учитывает при одобрении"><p>Расчётная нагрузка при использовании всего лимита — {formatMoney(data.data.capacity_reserve)} в месяц. Она нужна для проверки платёжеспособности. Фактический платёж зависит от долга и начисленных процентов.</p></Disclosure>
  </section>;
}

export function CreditLinePanel({ applicationId, initialAction = "draw", onDone }: { applicationId: string; initialAction?: "draw" | "repay"; onDone?: () => void }) {
  const client = useQueryClient();
  const query = useQuery({ refetchOnMount: "always", queryKey: lineKey(applicationId), queryFn: ({ signal }) => getLine(applicationId, signal) });
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"draw" | "repay">(initialAction);
  const [receipt, setReceipt] = useState<OperationReceipt | null>(null);
  const journal = useOperationJournal(`line:${applicationId}`, lineOperationSchema);
  const [restoring] = useState(() => Boolean(journal.pending));
  const request = useRef<LineOperation | null>(journal.pending);
  async function completeOperation(data: Awaited<ReturnType<typeof getLine>>, payload: LineOperation) {
      const completed = data.operations.find(item => item.request_id === payload.request_id);
      setReceipt({
        title: payload.kind === "draw" ? "Деньги зачислены на счёт" : payload.kind === "repay" ? "Платёж выполнен" : "Кредитная линия закрыта",
        description: payload.kind === "draw" ? "Сумма доступна на расчётном счёте. Долг и свободный лимит обновлены." : payload.kind === "repay" ? "Проценты погашены в первую очередь. Лимит восстановлен на возвращённую часть основного долга." : "Неиспользованный лимит закрыт. Новые выборки недоступны.",
        amount: payload.kind !== "close" ? formatMoneyPrecise(completed?.amount || payload.amount || "0") : undefined,
        facts: payload.kind === "close" ? [] : [
          { label: "Основной долг", value: formatMoneyPrecise(data.principal) },
          { label: "Доступно по линии", value: formatMoneyPrecise(data.available_limit) },
          ...(payload.kind === "repay" && completed ? [{ label: "Возвращено основного долга", value: formatMoneyPrecise(completed.principal_paid) }, { label: "Уплачено процентов", value: formatMoneyPrecise(completed.interest_paid) }] : []),
        ],
        calendarHref: data.schedule[0] ? `/cabinet?mode=calendar&product=app:${applicationId}&date=${data.schedule[0].date}` : undefined,
      });
      journal.clear(); request.current = null;
      setAmount("");
      client.setQueryData(lineKey(applicationId), data);
      await Promise.all([client.invalidateQueries({ queryKey: ["profile"] }), client.invalidateQueries({ queryKey: ["payment-calendar"] }), client.invalidateQueries({ queryKey: ["applications"] })]);
  }
  const operation = useMutation({ mutationFn: (payload: LineOperation) => postLineOperation(applicationId, payload), onSuccess: completeOperation,
    onError: error => { if (error instanceof ApiError && error.status < 500) { journal.clear(); request.current = null; if (error.status === 409) void query.refetch(); } },
  });
  useEffect(() => {
    if (!restoring || !journal.pending || !query.data || operation.isPending || receipt || !query.data.operations.some(item => item.request_id === journal.pending!.request_id)) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) void completeOperation(query.data!, journal.pending!); });
    return () => { active = false; };
  });
  let normalized: string | null = null;
  try { normalized = normalizeMoneyInput(amount) || null; } catch { /* Подсказка появляется у введённой суммы. */ }
  const state = query.data;
  const pendingError = operation.isError && !(operation.error instanceof ApiError && operation.error.status < 500);
  function act(kind: LineOperation["kind"]) {
    if (!state) return;
    const payload: LineOperation = request.current || { kind, ...(kind === "close" ? {} : { amount: normalized! }), base_line_version: state.version, request_id: crypto.randomUUID() };
    if (!journal.save(payload)) return;
    request.current = payload;
    operation.mutate(payload);
  }
  const canRepay = Boolean(state && normalized && Number(normalized) > 0 && Number(normalized) <= Number(state.amount_to_close));
  const canDraw = Boolean(state && normalized && Number(normalized) > 0 && Number(normalized) <= Number(state.available_limit) && !state.overdue_interest && !state.matured);
  function chooseAction(value: "draw" | "repay") {
    setAction(value); setAmount(""); request.current = null; operation.reset();
  }
  function fillAmount(value: string) { setAmount(value); request.current = null; operation.reset(); }
  if (receipt) return <OperationResult receipt={receipt} onDone={onDone} onAnother={state?.status !== "closed" || receipt.title === "Квитанция об операции" ? () => { setReceipt(null); operation.reset(); } : undefined} />;
  if (restoring && journal.pending) return <OperationRecovery checking={query.isFetching} busy={operation.isPending} error={operation.error ? getErrorMessage(operation.error) : query.error ? getErrorMessage(query.error) : undefined} onCheck={() => void query.refetch()} onRetry={() => operation.mutate(journal.pending!)} />;
  return <section className="funding-operation credit-line-operation space-y-4" aria-label="Управление кредитной линией">
    {journal.error && <p role="alert" className="text-destructive">{journal.error}</p>}
    <h3 className="text-lg font-semibold">Один лимит. Много возможностей.</h3>
    {query.isPending && <p role="status">Загружаем лимит и операции…</p>}
    {query.error && <div role="alert">{getErrorMessage(query.error)} <Button onClick={() => void query.refetch()}>Повторить загрузку</Button></div>}
    {state && <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[ ["Одобренный лимит", state.limit], ["Доступно к выборке", state.available_limit], ["Основной долг", state.principal], ["Начисленные проценты", state.accrued_interest] ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-bold">{formatMoney(value)}</dd></div>)}
      </dl>
      <p className="text-sm text-muted-foreground">Ставка {state.annual_rate_percent}% годовых. Срок до {new Date(state.maturity_date + "T12:00:00").toLocaleDateString("ru-RU")}. Платёж сначала погашает проценты, затем основной долг. Лимит восстанавливается на погашенную часть основного долга.</p>
      {state.status === "closed" ? <p role="status" className="font-semibold">Линия закрыта. Лимит больше не доступен и не резервирует нагрузку.</p> : <>
        {(state.matured || state.overdue_interest) && <p role="alert" className="text-destructive">{state.matured ? "Срок линии завершён. Погасите оставшуюся задолженность." : `Нужно погасить просроченные проценты: ${formatMoney(state.interest_due)}. Новые выборки приостановлены.`}</p>}
        <div className="funding-operation-switch" role="group" aria-label="Операция по линии"><button type="button" aria-pressed={action === "draw"} disabled={operation.isPending || pendingError} onClick={() => chooseAction("draw")}>Получить деньги</button><button type="button" aria-pressed={action === "repay"} disabled={operation.isPending || pendingError} onClick={() => chooseAction("repay")}>Внести платёж</button></div>
        <div><FormField id={`line-amount-${applicationId}`} label={action === "draw" ? "Сколько получить на счёт, ₽" : "Сколько внести в погашение, ₽"} inputMode="decimal" placeholder="Укажите любую сумму" value={amount} onChange={event => { if (!operation.isPending && !pendingError) fillAmount(event.target.value); }} disabled={operation.isPending || pendingError} hint={action === "draw" ? `Можно использовать до ${formatMoney(state.available_limit)}. Необязательно брать весь лимит.` : `Можно внести любую положительную сумму до ${formatMoney(state.amount_to_close)}.`} error={amount && (!normalized || Number(normalized) <= 0) ? "Укажите положительную сумму в рублях." : normalized && Number(normalized) > Number(action === "draw" ? state.available_limit : state.amount_to_close) ? action === "draw" ? "Сумма превышает доступный лимит." : "Сумма превышает долг с процентами." : undefined} /></div>
        <div className="funding-presets">{[.25, .5, 1].map(part => <Button key={part} variant="ghost" size="sm" disabled={operation.isPending || pendingError} onClick={() => fillAmount((Math.floor(Number(action === "draw" ? state.available_limit : state.amount_to_close) * 100 * part) / 100).toFixed(2))}>{part * 100}% {part === 1 ? action === "draw" ? "доступного" : "долга" : ""}</Button>)}</div>
        <div className="flex flex-wrap gap-3">
          {action === "draw" ? <ConfirmAction label="Получить деньги по линии" title="Получить часть лимита?" description={`${normalized ? formatMoney(normalized) : "Сумма"} поступит на расчётный счёт; долг увеличится на эту сумму. Операция в демо-кабинете.`} confirmLabel="Подтвердить выборку" disabled={!canDraw || operation.isPending || pendingError || state.status !== "active"} onConfirm={() => act("draw")} /> : <ConfirmAction label="Внести платёж по линии" title="Подтвердить платёж?" description={`${normalized ? formatMoney(normalized) : "Сумма"} спишется со счёта. Сначала погасим проценты, затем основной долг. Лимит восстановится на погашенную часть долга.`} confirmLabel="Подтвердить платёж" disabled={!canRepay || operation.isPending || pendingError} onConfirm={() => act("repay")} />}
          {Number(state.amount_to_close) === 0 && <ConfirmAction label="Закрыть линию" title="Закрыть кредитную линию?" description="Неиспользованный лимит будет закрыт. Для дальнейшего финансирования потребуется новая заявка." confirmLabel="Закрыть лимит" disabled={operation.isPending || pendingError} onConfirm={() => act("close")} variant="outline" />}
        </div>
      </>}
      {operation.isPending && <p role="status">Выполняем операцию…</p>}
      {operation.error && <p role="alert" className="text-destructive">{getErrorMessage(operation.error)} {pendingError && operation.variables && <Button variant="outline" onClick={() => operation.mutate(operation.variables!)}>Повторить ту же операцию</Button>}</p>}
      <details><summary className="cursor-pointer font-semibold">История операций · {state.operations.length}</summary><ul className="mt-3 space-y-3">{state.operations.length ? state.operations.map(item => <li key={item.operation_id} className="rounded-xl bg-secondary p-3 text-sm"><strong>{({draw: "Выборка", repay: "Платёж", close: "Закрытие"} as Record<string,string>)[item.kind]} · {formatMoney(item.amount)}</strong><span className="ml-3">{new Date(item.date + "T12:00:00").toLocaleDateString("ru-RU")}</span>{item.kind === "repay" && <p className="mt-1 text-xs">Основной долг: {formatMoney(item.principal_paid)} · проценты: {formatMoney(item.interest_paid)}</p>}<Button variant="ghost" size="sm" onClick={() => setReceipt({ title: "Квитанция об операции", description: "Операция по кредитной линии подтверждена сервером.", amount: formatMoneyPrecise(item.amount), facts: [{ label: "Дата", value: new Date(item.date + "T12:00:00").toLocaleDateString("ru-RU") }, { label: "Номер операции", value: item.operation_id }, { label: "Основной долг погашен", value: formatMoneyPrecise(item.principal_paid) }, { label: "Уплачено процентов", value: formatMoneyPrecise(item.interest_paid) }], anotherLabel: "Вернуться к истории" })}>Квитанция</Button></li>) : <li>Выборок и платежей пока нет. Открытие лимита не зачисляет деньги на счёт.</li>}</ul></details>
      <details><summary className="cursor-pointer font-semibold">Ближайшие выплаты при текущем долге</summary><p className="mt-2 text-xs text-muted-foreground">Прогноз без новых выборок: ежемесячная оплата процентов и возврат остатка основного долга к концу срока.</p><ul className="mt-3 space-y-2 text-sm">{state.schedule.length ? state.schedule.map(row => <li key={row.date}>{new Date(row.date + "T12:00:00").toLocaleDateString("ru-RU")} · <strong>{formatMoney(row.total_payment)}</strong> · основной долг {formatMoney(row.principal)}, проценты {formatMoney(row.interest)}</li>) : <li>Неиспользованный лимит не создаёт платежей.</li>}</ul></details>
    </>}
  </section>;
}
