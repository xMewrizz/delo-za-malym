import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, FilePenLine } from "lucide-react";
import type { ApplicationView } from "../api/applications";
import { describeIssue } from "../model/presentation";
import { normalizeMoneyInput } from "../model/need";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { FormField } from "@/shared/ui/form-field";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { NeedForm } from "./need-form";
import { FinancialSupplement } from "./financial-supplement";
import { OverdraftPlanForm } from "./overdraft-plan-form";
import "./application-followup.css";

const issueLabels: Record<string, string> = {
  "need.own_funds": "Собственный взнос", "need.project_cost": "Стоимость проекта",
  "need.requested_amount": "Сумма финансирования", "need.minimum_acceptable_amount": "Минимальная сумма",
  "need.term_months": "Срок кредита", "need.principal_grace_months": "Отсрочка платежей",
};
function issueField(issue: unknown) {
  return issue && typeof issue === "object" && "field" in issue && typeof issue.field === "string" ? issue.field : "";
}
function readableIssue(issue: unknown) {
  return describeIssue(issue).replace(/\d+\.\d{2}\s*₽/g, value => formatMoney(value.replace(/\s*₽/, "")));
}

export function ApplicationFollowup({ view, busy, onSave }: {
  view: ApplicationView; busy: boolean; onSave: (changes: Record<string, unknown>) => void;
}) {
  const need = view.application.need;
  const issues = [...(view.result?.assessment?.required_information || []), ...(view.result?.issues || [])];
  const unique = issues.filter((issue, index) => issues.findIndex(item => describeIssue(item) === describeIssue(issue)) === index);
  const financials = view.application.financials;
  const financial = financials.largest_buyer_share == null || (financials.monthly || []).some(row => [row.operating_inflow, row.operating_outflow, row.taxes].some(value => value == null));
  const plan = unique.some(issue => issueField(issue).startsWith("product_details.overdraft"));
  const needFields = unique.filter(issue => !issueField(issue).startsWith("financials.") && !issueField(issue).startsWith("product_details.overdraft"));
  const investment = need.preferred_product === "investment_loan" && needFields.every(issue => ["need.project_cost", "need.own_funds"].includes(issueField(issue)));
  const stages = [...(needFields.length || !unique.length && !financial ? ["need"] : []), ...(plan ? ["plan"] : []), ...(financial ? ["financial"] : [])];
  const [editing, setEditing] = useState(false), [stage, setStage] = useState(0);
  const changes = useRef<Record<string, unknown>>({});
  const editor = useRef<HTMLDivElement>(null);
  const last = stage === stages.length - 1;
  const submitLabel = last ? "Сохранить и отправить на проверку" : "Продолжить";
  const focusTarget = stages[stage] === "need" && investment && needFields.some(issue => issueField(issue) === "need.own_funds") ? "#followup-own" : "input,button";
  useEffect(() => {
    if (!editing) return;
    const targets = [...(editor.current?.querySelectorAll<HTMLElement>(focusTarget) || [])].filter(element => !element.closest("[hidden]") && !element.matches(":disabled"));
    (targets.find(element => element.tagName === "INPUT") || targets[0])?.focus({preventScroll: true});
    editor.current?.scrollIntoView?.({block: "nearest", behavior: "smooth"});
  }, [editing, stage, focusTarget]);
  function collect(patch: Record<string, unknown>) {
    changes.current = {...changes.current, ...patch};
    if (last) onSave(changes.current);
    else setStage(current => current + 1);
  }
  return <Card className="application-followup">
    <CardHeader>
      <div className="followup-heading"><span aria-hidden="true"><FilePenLine size={22}/></span><div><p>НУЖНО ВАШЕ УТОЧНЕНИЕ</p><h2>Дополните заявку, чтобы продолжить</h2></div></div>
    </CardHeader>
    <CardContent>
      <ul className="followup-requests">{unique.length ? unique.map((issue, index) => <li key={index}><strong>{issueLabels[issueField(issue)] || (issueField(issue).startsWith("financials.") ? "Данные бизнеса" : "Что нужно уточнить")}</strong><p>{readableIssue(issue)}</p></li>) : <li><strong>Проверьте сведения</strong><p>{view.result?.assessment?.reasons?.[0]?.message || "Дополните параметры заявки и отправьте их на повторную проверку."}</p></li>}</ul>
      {!editing ? <div className="followup-start"><Button disabled={busy} onClick={() => setEditing(true)}>{investment ? "Уточнить взнос и стоимость" : "Дополнить сведения"}<ArrowRight size={17}/></Button><p>Откроем нужные поля здесь. Остальные данные уже сохранены.</p></div> : <div className="followup-editor" ref={editor} aria-label="Уточнение заявки">
        <div className="followup-editor-heading"><h3>{stages[stage] === "financial" ? "Дополните данные бизнеса" : stages[stage] === "plan" ? "Уточните платежи и поступления" : investment ? "Стоимость проекта и ваш взнос" : "Уточните параметры заявки"}</h3>{stages.length > 1 && <span>Уточнение {stage + 1} из {stages.length}</span>}</div>
        <p className="followup-editor-help">{last ? "После отправки банк повторит проверку с обновлёнными данными." : "Сохраним ответы и перейдём к следующему уточнению."}</p>
        {stage > 0 && <Button variant="ghost" disabled={busy} onClick={() => setStage(current => current - 1)}><ArrowLeft size={16}/>К предыдущему уточнению</Button>}
        <div hidden={stages[stage] !== "need"}>{investment ? <InvestmentFollowup view={view} busy={busy} onSave={collect} submitLabel={submitLabel}/> : <NeedForm view={view} busy={busy} onSave={collect} correction submitLabel={submitLabel}/>}</div>
        {plan && <div hidden={stages[stage] !== "plan"}><OverdraftPlanForm view={view} busy={busy} onSave={collect} forceVisible submitLabel={submitLabel}/></div>}
        {financial && <div hidden={stages[stage] !== "financial"}><FinancialSupplement view={view} busy={busy} onSave={collect} submitLabel={submitLabel}/></div>}
      </div>}
    </CardContent>
  </Card>;
}

