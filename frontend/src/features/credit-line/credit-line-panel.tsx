import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoney } from "@/shared/lib/format";
import { normalizeMoneyInput } from "@/features/applications/model/need";
import { Button } from "@/shared/ui/button";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { FormField } from "@/shared/ui/form-field";
import { getLine, postLineOperation, lineKey, type LineOperation } from "./api";

export function RevolvingTerms({ value }: { value: unknown }) {
  const data = z.object({ capacity_reserve: z.string(), interest_30_days_full_limit: z.string() }).safeParse(value);
  if (!data.success) return null;
  return <div className="mt-4 space-y-2 rounded-xl bg-secondary p-4 text-sm">
    <p>Берите деньги частями. Погашение основного долга восстанавливает доступный лимит.</p>
    <p>Проценты — на фактический долг, платёж ежемесячно. Основной долг нужно вернуть до конца срока линии. За неиспользованный лимит комиссии нет.</p>
    <p><strong>Пример стоимости:</strong> {formatMoney(data.data.interest_30_days_full_limit)} за 30 дней использования всего лимита, при расчёте на 365 дней в году. При меньшем долге или более раннем погашении проценты ниже.</p>
    <p className="text-xs text-muted-foreground">Резерв нагрузки для проверки платёжеспособности — {formatMoney(data.data.capacity_reserve)} в месяц. Это проверка обслуживания всего лимита, а не фиксированный платёж по договору.</p>
  </div>;
}

