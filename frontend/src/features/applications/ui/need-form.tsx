import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { FieldOrigin } from "@/shared/ui/field-origin";
import { originFor } from "@/shared/lib/field-source";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import { readSaved, useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { CashFlowFields } from "./overdraft-plan-form";
import { useCashFlowDraft } from "../model/use-cash-flow-draft";
import { buildOverdraftPlan } from "../model/overdraft-plan";
import {
  buildNeedChanges,
  draftFromApplication,
  mergeNeedDraft,
  type NeedDraft,
} from "../model/need";

const purposes = [
  { value: "working_capital", label: "Оборотные расходы" },
  { value: "investment", label: "Развитие и оборудование" },
  { value: "contract_execution", label: "Исполнение контракта" },
  { value: "refinancing", label: "Рефинансирование" },
  { value: "other", label: "Другая задача" },
];

export function NeedForm({
  view,
  busy,
  onSave,
  continueToNextStep = false,
}: {
  view: ApplicationView;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
  continueToNextStep?: boolean;
}) {
  const base = useMemo(() => draftFromApplication(view), [view]),
    snapshotKey = `delo-need-source:${view.application.application_id}`;
  const [draft, setDraft] = useSavedDraft<NeedDraft>(
    `delo-need:${view.application.application_id}:${view.application.application_version}`,
    mergeNeedDraft(base, readSaved(snapshotKey, null)),
  );
  useEffect(() => {
    try {
      localStorage.setItem(snapshotKey, JSON.stringify({ base, draft }));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [snapshotKey, base, draft]);
  const [error, setError] = useState("");
  const [chooseProduct, setChooseProduct] = useState(Boolean(draft.preferredProduct));
  const cashFlow = useCashFlowDraft(view, true);
  const [includePayments, setIncludePayments] = useSavedDraft(
    `delo-include-payments:${view.application.application_id}`,
    Boolean(view.application.product_details?.overdraft),
  );
  const nextIsPlan =
    draft.preferredProduct === "overdraft" ||
    draft.financingPattern === "cash_gap";
  const set = (key: keyof NeedDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const changes = buildNeedChanges(draft);
      if (continueToNextStep && !draft.purpose) throw new Error("Выберите задачу: например, закупку товара или оплату до поступления выручки.");
      if (continueToNextStep && !nextIsPlan && !draft.requestedAmount.trim()) throw new Error("Укажите, сколько денег нужно на задачу.");
      if (continueToNextStep && (nextIsPlan || includePayments)) {
        changes["product_details.overdraft"] = buildOverdraftPlan(
          { ...cashFlow.draft, openingCash: cashFlow.bankCash || "0.00" },
          (view.application.financials.existing_loans || []).filter(loan => !loan.schedule).map(loan => loan.loan_id),
        );
      } else if (continueToNextStep && view.application.product_details?.overdraft) {
        changes["product_details.overdraft"] = null;
      }
      onSave(changes);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверьте поля формы.",
      );
    }
  }

  return (
    <form onSubmit={submit} className="space-y-7">
      <fieldset disabled={busy} className="space-y-7 disabled:opacity-70">
        <div>
          <p className="mb-3 text-xs font-semibold text-muted-foreground">
            С чего начнём?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={draft.financingPattern === "gradual_repayment" ? "secondary" : "outline"}
              aria-pressed={draft.financingPattern === "gradual_repayment"}
              size="sm"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  purpose: "working_capital",
                  financingPattern: "gradual_repayment",
                  preferredProduct: "",
                }))
              }
            >
              Закупить товар
            </Button>
            <Button
              type="button"
              variant={draft.financingPattern === "cash_gap" ? "secondary" : "outline"}
              aria-pressed={draft.financingPattern === "cash_gap"}
              size="sm"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  purpose: "working_capital",
                  financingPattern: "cash_gap",
                  preferredProduct: "",
                }))
              }
            >
              Дождаться выручки
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setChooseProduct(true);
                setDraft(current => ({ ...current, purpose: current.purpose || "working_capital", preferredProduct: "working_capital_loan" }));
              }}
            >
              Я знаю продукт
            </Button>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <ChoiceField
            id="need-purpose"
            label="Для чего нужны деньги"
            value={draft.purpose}
            onValueChange={(value) => set("purpose", value)}
            options={purposes}
          />
          {chooseProduct && (
          <ChoiceField
            id="need-product"
            label="Предпочитаемый продукт"
            value={draft.preferredProduct}
            onValueChange={(value) => set("preferredProduct", value)}
            options={[
              {
                value: "working_capital_loan",
                label: "Кредит на оборотные цели",
              },
              { value: "overdraft", label: "Овердрафт" },
            ]}
            hint="Если не знаете, подберём после сохранения."
          />
          )}
          <div>
            <FormField
              id="need-amount"
              label={nextIsPlan ? "Желаемый лимит, ₽" : "Нужная сумма, ₽"}
              value={draft.requestedAmount}
              onChange={(event) => set("requestedAmount", event.target.value)}
              inputMode="decimal"
              placeholder="Например, 500 000"
              hint={nextIsPlan ? "Можно не указывать: рассчитаем нехватку по платежам и остатку на счёте." : undefined}
            />
            <FieldOrigin
              source={originFor(view.field_sources, "need.requested_amount")}
            />
          </div>
          {!nextIsPlan && <FormField
            id="need-term"
            label="Срок, месяцев"
            value={draft.termMonths}
            onChange={(event) => set("termMonths", event.target.value)}
            inputMode="numeric"
            placeholder="Например, 12"
          />}
          <ChoiceField
            id="need-pattern"
            label="Как планируете возвращать"
            value={draft.financingPattern}
            onValueChange={(value) => set("financingPattern", value)}
            options={[
              { value: "gradual_repayment", label: "Постепенно из выручки" },
              { value: "cash_gap", label: "После поступления денег" },
            ]}
          />
        </div>
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Дополнительно: сроки, собственные средства и сумма поменьше
          </summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <ChoiceField
            id="need-recurring"
            label="Как часто нужны деньги"
            value={draft.recurring}
            onValueChange={(value) => set("recurring", value)}
            options={[
              { value: "false", label: "Разовая потребность" },
              { value: "true", label: "Регулярная потребность" },
            ]}
          />

            <FormField
              id="need-minimum"
              label="Минимальная достаточная сумма, ₽"
              value={draft.minimumAmount}
              onChange={(event) => set("minimumAmount", event.target.value)}
              inputMode="decimal"
              placeholder="Если подойдёт сумма меньше"
            />
            <FormField
              id="need-own"
              label="Собственные средства, ₽"
              value={draft.ownFunds}
              onChange={(event) => set("ownFunds", event.target.value)}
              inputMode="decimal"
              placeholder="Можно указать 0"
            />
            <FormField
              id="need-date"
              label="Когда нужны деньги"
              type="date"
              value={draft.neededBy}
              onChange={(event) => set("neededBy", event.target.value)}
            />
          </div>
        </details>
        {continueToNextStep && (
          <section className="space-y-4 border-t border-border pt-5" aria-label="Предстоящие платежи и поступления">
            {nextIsPlan ? (
              <div>
                <h3 className="text-lg font-bold">Когда нужно заплатить и когда поступят деньги?</h3>
                <p className="mt-2 text-sm text-muted-foreground">Учтём остаток на счёте и определим, сколько нужно занять до поступления денег и когда получится вернуть.</p>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-primary" checked={includePayments} onChange={event => setIncludePayments(event.target.checked)} />
                <span><strong className="block">Показать, как кредит повлияет на остаток денег</strong><span className="mt-1 block text-muted-foreground">По желанию: добавьте предстоящие расходы и поступления. Учтём их вместе с платежами по новому кредиту.</span></span>
              </label>
            )}
            {(nextIsPlan || includePayments) && <CashFlowFields view={view} {...cashFlow} />}
          </section>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <p className="max-w-md text-xs text-muted-foreground">
            Профиль компании и известные банку финансовые данные уже
            подставлены. Заявка отправится только после отдельного
            подтверждения.
          </p>
          <Button type="submit" disabled={busy}>
            {!continueToNextStep && <Save aria-hidden="true" />}
            {continueToNextStep
              ? "Посмотреть подходящие предложения"
              : "Сохранить черновик"}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
