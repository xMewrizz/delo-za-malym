import { useState, type FormEvent, type ReactNode } from "react";
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
import { FieldOrigin } from "@/shared/ui/field-origin";
import { originFor } from "@/shared/lib/field-source";
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
  expenseImport,
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
  expenseImport?: ReactNode;
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
    <div className="assistant-live space-y-5" aria-busy={loading}>
      <div className="rounded-2xl bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">
          {source}
        </p>
        <h2 className="mt-2 text-xl font-semibold">
          {rows.success && rows.data.length
              ? "Уточняем платежи и поступления"
              : need.requested_amount
                ? "Подбираем финансирование"
                : "Сначала разберём вашу задачу"}
        </h2>
      </div>
      {result?.calculation?.required_limit === "0.00" && <p className="rounded-xl border border-border bg-background p-4 text-sm leading-relaxed text-muted-foreground">
        По уже указанным платежам нехватки денег нет. Если есть другие предстоящие расходы или неприкосновенный остаток, расскажите об этом Луме — я учту их в плане.
      </p>}
      <dl className="collected-facts grid grid-cols-2 gap-3">
        <div className="collected-fact" data-live-field="purpose">
          <dt>Задача</dt>
          <dd>
            {need.purpose === "investment" ? "Оборудование и развитие" : need.purpose === "refinancing" ? "Рефинансирование действующих кредитов" : need.purpose === "working_capital"
              ? need.financing_pattern === "cash_gap"
                ? "Заплатить до выручки"
                : "Оборотные расходы"
              : need.purpose
                ? "Обсуждаем подходящий продукт"
                : "Уточняем"}
          </dd>
        </div>
        <div className="collected-fact" data-live-field="amount">
          <dt>{need.preferred_product === "revolving_credit_line" ? "Желаемый лимит" : need.preferred_product === "refinancing" ? "На погашение долгов" : "Нужная сумма"}</dt>
          <dd>
            {need.requested_amount
              ? formatMoney(need.requested_amount)
              : "Уточняем"}
          </dd>
          <FieldOrigin
            source={
              originFor(proposal?.field_sources, "need.requested_amount") ||
              originFor(view.field_sources, "need.requested_amount")
            }
          />
        </div>
        {need.preferred_product === "investment_loan" && <>
          <div className="collected-fact"><dt>Стоимость проекта</dt><dd>{need.project_cost ? formatMoney(need.project_cost) : "Уточняем"}</dd><FieldOrigin source={originFor(proposal?.field_sources, "need.project_cost") || originFor(view.field_sources, "need.project_cost")} />{proposal && <Correction label="Стоимость проекта" initial={need.project_cost || ""} disabled={busy} onSave={value => onEdit({"need.project_cost": value})} />}</div>
          <div className="collected-fact"><dt>Собственный взнос</dt><dd>{need.own_funds ? formatMoney(need.own_funds) : "Уточняем"}</dd>{proposal && <Correction label="Собственный взнос" initial={need.own_funds || ""} disabled={busy} onSave={value => onEdit({"need.own_funds": value})} />}</div>
          <div className="collected-fact"><dt>Отсрочка долга</dt><dd>{need.principal_grace_months == null ? "Уточняем" : need.principal_grace_months ? need.principal_grace_months + " мес., проценты ежемесячно" : "Без отсрочки"}</dd></div>
        </>}
        {need.term_months && (
          <div className="collected-fact" data-live-field="term">
            <dt>Срок</dt>
            <dd>{need.term_months} мес.</dd>
          </div>
        )}
        <div className="collected-fact" data-live-field="bank-balance" data-live-static="true">
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
      {expenseImport}
      {rows.success && rows.data.length > 0 && (
        <section className="rounded-2xl border border-border p-4">
          <h3 className="font-bold">Поступления и расходы</h3>
          <ol className="mt-3 space-y-3">
            {rows.data.map((row) => (
              <li
                key={row.transaction_id}
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
                  <FieldOrigin
                    source={
                      originFor(
                        proposal?.field_sources,
                        `plan/${encodeURIComponent(row.transaction_id)}/amount`,
                      ) ||
                      originFor(
                        view.field_sources,
                        `plan/${encodeURIComponent(row.transaction_id)}/amount`,
                      )
                    }
                  />
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
                      key={`amount-${row.amount}`}
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
                      key={`date-${row.date}`}
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
      {proposal && (days.success || result?.calculation) && <details className="collected-preview">
        <summary>Предварительный расчёт движения денег</summary>
        <div className="mt-4 space-y-4">
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
        </div>
      </details>}
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
