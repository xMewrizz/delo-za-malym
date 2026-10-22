import { useState, type Dispatch, type SetStateAction, type FormEvent } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import { formatMoney } from "@/shared/lib/format";
import type { ApplicationView } from "../api/applications";
import { useCashFlowDraft } from "../model/use-cash-flow-draft";
import {
  buildOverdraftPlan,
  planPeriod,
  type PlanDraft,
  type PlanRow,
} from "../model/overdraft-plan";

export function CashFlowFields({ view, draft, setDraft, bankCash }: {
  view: ApplicationView;
  draft: PlanDraft;
  setDraft: Dispatch<SetStateAction<PlanDraft>>;
  bankCash?: string | null;
}) {
  const allLoans = view.application.financials.existing_loans || [];
  const loans = allLoans.filter(loan => !loan.schedule);
  const period = planPeriod(draft);
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
              {allLoans.some(loan => loan.schedule) && <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Платежи по действующим кредитам добавим автоматически по графикам банка. Их можно посмотреть в платёжном календаре.</p>}
              <p className="self-center text-sm text-muted-foreground">
                Остаток из данных банка:{" "}
                <strong className="text-foreground">
                  {formatMoney(bankCash || "0")}
                </strong>
              </p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="font-bold">Предстоящие платежи и поступления</h4>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => add("outflow")}
                  >
                    <Plus aria-hidden="true" />
                    Расход
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => add("inflow")}
                  >
                    <Plus aria-hidden="true" />
                    Поступление
                  </Button>
                </div>
              </div>
              {draft.rows.length === 0 && (
                <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Добавьте платёж, на который нужны деньги, и ожидаемое поступление.
                </p>
              )}
              {draft.rows.map((row, index) => (
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
                    <FormField
                      id={`operation-date-${row.id}`}
                      label={row.direction === "inflow" ? "Когда поступят деньги" : "Когда нужно заплатить"}
                      readOnly={row.id.startsWith("bank-payment:")}
                      type="date"
                      value={row.date}
                      onChange={(event) =>
                        rowChange(row.id, { date: event.target.value })
                      }
                    />
                    <FormField
                      id={`operation-amount-${row.id}`}
                      label={row.direction === "inflow" ? "Сколько поступит, ₽" : "Сколько нужно заплатить, ₽"}
                      readOnly={row.id.startsWith("bank-payment:")}
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(event) =>
                        rowChange(row.id, { amount: event.target.value })
                      }
                    />
                    {row.direction === "outflow" && loans.length > 0 && (
                      <ChoiceField
                        id={`operation-loan-${row.id}`}
                        label="Связать с платежом по кредиту"
                        value={row.loanId}
                        onValueChange={(value) =>
                          rowChange(row.id, { loanId: value })
                        }
                        options={loans.map((loan, loanIndex) => ({
                          value: loan.loan_id,
                          label: `Кредит ${loanIndex + 1}`,
                        }))}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {loans.length > 0 && (
              <label className="flex items-start gap-3 rounded-xl bg-background p-4 text-xs leading-relaxed">
                <input
                  type="checkbox"
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
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-semibold">Резерв и период расчёта</summary>
      <p className="my-3 text-xs text-muted-foreground">Период определяем по датам платежей и поступлений. Здесь его можно расширить и оставить запас денег на счёте.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="plan-start"
                label="Начало периода"
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
                label="Конец периода"
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
                label="Неприкосновенный резерв, ₽"
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
    </details>
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
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверьте денежный план.",
      );
    }
  }

  return (
    <Card className="gap-0 border-border bg-card/70">
      <CardHeader className="pb-5">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">
          {loanMode ? "Кредит на оборотные цели" : "Овердрафт"}
        </p>
        <h3 className="text-xl font-extrabold tracking-tight">
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
            <CashFlowFields view={view} draft={draft} setDraft={setDraft} bankCash={bankCash} />
            {error && (
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
