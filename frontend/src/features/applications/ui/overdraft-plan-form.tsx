import { useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import { Disclosure } from "@/shared/ui/disclosure";
import { formatMoney } from "@/shared/lib/format";
import { FieldOrigin } from "@/shared/ui/field-origin";
import { originFor } from "@/shared/lib/field-source";
import type { ApplicationView } from "../api/applications";
import { useCashFlowDraft } from "../model/use-cash-flow-draft";
import {
  buildOverdraftPlan,
  planPeriod,
  type PlanDraft,
  type PlanRow,
  PlanValidationError,
} from "../model/overdraft-plan";

export function CashFlowFields({ view, draft, setDraft, bankCash, direction, error }: {
  view: ApplicationView;
  draft: PlanDraft;
  setDraft: Dispatch<SetStateAction<PlanDraft>>;
  bankCash?: string | null;
  direction?: "inflow" | "outflow";
  error?: {fieldId: string; message: string} | null;
}) {
  const allLoans = view.application.financials.existing_loans || [];
  const loans = allLoans.filter(loan => !loan.schedule);
  const editableRows = draft.rows.filter(row => !row.id.startsWith("bank-payment:"));
  const period = planPeriod(draft);
  const fieldError = (id: string) => error?.fieldId === id ? error.message : undefined;
  function add(direction: "inflow" | "outflow") {
    setDraft((current) => ({
      ...current,
      debtConfirmed: false,
      rows: [
        ...current.rows,
        {
          id: crypto.randomUUID(),
          date: planPeriod(current).end,
          direction,
          amount: "",
          loanId: "",
        },
      ],
    }));
  }
  function rowChange(id: string, changes: Partial<PlanRow>) {
    setDraft((current) => ({
      ...current,
      debtConfirmed: false,
      rows: current.rows.map((row) =>
        row.id === id ? { ...row, ...changes } : row,
      ),
    }));
  }
  return <div className="space-y-5">
              {allLoans.some(loan => loan.schedule) && <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Банковские графики учтём автоматически. В прогнозе оставим собственные деньги на платежи по кредитам.</p>}
              <p className="self-center text-sm text-muted-foreground">
                Остаток из данных банка:{" "}
                <strong className="text-foreground">
                  {formatMoney(bankCash || "0")}
                </strong>
              </p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-bold">{direction === "outflow" ? "Предстоящие платежи" : direction === "inflow" ? "Ожидаемые поступления" : "Предстоящие платежи и поступления"}</h4>
                <div className="flex flex-wrap gap-2">
                  {direction !== "inflow" && <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => add("outflow")}
                  >
                    <Plus aria-hidden="true" />
                    Расход
                  </Button>}
                  {direction !== "outflow" && <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => add("inflow")}
                  >
                    <Plus aria-hidden="true" />
                    Поступление
                  </Button>}
                </div>
              </div>
              {editableRows.filter(row => !direction || row.direction === direction).length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                  {direction === "inflow" ? "Если поступления пока неизвестны, оставьте этот раздел пустым. В расчёте покажем, останется ли непогашенный долг." : direction === "outflow" ? "Добавьте платёж, на который нужны деньги." : "Добавьте известные расходы и поступления. Неизвестную выручку указывать не нужно."}
                </p>
              )}
              {editableRows.filter(row => !direction || row.direction === direction).map((row, index) => (
                <div
                  key={row.id}
                  className="rounded-2xl border border-border bg-background p-4"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold">
                      {row.direction === "inflow" ? "Ожидаемое поступление" : "Предстоящий платёж"}{" "}
                      {index + 1}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Убрать операцию ${index + 1}`}
                      disabled={row.id.startsWith("bank-payment:")}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          debtConfirmed: false,
                          rows: current.rows.filter(
                            (item) => item.id !== row.id,
                          ),
                        }))
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                    <FormField
                      id={`operation-date-${row.id}`}
                      error={fieldError(`operation-date-${row.id}`)}
                      label={row.direction === "inflow" ? "Когда поступят деньги" : "Когда нужно заплатить"}
                      readOnly={row.id.startsWith("bank-payment:")}
                      type="date"
                      value={row.date}
                      onChange={(event) =>
                        rowChange(row.id, { date: event.target.value })
                      }
                    />
                    <FieldOrigin source={originFor(view.field_sources, `plan/${encodeURIComponent(row.id)}/date`)} />
                    </div>
                    <div>
                    <FormField
                      id={`operation-amount-${row.id}`}
                      error={fieldError(`operation-amount-${row.id}`)}
                      label={row.direction === "inflow" ? "Сколько поступит, ₽" : "Сколько нужно заплатить, ₽"}
                      readOnly={row.id.startsWith("bank-payment:")}
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(event) =>
                        rowChange(row.id, { amount: event.target.value })
                      }
                    />
                    <FieldOrigin source={originFor(view.field_sources, `plan/${encodeURIComponent(row.id)}/amount`)} />
                    </div>
                    {row.direction === "outflow" && loans.length > 0 && (
                      <ChoiceField
                        id={`operation-loan-${row.id}`}
                        label="Тип расхода"
                        emptyLabel="Расход бизнеса"
                        error={fieldError(`operation-loan-${row.id}`)}
                        value={row.loanId}
                        onValueChange={(value) =>
                          rowChange(row.id, { loanId: value })
                        }
                        options={loans.map((loan, loanIndex) => ({
                          value: loan.loan_id,
                          label: `Платёж по кредиту ${loanIndex + 1}`,
                        }))}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {direction !== "outflow" && loans.length > 0 && (
              <label className="flex items-start gap-3 rounded-xl bg-background p-4 text-xs leading-relaxed">
                <input
                  type="checkbox"
                  id="plan-debt-confirmed"
                  aria-invalid={error?.fieldId === "plan-debt-confirmed" || undefined}
                  aria-describedby={error?.fieldId === "plan-debt-confirmed" ? "plan-debt-confirmed-error" : undefined}
                  className="mt-0.5 size-4 accent-primary"
                  checked={draft.debtConfirmed}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      debtConfirmed: event.target.checked,
                    }))
                  }
                />
                Я учёл в расходах платежи по действующим кредитам на этот период
                или подтверждаю, что их в нём нет.
              </label>
            )}
            {fieldError("plan-debt-confirmed") && <p id="plan-debt-confirmed-error" role="alert" className="text-xs text-destructive">{error!.message}</p>}
    {direction !== "outflow" && <Disclosure title="Настройки прогноза" description="Необязательно · даты расчёта и запас денег на текущие расходы">
      <p className="my-3 text-sm leading-relaxed text-muted-foreground">По умолчанию считаем до последней известной операции. Продлите период, если хотите увидеть остаток позже. Резерв — сумма, которую в прогнозе не тратим: например, 50 000 ₽ на ежедневные расходы. Деньги на счёте не блокируются.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="plan-start"
                error={fieldError("plan-start")}
                label="Считать с даты"
                type="date"
                value={period.start}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    start: event.target.value,
                    automaticPeriod: false,
                    debtConfirmed: false,
                  }))
                }
              />
              <FormField
                id="plan-end"
                error={fieldError("plan-end")}
                label="Показать прогноз до"
                type="date"
                value={period.end}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    end: event.target.value,
                    automaticPeriod: false,
                    debtConfirmed: false,
                  }))
                }
              />
              <FormField
                id="plan-reserve"
                error={fieldError("plan-reserve")}
                label="Оставить на текущие расходы, ₽"
                hint="0 ₽ — используем в прогнозе весь доступный остаток."
                inputMode="decimal"
                value={draft.reserve}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reserve: event.target.value,
                  }))
                }
              />
            </div>
      {!draft.automaticPeriod && <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(current => ({ ...current, automaticPeriod: true }))}>Определить период по датам</Button>}
    </Disclosure>}
  </div>;
}

export function OverdraftPlanForm({
  view,
  busy,
  onSave,
  forceVisible = false,
  submitLabel = "Сохранить платежи и поступления",
}: {
  view: ApplicationView;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
  forceVisible?: boolean;
  submitLabel?: string;
}) {
  const { draft, setDraft, bankCash } = useCashFlowDraft(view);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<PlanValidationError | null>(null);
  const loans = view.application.financials.existing_loans || [];
  const show =
    view.application.need.preferred_product === "overdraft" ||
    view.application.need.financing_pattern === "cash_gap" ||
    Boolean(view.application.product_details?.overdraft);
  const loanMode =
    view.application.need.preferred_product === "working_capital_loan" ||
    view.application.need.financing_pattern === "gradual_repayment";
  if (!show && !forceVisible) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const plan = buildOverdraftPlan(
        { ...draft, openingCash: bankCash || "0.00" },
        loans.filter(loan => !loan.schedule).map((loan) => loan.loan_id),
      );
      onSave({
        product_details: { overdraft: plan },
        ...(!view.application.need.purpose
          ? { "need.purpose": "working_capital" }
          : {}),
        ...(!view.application.need.financing_pattern
          ? {
              "need.financing_pattern": loanMode
                ? "gradual_repayment"
                : "cash_gap",
            }
          : {}),
      });
      setError("");
      setFieldError(null);
    } catch (cause) {
      setFieldError(cause instanceof PlanValidationError ? cause : null);
      setError(
        cause instanceof Error ? cause.message : "Проверьте денежный план.",
      );
      if (cause instanceof PlanValidationError) requestAnimationFrame(() => {
        const input = document.getElementById(cause.fieldId);
        let disclosure = input?.closest("details");
        while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest("details") || null; }
        input?.focus();
      });
    }
  }

  return (
    <Card className="gap-0 border-border bg-card/70">
      <CardHeader className="pb-5">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">
          {loanMode ? "Кредит на оборотные цели" : "Овердрафт"}
        </p>
        <h3 className="text-xl font-semibold tracking-tight">
          Когда нужно заплатить и когда поступят деньги?
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {loanMode
            ? "Добавьте известные поступления и расходы. Покажем остаток с учётом получения кредита и его платежей за этот период."
            : "Укажите ближайший платёж и ожидаемое поступление. Учтём остаток на счёте, определим нехватку и стоимость финансирования до возврата денег."}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
            <CashFlowFields view={view} draft={draft} setDraft={update => {setDraft(update);if(fieldError){setFieldError(null);setError("");}}} bankCash={bankCash} error={fieldError}/>
            {error && !fieldError && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit">
              <Save aria-hidden="true" />
              {submitLabel}
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