export function CreditLinePanel({ applicationId }: { applicationId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: lineKey(applicationId), queryFn: ({ signal }) => getLine(applicationId, signal) });
  const [amount, setAmount] = useState("");
  const request = useRef<LineOperation | null>(null);
  const operation = useMutation({
    mutationFn: (payload: LineOperation) => postLineOperation(applicationId, payload),
    onSuccess: async data => {
      request.current = null;
      setAmount("");
      client.setQueryData(lineKey(applicationId), data);
      await Promise.all([client.invalidateQueries({ queryKey: ["profile"] }), client.invalidateQueries({ queryKey: ["payment-calendar"] }), client.invalidateQueries({ queryKey: ["applications"] })]);
    },
    onError: error => { if (error instanceof ApiError && error.status < 500) { request.current = null; if (error.status === 409) void query.refetch(); } },
  });
  let normalized: string | null = null;
  try { normalized = normalizeMoneyInput(amount) || null; } catch { /* Подсказка появляется у введённой суммы. */ }
  const state = query.data;
  const pendingError = operation.isError && !(operation.error instanceof ApiError && operation.error.status < 500);
  function act(kind: LineOperation["kind"]) {
    if (!state) return;
    const payload: LineOperation = request.current || { kind, ...(kind === "close" ? {} : { amount: normalized! }), base_line_version: state.version, request_id: crypto.randomUUID() };
    request.current = payload;
    operation.mutate(payload);
  }
  const canRepay = Boolean(state && normalized && Number(normalized) > 0 && Number(normalized) <= Number(state.amount_to_close));
  const canDraw = Boolean(state && normalized && Number(normalized) > 0 && Number(normalized) <= Number(state.available_limit) && !state.overdue_interest && !state.matured);
  return <section className="space-y-4 rounded-2xl border border-primary/30 bg-card p-5" aria-label="Управление кредитной линией">
    <h3 className="text-lg font-bold">Управление кредитной линией</h3>
    {query.isPending && <p role="status">Загружаем лимит и операции…</p>}
    {query.error && <div role="alert">{getErrorMessage(query.error)} <Button onClick={() => void query.refetch()}>Повторить загрузку</Button></div>}
    {state && <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[ ["Одобренный лимит", state.limit], ["Доступно к выборке", state.available_limit], ["Основной долг", state.principal], ["Начисленные проценты", state.accrued_interest] ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-bold">{formatMoney(value)}</dd></div>)}
      </dl>
      <p className="text-sm text-muted-foreground">Ставка {state.annual_rate_percent}% годовых. Срок до {new Date(state.maturity_date + "T12:00:00").toLocaleDateString("ru-RU")}. Платёж сначала погашает проценты, затем основной долг. Лимит восстанавливается на погашенную часть основного долга.</p>
      {state.status === "closed" ? <p role="status" className="font-semibold">Линия закрыта. Лимит больше не доступен и не резервирует нагрузку.</p> : <>
        {(state.matured || state.overdue_interest) && <p role="alert" className="text-destructive">{state.matured ? "Срок линии завершён. Погасите оставшуюся задолженность." : `Нужно погасить просроченные проценты: ${formatMoney(state.interest_due)}. Новые выборки приостановлены.`}</p>}
        <div className="max-w-sm"><FormField id={`line-amount-${applicationId}`} label="Сумма операции, ₽" inputMode="decimal" value={amount} onChange={event => { if (!operation.isPending && !pendingError) { setAmount(event.target.value); request.current = null; operation.reset(); } }} disabled={operation.isPending || pendingError} />{amount && (!normalized || Number(normalized) <= 0) && <p role="alert" className="mt-2 text-sm text-destructive">Укажите положительную сумму в рублях.</p>}</div>
        <div className="flex flex-wrap gap-3">
          <ConfirmAction label="Получить деньги по линии" title="Получить часть лимита?" description={`${normalized ? formatMoney(normalized) : "Сумма"} поступит на счёт; долг по линии увеличится. Операция моделируется.`} confirmLabel="Подтвердить выборку" disabled={!canDraw || operation.isPending || pendingError || state.status !== "active"} onConfirm={() => act("draw")} />
          <ConfirmAction label="Внести платёж по линии" title="Подтвердить платёж?" description={`${normalized ? formatMoney(normalized) : "Сумма"} спишется со счёта. Сначала погашаются начисленные проценты, затем основной долг. Доступный лимит увеличится только на погашенный основной долг.`} confirmLabel="Подтвердить платёж" disabled={!canRepay || operation.isPending || pendingError} onConfirm={() => act("repay")} variant="outline" />
          {Number(state.amount_to_close) === 0 && <ConfirmAction label="Закрыть линию" title="Закрыть кредитную линию?" description="Неиспользованный лимит будет закрыт. Для дальнейшего финансирования потребуется новая заявка." confirmLabel="Закрыть лимит" disabled={operation.isPending || pendingError} onConfirm={() => act("close")} variant="outline" />}
        </div>
        {Number(state.amount_to_close) > 0 && <Button variant="ghost" disabled={operation.isPending || pendingError} onClick={() => { setAmount(state.amount_to_close); request.current = null; operation.reset(); }}>Подставить всё к погашению: {formatMoney(state.amount_to_close)}</Button>}
      </>}
      {operation.isPending && <p role="status">Выполняем операцию…</p>}
      {operation.error && <p role="alert" className="text-destructive">{getErrorMessage(operation.error)} {pendingError && operation.variables && <Button variant="outline" onClick={() => operation.mutate(operation.variables!)}>Повторить ту же операцию</Button>}</p>}
      {operation.isSuccess && <p role="status">Операция выполнена. Остаток, долг и календарь обновлены.</p>}
      <details><summary className="cursor-pointer font-semibold">История операций · {state.operations.length}</summary><ul className="mt-3 space-y-3">{state.operations.length ? state.operations.map(item => <li key={item.operation_id} className="rounded-xl bg-secondary p-3 text-sm"><strong>{({draw: "Выборка", repay: "Платёж", close: "Закрытие"} as Record<string,string>)[item.kind]} · {formatMoney(item.amount)}</strong><span className="ml-3">{new Date(item.date + "T12:00:00").toLocaleDateString("ru-RU")}</span>{item.kind === "repay" && <p className="mt-1 text-xs">Основной долг: {formatMoney(item.principal_paid)} · проценты: {formatMoney(item.interest_paid)}</p>}</li>) : <li>Выборок и платежей пока нет. Открытие лимита не зачисляет деньги на счёт.</li>}</ul></details>
      <details><summary className="cursor-pointer font-semibold">Ближайшие выплаты при текущем долге</summary><p className="mt-2 text-xs text-muted-foreground">Прогноз без новых выборок: ежемесячная оплата процентов и возврат остатка основного долга к концу срока.</p><ul className="mt-3 space-y-2 text-sm">{state.schedule.length ? state.schedule.map(row => <li key={row.date}>{new Date(row.date + "T12:00:00").toLocaleDateString("ru-RU")} · <strong>{formatMoney(row.total_payment)}</strong> · основной долг {formatMoney(row.principal)}, проценты {formatMoney(row.interest)}</li>) : <li>Неиспользованный лимит не создаёт платежей.</li>}</ul></details>
    </>}
  </section>;
}
