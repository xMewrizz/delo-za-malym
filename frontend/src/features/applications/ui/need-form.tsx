import { useEffect, useMemo, useState, useRef, useId, type FormEvent, type ReactNode } from "react";
import { ArrowRight, ArrowLeft, Check, Save, Package, Clock3, Factory, Combine, Repeat2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { FieldOrigin } from "@/shared/ui/field-origin";
import { originFor } from "@/shared/lib/field-source";
import { ChoiceField, FormField } from "@/shared/ui/form-field";
import {getProducts, type Product} from "@/features/products/api/products";
import {formatMoney} from "@/shared/lib/format";
import { Disclosure } from "@/shared/ui/disclosure";
import { readSaved, useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { RefinancingLoans } from "./refinancing-loans";
import { refinancingIds } from "../model/refinancing";
import { CashFlowFields } from "./overdraft-plan-form";
import { useCashFlowDraft } from "../model/use-cash-flow-draft";
import { buildOverdraftPlan } from "../model/overdraft-plan";
import "./need-form.css";
import { inferNeedTask, needTasks, needProducts, scenarioDraft, selectNeedTask, type NeedTask } from "../model/need-scenario";
import {
  buildNeedChanges,
  draftFromApplication,
  mergeNeedDraft,
  NeedValidationError,
  validateAmountChoice,
  type NeedDraft,
} from "../model/need";

const taskIcons = {purchase:Package, cash_gap:Clock3, investment:Factory, refinancing:Combine, recurring:Repeat2, product:SlidersHorizontal};

export function NeedForm({
  view,
  busy,
  onSave,
  continueToNextStep = false,
  expenseImport,
  correction = false,
  submitLabel,
}: {
  view: ApplicationView;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
  continueToNextStep?: boolean;
  expenseImport?: ReactNode;
  correction?: boolean;
  submitLabel?: string;
}) {
  const base = useMemo(() => draftFromApplication(view), [view]),
    snapshotKey = `delo-need-source:${view.application.application_id}`;
  const [savedDraft, setDraft] = useSavedDraft<NeedDraft>(
    `delo-need:${view.application.application_id}:${view.application.application_version}`,
    mergeNeedDraft(base, readSaved(snapshotKey, null)),
  );
  const draft = useMemo(() => scenarioDraft(savedDraft), [savedDraft]);
  const task = inferNeedTask(draft);
  const selectedTask = needTasks.find(item => item.id === task);
  useEffect(() => {
    try {
      localStorage.setItem(snapshotKey, JSON.stringify({ base, draft }));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [snapshotKey, base, draft]);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<keyof NeedDraft | null>(null);
  const fieldIds = { projectCost: "need-project-cost", purpose: "need-purpose", preferredProduct: "need-product", requestedAmount: "need-amount", amountFlexibility: "need-amount-choice", termMonths: "need-term", minimumAmount: "need-minimum", ownFunds: "need-own" };
  const fieldError = (key: keyof NeedDraft) => errorField === key ? error : undefined;
  const cashFlow = useCashFlowDraft(view, true);
  const refinancing = draft.purpose === "refinancing" || draft.preferredProduct === "refinancing";
  const investment = draft.purpose === "investment" || draft.preferredProduct === "investment_loan";
  const revolving = draft.preferredProduct === "revolving_credit_line";
  const [catalog,setCatalog]=useState<Product[]>([]);
  useEffect(()=>{
    const abort=new AbortController();
    void getProducts(abort.signal).then(setCatalog).catch(()=>{/* Server validates the range when the catalogue is unavailable. */});
    return()=>abort.abort();
  },[]);
  const bounds=catalog.find(product=>product.product_id===(draft.preferredProduct || (draft.financingPattern==="cash_gap" ? "overdraft" : "working_capital_loan")));
  const amountRange=bounds ? `От ${formatMoney(bounds.minimum_amount)} до ${formatMoney(bounds.maximum_amount)} по правилам продукта. Доступную сумму рассчитаем по данным бизнеса.` : "Доступную сумму рассчитаем по данным бизнеса.";
  function validateProductAmount() {
    if(!bounds || refinancing || nextIsPlan)return;
    const amount=investment ? Number((draft.projectCost||"0").replaceAll(" ","").replace(",","."))-Number((draft.ownFunds||"0").replaceAll(" ","").replace(",",".")) : Number(draft.requestedAmount.replaceAll(" ","").replace(",","."));
    if(Number.isFinite(amount) && amount > Number(bounds.maximum_amount)) throw new NeedValidationError(investment ? "projectCost" : "requestedAmount",`Максимальная сумма этого продукта — ${formatMoney(bounds.maximum_amount)}. Укажите сумму в пределах диапазона.`);
  }
  const [refinancingLoans, setRefinancingLoans] = useSavedDraft(`delo-refinancing:${view.application.application_id}:${view.application.application_version}`, refinancingIds(view));
  const nextIsPlan =
    !investment && !revolving && (draft.preferredProduct === "overdraft" || draft.financingPattern === "cash_gap");
  const [savedPage, setPage] = useSavedDraft<number>(`delo-need-page:${view.application.application_id}`, 0);
  const page = task && (task !== "product" || draft.preferredProduct) ? Math.max(0, Math.min(2, savedPage)) : 0;
  const wizard = continueToNextStep;
  const heading = useRef<HTMLHeadingElement>(null);
  const formId = useId();
  const labels = ["Задача", refinancing ? "Кредиты" : nextIsPlan ? "Предстоящий платёж" : investment ? "Стоимость проекта" : revolving ? "Лимит" : "Сумма", nextIsPlan ? "Поступление денег" : "Условия возврата"];
  const titles = ["На что нужны деньги?", refinancing ? "Какие кредиты объединим?" : nextIsPlan ? "Сколько и когда нужно заплатить?" : investment ? "Сколько стоит ваш проект?" : revolving ? "Какой лимит нужен?" : "Сколько нужно на задачу?", nextIsPlan ? "Когда поступят деньги?" : "Как удобно возвращать?"];
  function go(next: number) { setPage(next); setError(""); setErrorField(null); }
  const priorPage = useRef(page);
  useEffect(() => { if (priorPage.current !== page) { heading.current?.focus({preventScroll: true}); heading.current?.scrollIntoView({block:"nearest"}); } priorPage.current = page; }, [page]);
  function showError(cause: unknown) {
    const field = cause instanceof NeedValidationError ? cause.field : null;
    setErrorField(field); setError(cause instanceof Error ? cause.message : "Проверьте поля формы.");
    if (wizard && field) setPage(["purpose", "preferredProduct"].includes(field) ? 0 : field === "termMonths" || field === "ownFunds" && !investment ? 2 : 1);
    requestAnimationFrame(() => {
      const target = document.getElementById(field && field in fieldIds ? fieldIds[field as keyof typeof fieldIds] : "need-form-error");
      let details = target?.closest("details");
      while (details) { details.open = true; details = details.parentElement?.closest("details") || null; }
      target?.focus();
    });
  }
  function advance() {
    try {
      if (page === 0) validateTask();
      if (page === 1) {
        validateProductAmount();
        if (refinancing && !refinancingLoans.length) throw new Error("Выберите хотя бы один кредит.");
        if (investment) buildNeedChanges({...draft, termMonths:""});
        else if (!refinancing && !nextIsPlan) {
          const changes = buildNeedChanges({...draft, termMonths:"", minimumAmount:"", ownFunds:""});
          if (!changes["need.requested_amount"]) throw new NeedValidationError("requestedAmount", "Укажите, сколько денег нужно на задачу.");
          if (!revolving) validateAmountChoice(draft);
        }
        if (nextIsPlan) {
          const expenses = cashFlow.draft.rows.filter(row => row.direction === "outflow");
          if (!expenses.length || expenses.some(row => !row.date || !/^\d+(\.\d{1,2})?$/.test(row.amount.replaceAll(" ", "").replace(",", ".")) || Number(row.amount.replaceAll(" ", "").replace(",", ".")) <= 0)) throw new Error("Укажите сумму и дату предстоящего платежа.");
        }
      }
      go(page + 1);
    } catch(cause) { showError(cause); }
  }
  const set = (key: keyof NeedDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === errorField) { setError(""); setErrorField(null); }
  };
  const selectTask = (next: NeedTask) => {
    if (next === task) return;
    setDraft(current => selectNeedTask(current, next));
    setError(""); setErrorField(null);
  };
  function validateTask() {
    if (!task) throw new NeedValidationError("purpose", "Выберите, на что нужны деньги.");
    if (task === "product" && !needProducts.some(item => item.value === draft.preferredProduct)) throw new NeedValidationError("preferredProduct", "Выберите продукт, который хотите рассчитать.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wizard && page < 2) { advance(); return; }
    try {
      validateTask();
      validateProductAmount();
      const changes = buildNeedChanges(refinancing ? { ...draft, requestedAmount: "", minimumAmount: "", ownFunds: "" } : draft);
      if (wizard && !refinancing && !investment && !revolving && !nextIsPlan) validateAmountChoice(draft);
      if (!investment) { changes["need.project_cost"] = null; changes["need.principal_grace_months"] = null; }
      if (!refinancing && view.application.product_details?.refinancing) changes["product_details.refinancing"] = null;
      if (refinancing) {
        if (!refinancingLoans.length) throw new Error("Выберите хотя бы один кредит для рефинансирования.");
        changes["need.preferred_product"] = "refinancing";
        changes["need.purpose"] = "refinancing";
        changes["product_details.refinancing"] = { loan_ids: refinancingLoans };
      }
      if (continueToNextStep && !draft.purpose) throw new NeedValidationError("purpose", "Выберите задачу: например, закупку товара или оплату до поступления выручки.");
      if (continueToNextStep && !refinancing && !investment && !nextIsPlan && !draft.requestedAmount.trim()) throw new NeedValidationError("requestedAmount", "Укажите, сколько денег нужно на задачу.");
      if (continueToNextStep && nextIsPlan) {
        changes["product_details.overdraft"] = buildOverdraftPlan(
          { ...cashFlow.draft, openingCash: cashFlow.bankCash || "0.00" },
          (view.application.financials.existing_loans || []).filter(loan => !loan.schedule).map(loan => loan.loan_id),
        );
      } else if (continueToNextStep && view.application.need.financing_pattern === "cash_gap" && view.application.product_details?.overdraft) {
        changes["product_details.overdraft"] = null;
      }
      onSave(changes);
      setError("");
      setErrorField(null);
    } catch (cause) {
      showError(cause);
    }
  }

  return (
    <div className="need-wizard" data-step={wizard ? page : undefined}>
      {wizard && <><nav aria-label="Уточнение задачи"><ol className="need-progress">{labels.map((label,index) => <li key={label}><button type="button" disabled={busy || index > page} aria-current={page === index ? "step" : undefined} onClick={() => go(index)}><span aria-hidden="true">{index < page ? <Check size={12} /> : <i />}</span>{label}</button></li>)}</ol></nav><div className="need-step-heading"><p>Шаг {page + 1} из 3</p><h2 ref={heading} tabIndex={-1}>{titles[page]}</h2></div></>}
    <form id={formId} key={page} onSubmit={submit} className="need-step-content">
      <fieldset disabled={busy} className="need-step-fields disabled:opacity-70">
        <fieldset id="need-purpose" tabIndex={-1} hidden={correction && Boolean(task) || wizard && page !== 0} className="need-task-picker" aria-invalid={errorField === "purpose" || undefined} aria-describedby={errorField === "purpose" ? "need-purpose-error" : undefined}>
          <legend className="sr-only">Выберите задачу или конкретный продукт</legend>
          <div className="need-task-choices">
            {needTasks.map(item => { const Icon = taskIcons[item.id]; return <Button key={item.id} type="button" variant="outline" size="sm" aria-pressed={task === item.id} onClick={() => selectTask(item.id)}><Icon size={19} aria-hidden="true" /><span>{item.label}</span>{task === item.id && <Check size={16} aria-hidden="true" />}</Button>; })}
          </div>
          {fieldError("purpose") && <p id="need-purpose-error" role="alert" className="text-sm text-destructive">{error}</p>}
          {selectedTask && <div key={task} className="need-task-followup">
            <p>{selectedTask.hint}</p>
            {task === "product" && <ChoiceField id="need-product" label="Какой продукт рассчитать?" emptyLabel="Выберите продукт" value={draft.preferredProduct} error={fieldError("preferredProduct")} onValueChange={value => { setDraft(current => selectNeedTask(current, "product", value)); setError(""); setErrorField(null); }} options={needProducts} />}
          </div>}
        </fieldset>
        {wizard && page > 0 && <div className="need-selected-task"><span>{task === "product" ? needProducts.find(item => item.value === draft.preferredProduct)?.label : selectedTask?.label}</span><Button type="button" variant="ghost" size="sm" onClick={() => go(0)}>Изменить задачу</Button></div>}
        <div hidden={wizard && page === 0} className="grid gap-5 sm:grid-cols-2">
          {!refinancing && !investment && (!nextIsPlan || !wizard) && (
          <div hidden={wizard && page !== 1}>
            <FormField
              id="need-amount"
              error={fieldError("requestedAmount")}
              label={nextIsPlan || revolving ? "Желаемый лимит, ₽" : "Нужная сумма, ₽"}
              value={draft.requestedAmount}
              onChange={(event) => set("requestedAmount", event.target.value)}
              inputMode="decimal"
              placeholder="Например, 500 000"
              hint={nextIsPlan ? "Можно не указывать: рассчитаем нехватку по платежам и остатку на счёте." : amountRange}
              onBlur={()=>{try{validateProductAmount();}catch(cause){setError((cause as Error).message);setErrorField("requestedAmount");}}}
            />
            <FieldOrigin
              source={originFor(view.field_sources, "need.requested_amount")}
            />
          </div>
          )}
          {!refinancing && !investment && !revolving && !nextIsPlan && <fieldset id="need-amount-choice" tabIndex={-1} hidden={wizard && page !== 1} className="need-amount-choice" aria-invalid={errorField === "amountFlexibility" || undefined} aria-describedby={errorField === "amountFlexibility" ? "need-amount-choice-error" : "need-amount-choice-hint"}>
            <legend>Если банк сможет предложить меньше</legend>
            <p id="need-amount-choice-hint">Сразу учтём, с какой суммой вы сможете решить задачу.</p>
            <div className="need-amount-options">
              {[{value:"exact",label:"Нужна вся сумма",hint:"Меньшую сумму не рассматриваю"},{value:"flexible",label:"Подойдёт меньше",hint:"Укажу минимальную сумму"}].map(option => <button key={option.value} type="button" aria-label={option.label} aria-pressed={draft.amountFlexibility === option.value} onClick={() => { setDraft(current => ({...current, amountFlexibility:option.value, minimumAmount:option.value === "exact" ? "" : current.minimumAmount})); setError(""); setErrorField(null); }}><span className="need-amount-radio" aria-hidden="true">{draft.amountFlexibility === option.value && <Check size={12} />}</span><span><strong>{option.label}</strong><small>{option.hint}</small></span></button>)}
            </div>
            {fieldError("amountFlexibility") && <p id="need-amount-choice-error" role="alert" className="text-sm text-destructive">{error}</p>}
            {draft.amountFlexibility === "flexible" && <div className="need-minimum-field"><FormField id="need-minimum" label="Минимальная сумма, с которой задача решится, ₽" value={draft.minimumAmount} inputMode="decimal" error={fieldError("minimumAmount")} onChange={event => set("minimumAmount", event.target.value)} placeholder="Например, 300 000" hint="Ниже этой суммы предложения показывать не будем." /></div>}
          </fieldset>}
          {investment && <div hidden={wizard && page !== 1} className="need-project-fields">
            <FormField id="need-project-cost" label="Стоимость проекта, ₽" value={draft.projectCost || ""} inputMode="decimal" error={fieldError("projectCost")} onChange={event => set("projectCost", event.target.value)} hint={`Полная стоимость покупки. ${amountRange}`} />
            <FormField id="need-own" label="Собственный взнос, ₽" value={draft.ownFunds} inputMode="decimal" error={fieldError("ownFunds")} onChange={event => set("ownFunds", event.target.value)} hint="Необязательно. Можно оставить пустым — проверим финансирование всей стоимости." />
            <p className="rounded-xl bg-secondary p-4 text-sm self-end">Кредит на проект: {Math.max(0, Number((draft.projectCost || "0").replaceAll(" ", "").replace(",", ".")) - Number((draft.ownFunds || "0").replaceAll(" ", "").replace(",", "."))).toLocaleString("ru-RU")} ₽</p>
          </div>}
          {!nextIsPlan && <div hidden={wizard && page !== 2}><FormField
            id="need-term"
            error={fieldError("termMonths")}
            label="Срок, месяцев"
            value={draft.termMonths}
            onChange={(event) => set("termMonths", event.target.value)}
            inputMode="numeric"
            placeholder="Например, 12"
            hint="Можно оставить пустым — сравним доступные сроки."
          /></div>}
          {investment && <fieldset hidden={wizard && page !== 2} className="space-y-2"><legend className="text-xs font-semibold">Отсрочка основного долга</legend><div className="flex flex-wrap gap-2">{[{value:"0",label:"Без отсрочки"},{value:"3",label:"3 месяца"},{value:"6",label:"6 месяцев"}].map(option => <Button key={option.value} type="button" size="sm" aria-pressed={(draft.graceMonths || "0") === option.value} variant={(draft.graceMonths || "0") === option.value ? "secondary" : "outline"} onClick={() => set("graceMonths", option.value)}>{option.label}</Button>)}</div><p className="text-xs text-muted-foreground">Во время отсрочки платите только проценты. Она входит в общий срок.</p></fieldset>}
        </div>
        {!refinancing && !investment && !nextIsPlan && <Disclosure hidden={wizard && page !== 2} title="Дополнительные условия" description="Дата получения денег — если она важна для вашей задачи.">
          <FormField id="need-date" label="Когда нужны деньги — необязательно" type="date" value={draft.neededBy} onChange={event => set("neededBy", event.target.value)} />
        </Disclosure>}
        {refinancing && <div hidden={wizard && page !== 1}><RefinancingLoans view={view} selected={refinancingLoans} onChange={setRefinancingLoans} /></div>}
        {revolving && <p hidden={wizard && page !== 1} className="rounded-xl bg-secondary p-4 text-sm">Лимит — максимальная сумма, которую можно использовать одновременно. Проценты начисляются только на долг.</p>}
        {continueToNextStep && page > 0 && nextIsPlan && (
          <section className="space-y-4" aria-label="Предстоящие платежи и поступления">
            <CashFlowFields view={view} {...cashFlow} direction={page === 1 ? "outflow" : "inflow"} />
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
      </fieldset>
    </form>
    {!refinancing && !revolving && (!wizard || page === 1) && expenseImport}
        <div className="need-step-actions">
          {wizard && page > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => go(page - 1)}><ArrowLeft aria-hidden="true" />Назад</Button>}
          <Button type="submit" form={formId} disabled={busy}>
            {!continueToNextStep && <Save aria-hidden="true" />}
            {submitLabel || (wizard && page < 2 ? "Продолжить" : continueToNextStep
              ? "Посмотреть подходящие предложения"
              : "Сохранить черновик")}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
    </div>
  );
}