function InvestmentFollowup({view, busy, onSave, submitLabel}: {view: ApplicationView; busy: boolean; onSave: (patch: Record<string, unknown>) => void; submitLabel: string}) {
  const need = view.application.need;
  const [values, setValues] = useSavedDraft(`delo-followup:${view.application.application_id}:${view.application.application_version}`, {project: need.project_cost || "", own: need.own_funds || ""});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amount = (value: string) => {try {return Number(normalizeMoneyInput(value, true) || 0);} catch {return 0;}};
  const project = amount(values.project), own = amount(values.own);
  function validate(key: "project" | "own") {
    try {
      const value = normalizeMoneyInput(values[key], key === "own");
      if (!value) return "Укажите сумму в рублях.";
      if (key === "own" && project > 0 && Number(value) < project * .2) return `Для этого проекта нужен взнос от ${formatMoney((Math.ceil(project * 20) / 100).toFixed(2))} — 20% стоимости.`;
      if (key === "own" && project > 0 && Number(value) >= project) return "Взнос должен быть меньше стоимости проекта. Иначе кредит не потребуется.";
      return "";
    } catch {return "Введите сумму в рублях, например 100 000. Не больше двух знаков после запятой.";}
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {project: validate("project"), own: validate("own")}; setErrors(next);
    const invalid = next.project ? "project" : next.own ? "own" : null;
    if (invalid) {document.getElementById(`followup-${invalid}`)?.focus(); return;}
    onSave({"need.project_cost": normalizeMoneyInput(values.project), "need.own_funds": normalizeMoneyInput(values.own, true)});
  }
  return <form onSubmit={submit} noValidate className="followup-investment-form">
    <fieldset disabled={busy}><FormField id="followup-project" label="Стоимость проекта, ₽" required inputMode="decimal" value={values.project} error={errors.project} onBlur={() => setErrors(current => ({...current, project: validate("project")}))} onChange={event => {setValues(current => ({...current, project: event.target.value})); setErrors({});}} hint="Полная стоимость оборудования, ремонта или новой точки."/>
      <FormField id="followup-own" label="Ваш собственный взнос, ₽" required inputMode="decimal" value={values.own} error={errors.own} onBlur={() => setErrors(current => ({...current, own: validate("own")}))} onChange={event => {setValues(current => ({...current, own: event.target.value})); setErrors(current => ({...current, own: ""}));}} hint={project > 0 ? `Не менее ${formatMoney((Math.ceil(project * 20) / 100).toFixed(2))} — 20% стоимости проекта.` : "Не менее 20% стоимости проекта."}/></fieldset>
    <div className="followup-loan-preview"><span>Сумма кредита после уточнения</span><strong>{formatMoney(Math.max(0, project - own).toFixed(2))}</strong></div>
    <Button type="submit" disabled={busy}>{busy ? "Сохраняем изменения…" : submitLabel}<ArrowRight size={17}/></Button>
  </form>;
}
