import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { FieldOrigin } from "@/shared/ui/field-origin";
import { originFor } from "@/shared/lib/field-source";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import { readSaved, useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { RefinancingLoans } from "./refinancing-loans";
import { refinancingIds } from "../model/refinancing";
import { CashFlowFields } from "./overdraft-plan-form";
import { useCashFlowDraft } from "../model/use-cash-flow-draft";
import { buildOverdraftPlan } from "../model/overdraft-plan";
import {
  buildNeedChanges,
  draftFromApplication,
  mergeNeedDraft,
  NeedValidationError,
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
  const [errorField, setErrorField] = useState<keyof NeedDraft | null>(null);
  const fieldIds = { projectCost: "need-project-cost", purpose: "need-purpose", requestedAmount: "need-amount", termMonths: "need-term", minimumAmount: "need-minimum", ownFunds: "need-own" };
  const fieldError = (key: keyof NeedDraft) => errorField === key ? error : undefined;
  const [chooseProduct, setChooseProduct] = useState(Boolean(draft.preferredProduct));
  const cashFlow = useCashFlowDraft(view, true);
  const [includePayments, setIncludePayments] = useSavedDraft(
    `delo-include-payments:${view.application.application_id}`,
    Boolean(view.application.product_details?.overdraft),
  );
  const refinancing = draft.purpose === "refinancing" || draft.preferredProduct === "refinancing";
  const investment = draft.purpose === "investment" || draft.preferredProduct === "investment_loan";
  const revolving = draft.preferredProduct === "revolving_credit_line";
  const [refinancingLoans, setRefinancingLoans] = useSavedDraft(`delo-refinancing:${view.application.application_id}:${view.application.application_version}`, refinancingIds(view));
  const nextIsPlan =
    !investment && !revolving && (draft.preferredProduct === "overdraft" || draft.financingPattern === "cash_gap");
  const set = (key: keyof NeedDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === errorField) { setError(""); setErrorField(null); }
  };
  const selectTask = (financingPattern: string) => {
    setDraft(current => ({ ...current, purpose: "working_capital", financingPattern, preferredProduct: "" }));
    if (errorField === "purpose") { setError(""); setErrorField(null); }
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const changes = buildNeedChanges(refinancing ? { ...draft, requestedAmount: "", minimumAmount: "", ownFunds: "" } : draft);
      if (refinancing) {
        if (!refinancingLoans.length) throw new Error("Выберите хотя бы один кредит для рефинансирования.");
        changes["need.preferred_product"] = "refinancing";
        changes["need.purpose"] = "refinancing";
        changes["product_details.refinancing"] = { loan_ids: refinancingLoans };
      }
      if (continueToNextStep && !draft.purpose) throw new NeedValidationError("purpose", "Выберите задачу: например, закупку товара или оплату до поступления выручки.");
      if (continueToNextStep && !refinancing && !investment && !nextIsPlan && !draft.requestedAmount.trim()) throw new NeedValidationError("requestedAmount", "Укажите, сколько денег нужно на задачу.");
      if (continueToNextStep && !refinancing && !investment && !revolving && (nextIsPlan || includePayments)) {
        changes["product_details.overdraft"] = buildOverdraftPlan(
          { ...cashFlow.draft, openingCash: cashFlow.bankCash || "0.00" },
          (view.application.financials.existing_loans || []).filter(loan => !loan.schedule).map(loan => loan.loan_id),
        );
      } else if (continueToNextStep && view.application.product_details?.overdraft) {
        changes["product_details.overdraft"] = null;
      }
      onSave(changes);
      setError("");
      setErrorField(null);
    } catch (cause) {
      const requestedField = cause instanceof NeedValidationError ? cause.field : null;
      // A value retained from another product can belong to a hidden field.
      // Keep a visible summary when there is no rendered control to focus.
      const field = requestedField && requestedField in fieldIds && document.getElementById(fieldIds[requestedField as keyof typeof fieldIds])
        ? requestedField : null;
      setErrorField(field);
      const targetId = field && field in fieldIds ? fieldIds[field as keyof typeof fieldIds] : "need-form-error";
      requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        let details = target?.closest("details");
        while (details) { details.open = true; details = details.parentElement?.closest("details") || null; }
        target?.focus();
      });
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
              variant={!refinancing && !investment && !revolving && draft.financingPattern === "gradual_repayment" ? "secondary" : "outline"}
              aria-pressed={!refinancing && !investment && !revolving && draft.financingPattern === "gradual_repayment"}
              size="sm"
              onClick={() => selectTask("gradual_repayment")}
            >
              Закупить товар
            </Button>
            <Button
              type="button"
              variant={draft.financingPattern === "cash_gap" ? "secondary" : "outline"}
              aria-pressed={draft.financingPattern === "cash_gap"}
              size="sm"
              onClick={() => selectTask("cash_gap")}
            >
              Дождаться выручки
            </Button>
            <Button type="button" size="sm" variant={investment ? "secondary" : "outline"} aria-pressed={investment} onClick={() => setDraft(current => ({ ...current, purpose: "investment", preferredProduct: "investment_loan", financingPattern: "gradual_repayment", termMonths: "36", graceMonths: "0", minimumAmount: "" }))}>Купить оборудование</Button>
            <Button type="button" size="sm" variant={refinancing ? "secondary" : "outline"} aria-pressed={refinancing} onClick={() => setDraft(current => ({ ...current, purpose: "refinancing", preferredProduct: "refinancing", financingPattern: "gradual_repayment", requestedAmount: "", minimumAmount: "", ownFunds: "" }))}>Объединить кредиты</Button>
            <Button type="button" size="sm" variant={revolving ? "secondary" : "outline"} aria-pressed={revolving} onClick={() => { setChooseProduct(true); setDraft(current => ({ ...current, purpose: "working_capital", preferredProduct: "revolving_credit_line", recurring: "true", financingPattern: "gradual_repayment", termMonths: "12" })); }}>Регулярные закупки</Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setChooseProduct(true);
                setDraft(current => ({ ...current, purpose: ["refinancing", "investment"].includes(current.purpose) ? "working_capital" : current.purpose || "working_capital", preferredProduct: "working_capital_loan" }));
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
            error={fieldError("purpose")}
            value={draft.purpose}
            onValueChange={(value) => { set("purpose", value); if (value === "investment") { set("preferredProduct", "investment_loan"); set("financingPattern", "gradual_repayment"); } else if (value === "refinancing") set("preferredProduct", "refinancing"); else if (["refinancing", "investment_loan"].includes(draft.preferredProduct)) set("preferredProduct", ""); }}
            options={purposes}
          />
          {chooseProduct && (
          <ChoiceField
            id="need-product"
            label="Предпочитаемый продукт"
            value={draft.preferredProduct}
            onValueChange={(value) => { set("preferredProduct", value); if (value === "investment_loan") { set("purpose", "investment"); set("financingPattern", "gradual_repayment"); } else if (value === "refinancing") set("purpose", "refinancing"); else if (["refinancing", "investment"].includes(draft.purpose)) set("purpose", "working_capital"); }}
            options={[
              {
                value: "working_capital_loan",
                label: "Кредит на оборотные цели",
              },
              { value: "overdraft", label: "Овердрафт" },
              { value: "refinancing", label: "Рефинансирование" },
              { value: "investment_loan", label: "Инвестиционный кредит" },
              { value: "revolving_credit_line", label: "Возобновляемая кредитная линия" },
            ]}
            hint="Если не знаете, подберём после сохранения."
          />
          )}
          {!refinancing && !investment && (
          <div>
            <FormField
              id="need-amount"
              error={fieldError("requestedAmount")}
              label={nextIsPlan || revolving ? "Желаемый лимит, ₽" : "Нужная сумма, ₽"}
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
          )}
          {investment && <>
            <FormField id="need-project-cost" label="Стоимость проекта, ₽" value={draft.projectCost || ""} inputMode="decimal" error={fieldError("projectCost")} onChange={event => set("projectCost", event.target.value)} hint="Оборудование, ремонт или запуск новой точки — полная стоимость." />
            <FormField id="need-own" label="Собственный взнос, ₽" value={draft.ownFunds} inputMode="decimal" error={fieldError("ownFunds")} onChange={event => set("ownFunds", event.target.value)} hint="От 20% стоимости проекта. Кредит покроет оставшуюся часть." />
            <fieldset className="space-y-2"><legend className="text-xs font-semibold">Отсрочка основного долга</legend><div className="flex flex-wrap gap-2">{[{value:"0",label:"Без отсрочки"},{value:"3",label:"3 месяца"},{value:"6",label:"6 месяцев"}].map(option => <Button key={option.value} type="button" size="sm" aria-pressed={(draft.graceMonths || "0") === option.value} variant={(draft.graceMonths || "0") === option.value ? "secondary" : "outline"} onClick={() => set("graceMonths", option.value)}>{option.label}</Button>)}</div><p className="text-xs text-muted-foreground">Во время отсрочки платите проценты; затем платёж станет выше. Отсрочка входит в общий срок.</p></fieldset>
            <p className="rounded-xl bg-secondary p-4 text-sm self-end">Кредит на проект: {Math.max(0, Number((draft.projectCost || "0").replaceAll(" ", "").replace(",", ".")) - Number((draft.ownFunds || "0").replaceAll(" ", "").replace(",", "."))).toLocaleString("ru-RU")} ₽</p>
          </>}
          {!nextIsPlan && <FormField
            id="need-term"
            error={fieldError("termMonths")}
            label="Срок, месяцев"
            value={draft.termMonths}
            onChange={(event) => set("termMonths", event.target.value)}
            inputMode="numeric"
            placeholder="Например, 12"
          />}
          {!refinancing && !investment && !revolving && (
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
          )}
        </div>
        {!refinancing && !investment && <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Дополнительно: сроки, собственные средства и сумма поменьше
          </summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {nextIsPlan && draft.termMonths.trim() && <FormField
              id="need-term"
              error={fieldError("termMonths")}
              label="Сохранённый срок, месяцев"
              value={draft.termMonths}
              onChange={(event) => set("termMonths", event.target.value)}
              inputMode="numeric"
              hint="Остался от кредитного сценария. Можно очистить, если срок больше не нужен."
            />}
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
              error={fieldError("minimumAmount")}
              label="Минимальная достаточная сумма, ₽"
              value={draft.minimumAmount}
              onChange={(event) => set("minimumAmount", event.target.value)}
              inputMode="decimal"
              placeholder="Если подойдёт сумма меньше"
            />
            <FormField
              id="need-own"
              error={fieldError("ownFunds")}
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
        </details>}
        {refinancing && <RefinancingLoans view={view} selected={refinancingLoans} onChange={setRefinancingLoans} />}
        {revolving && <p className="rounded-xl bg-secondary p-4 text-sm">Укажите, сколько денег может понадобиться одновременно. Линию можно использовать частями; после погашения основного долга лимит снова доступен. Проценты — на фактический долг, возврат основного долга — до конца срока линии.</p>}
        {continueToNextStep && !refinancing && !investment && !revolving && (
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
        {error && !errorField && (
          <p
            id="need-form-error"
            tabIndex={-1}
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
