import { useState, type FormEvent } from "react";
import { z } from "zod";
import {
  CashFlowChart,
  describeIssue,
  flowDaysSchema,
  normalizeMoneyInput,
  type ApplicationView,
} from "@/features/applications";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { Proposal, ProposalPreview } from "../api/chat";

const rowsSchema = z.array(
  z.object({
    transaction_id: z.string(),
    amount: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    direction: z.string().nullable().optional(),
  }),
);

function Correction({
  label,
  initial,
  type = "text",
  disabled,
  onSave,
}: {
  label: string;
  initial: string;
  type?: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSave(type === "date" ? value : normalizeMoneyInput(value) || "");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте значение.");
    }
  }
  return (
    <details className="collected-correction">
      <summary>Исправить {label.toLowerCase()}</summary>
      <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
        <Input
          aria-label={`Исправить: ${label}`}
          type={type}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={disabled || !value}
        >
          Сохранить исправление
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

export function CollectedData({
  view,
  proposal,
  preview,
  busy,
  loading,
  onEdit,
}: {
  view: ApplicationView;
  proposal?: Proposal;
  preview?: ProposalPreview;
  busy: boolean;
  loading: boolean;
  onEdit: (
    changes: Record<string, unknown>,
    plan?: Record<string, unknown>,
  ) => void;
}) {
  const need = view.application.need,
    plan = view.application.product_details?.overdraft;
  const rows = rowsSchema.safeParse(
    plan && typeof plan === "object" && "transactions" in plan
      ? plan.transactions
      : [],
  );
  const latest = view.explorations.at(-1);
  const result =
    preview?.result ||
    (!proposal &&
    latest?.application_version === view.application.application_version
      ? latest.result
      : undefined);
  const days = flowDaysSchema.safeParse(
    result?.daily || result?.calculation?.daily,
  );
  const source = proposal
    ? "Предложено из разговора · проверьте значения"
    : "Подтверждённые данные";
  return (
    <div className="assistant-live space-y-5" aria-live="polite">
      <div className="rounded-2xl bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">
          {source}
        </p>
        <h2 className="mt-2 text-xl font-extrabold">
          {loading
            ? "Обновляем расчёт…"
            : rows.success && rows.data.length
              ? "Собираем денежный план"
              : need.requested_amount
                ? "Подбираем финансирование"
                : "Сначала разберём вашу задачу"}
        </h2>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="collected-fact">
          <dt>Задача</dt>
          <dd>
            {need.purpose === "working_capital"
              ? need.financing_pattern === "cash_gap"
                ? "Заплатить до выручки"
                : "Оборотные расходы"
              : need.purpose
                ? "Обсуждаем подходящий продукт"
                : "Уточняем"}
          </dd>
        </div>
        <div className="collected-fact" key={`amount-${need.requested_amount}`}>
          <dt>Нужная сумма</dt>
          <dd>
            {need.requested_amount
              ? formatMoney(need.requested_amount)
              : "Уточняем"}
          </dd>
          {proposal && (
            <Correction
              label="Сумма"
              initial={need.requested_amount || ""}
              disabled={busy}
              onSave={(value) => onEdit({ "need.requested_amount": value })}
            />
          )}
        </div>
        {need.term_months && (
          <div className="collected-fact">
            <dt>Срок</dt>
            <dd>{need.term_months} мес.</dd>
          </div>
        )}
        <div className="collected-fact">
          <dt>Остаток из данных банка</dt>
          <dd>
            {formatMoney(
              view.client_data.bank_financials?.cash_balance ||
                view.application.financials.cash_balance ||
                "0",
            )}
          </dd>
        </div>
      </dl>
      {rows.success && rows.data.length > 0 && (
        <section className="rounded-2xl border border-border p-4">
          <h3 className="font-bold">Поступления и расходы</h3>
          <ol className="mt-3 space-y-3">
            {rows.data.map((row) => (
              <li
                key={`${row.transaction_id}:${row.amount}:${row.date}`}
                className="collected-operation"
              >
                <div>
                  <span className="text-xs text-muted-foreground">
                    {row.direction === "outflow"
                      ? "Нужно заплатить"
                      : row.direction === "inflow"
                        ? "Деньги поступят"
                        : "Уточняем тип платежа"}
                  </span>
                  <strong className="block text-lg">
                    {row.amount ? formatMoney(row.amount) : "Уточняем сумму"}
                  </strong>
                </div>
                <time dateTime={row.date || undefined}>
                  {row.date
                    ? new Date(row.date + "T12:00:00").toLocaleDateString(
                        "ru-RU",
                      )
                    : "Уточняем дату"}
                </time>
                {proposal && (
                  <div className="collected-operation-edit">
                    <Correction
                      label="Сумма платежа"
                      initial={row.amount || ""}
                      disabled={busy}
                      onSave={(value) =>
                        onEdit(
                          {},
                          {
                            transactions: [
                              {
                                transaction_id: row.transaction_id,
                                amount: value,
                              },
                            ],
                          },
                        )
                      }
                    />
                    <Correction
                      label="Дата платежа"
                      initial={row.date || ""}
                      type="date"
                      disabled={busy}
                      onSave={(value) =>
                        onEdit(
                          {},
                          {
                            transactions: [
                              {
                                transaction_id: row.transaction_id,
                                date: value,
                              },
                            ],
                          },
                        )
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {days.success && <CashFlowChart days={days.data} />}
      {result?.calculation && (
        <dl className="grid grid-cols-2 gap-3">
          <div className="collected-fact">
            <dt>Нужный лимит</dt>
            <dd>{formatMoney(result.calculation.required_limit)}</dd>
          </div>
          <div className="collected-fact">
            <dt>Проценты по плану</dt>
            <dd>{formatMoney(result.calculation.total_interest)}</dd>
          </div>
        </dl>
      )}
      {proposal?.conflicts?.length ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          Данные заявки изменились. Обновите диалог и проверьте предложенные
          значения перед подтверждением.
        </p>
      ) : null}
      {(preview?.issues || proposal?.plan_issues || []).map((issue, index) => (
        <p className="text-xs text-muted-foreground" key={index}>
          {describeIssue(issue)}
        </p>
      ))}
      {proposal && (result?.options || []).length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-bold">Предварительные варианты</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {result?.options?.slice(0, 4).map((option) => (
              <div
                key={option.option_id || option.offer_id}
                className="collected-fact"
              >
                <p className="text-xs text-muted-foreground">
                  {option.product_id === "overdraft"
                    ? "Овердрафт"
                    : `${option.term_months} мес.`}
                </p>
                <p className="mt-1 text-lg font-extrabold">
                  {formatMoney(option.amount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {option.monthly_payment
                    ? `${formatMoney(option.monthly_payment)} в месяц`
                    : "Погашение из поступлений"}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Подтвердите данные, чтобы выбрать условия.
          </p>
        </section>
      )}
      {!proposal &&
        !need.requested_amount &&
        (!rows.success || !rows.data.length) && (
          <p className="text-sm text-muted-foreground">
            Расскажите, на что нужны деньги. Здесь появятся суммы, даты, расчёт
            и варианты финансирования.
          </p>
        )}
    </div>
  );
}
