import {useId, useState} from "react";
import {Check, Clock3, CreditCard, History, Minus, Plus} from "lucide-react";
import {z} from "zod";
import type {ApplicationView} from "../api/applications";
import {productName, stateName} from "../model/presentation";
import {completionLifecycle} from "../model/completion-lifecycle";
import {formatMoney} from "@/shared/lib/format";
import {Button} from "@/shared/ui/button";
import "./application-overview.css";

const checksSchema = z.record(z.string(), z.object({status:z.string()}));
const traceSchema = z.object({steps:z.array(z.object({id:z.string(),status:z.string().optional(),values:z.object({checks:checksSchema.optional()}).passthrough()}))});
const checkNames = [{id:"registration",name:"Регистрация бизнеса"},{id:"restrictions",name:"Ограничения"},{id:"credit_history",name:"Кредитная история"},{id:"obligations",name:"Действующие обязательства"}];
const eventNames:Record<string,string> = {
  application_created:"Создан черновик",application_repeated:"Создана новая заявка по прежним параметрам",
  application_updated:"Обновлены сведения",application_submitted:"Заявка отправлена",review_started:"Начаты банковские проверки",
  assessment_completed:"Рассмотрение завершено",options_explored:"Рассчитаны варианты",explored_option_applied:"Выбраны условия",
  offer_selected:"Выбрано предложение банка",condition_completed:"Подтверждено условие",offer_signed:"Подписан договор",
  application_cancelled:"Заявка отменена",recommendations_calculated:"Подобран продукт",loans_refinanced:"Выбранные обязательства погашены",
  credit_refinanced:"Кредит погашен рефинансированием",bank_obligations_updated:"Учтён новый кредит: требуется пересчёт предложений",
  invoice_uploaded:"Загружен счёт поставщика",invoice_reviewed:"Проверены данные счёта",
};

export function ApplicationOverview({view, reviewing=false}:{view:ApplicationView;reviewing?:boolean}) {
  const [historyOpen,setHistoryOpen]=useState(false), historyId=useId();
  const {need}=view.application, status=view.state.status;
  const selected=view.result?.assessment?.offers.find(offer=>offer.offer_id===view.state.selected_offer_id);
  const completionProduct=typeof view.completion?.product_id === "string" ? view.completion.product_id : undefined;
  const completionAmount=typeof view.completion?.amount === "string" ? view.completion.amount : undefined;
  const product=completionProduct || selected?.product_id || need.preferred_product;
  const amount=completionAmount || selected?.amount || need.requested_amount;
  const term=selected?.term_months || need.term_months;
  const lifecycle=view.completion ? completionLifecycle(view.completion) : null;
  const label=lifecycle?.replacementId ? "Погашен рефинансированием" : lifecycle?.closed ? "Кредит погашен" : reviewing ? "На рассмотрении" : stateName(status);
  const trace=traceSchema.safeParse(view.result?.decision_trace);
  const rawChecks=checksSchema.safeParse(view.checks);
  const checks=reviewing || status==="draft" ? {} : rawChecks.success ? rawChecks.data : trace.success ? trace.data.steps.find(step=>step.id==="data")?.values.checks || {} : {};
  const checked=checkNames.filter(check=>checks[check.id]?.status==="completed").length;
  const sent=view.events.some(event=>event.type==="application_submitted") || reviewing;
  const final=!reviewing && view.result?.assessment?.stage==="final";
  const needsData=status==="waiting_for_data";
  const retry=status==="check_retry_pending";
  const cancelled=status==="cancelled";
  const riskDone=!reviewing && status!=="draft" && trace.success && trace.data.steps.find(step=>step.id==="risk")?.status==="calculated";
  const capacityDone=!reviewing && status!=="draft" && trace.success && trace.data.steps.find(step=>step.id==="capacity")?.status==="calculated";
  const latestAssessment=[...view.events].reverse().find(event=>event.type==="assessment_completed")?.event_id;
  const eventTitle=(event:ApplicationView["events"][number])=>event.event_id===latestAssessment && needsData ? "Запрошены уточнения по заявке" : eventNames[event.type] || "Обновлён этап заявки";
  const reviewTitle=cancelled?"Рассмотрение остановлено":reviewing?"Банк проверяет сведения":needsData?"Нужны ваши уточнения":retry?"Ожидаем результат проверки":view.completion?"Оформление завершено":status==="ready_to_sign"?"Можно подписать договор":status==="conditions_pending"?"Осталось выполнить условия":final&&view.result?.assessment?.offers.length?"Условия готовы":final?"Решение получено":"Готовим заявку";
  const reviewDescription=needsData?checked===4?"Проверки банка завершены. Для скоринга и расчёта дополните сведения ниже.":"Чтобы продолжить рассмотрение, дополните сведения ниже.":reviewing?"Проверяем регистрацию, ограничения, кредитную историю и обязательства.":cancelled?"Параметры и события сохранены в истории.":view.completion?"Текущий долг и платежи доступны в разделе «Моё финансирование».":view.state.next_action.label;
  const steps=[
    {title:sent?"Заявка получена":"Подготовка заявки",state:sent?"done":"active",text:sent?"Данные переданы банку":"Проверьте параметры"},
    {title:"Проверки банка",state:cancelled?"waiting":checked===4?"done":retry?"attention":sent&&!final?"active":"waiting",text:checked===4?"4 результата получены":retry?"Нужно повторить":reviewing?"Проверяем сведения":"Регистрация, история, долги"},
    {title:"Скоринг и расчёт",state:riskDone&&capacityDone?"done":needsData?"attention":"waiting",text:riskDone&&capacityDone?"Риск и нагрузка оценены":needsData?"Ждём ваших уточнений":"После получения данных"},
    {title:"Решение",state:cancelled?"waiting":final?needsData||["declined","out_of_policy"].includes(status)?"attention":"done":"waiting",text:cancelled?"Заявка отменена":final?needsData?"Нужны сведения":view.result?.assessment?.offers.length?"Условия готовы":"Причина указана ниже":"После проверки"},
  ];
  return <section className="application-overview" aria-label="Заявка и ход рассмотрения">
    <div className="application-identity">
      <div className="application-identity-meta"><span className="application-product-icon" aria-hidden="true"><CreditCard size={19}/></span><span className="application-identity-status"><i aria-hidden="true"/>{label}</span></div>
      <h2>{productName(product)}</h2>
      <dl><div><dt>{lifecycle?.closed?"Первоначальная сумма":view.completion?"Оформленная сумма":selected?"Выбранная сумма":["overdraft","revolving_credit_line"].includes(product || "")?"Запрошенный лимит":"Запрошенная сумма"}</dt><dd>{amount ? formatMoney(amount) : "Уточняется"}</dd></div><div><dt>Срок</dt><dd>{term ? `${term} мес.` : "По условиям продукта"}</dd></div></dl>
    </div>
    <div className="application-review">
      <p className="application-review-label">Рассмотрение заявки</p><h3>{reviewTitle}</h3><p className="application-review-description">{reviewDescription}</p>
      <ol className="application-review-stages" aria-label="Этапы банковского рассмотрения">{steps.map((step,index)=><li key={step.title} data-state={step.state} aria-current={step.state==="active"?"step":undefined}><span aria-hidden="true"/><strong>{step.state==="done"&&<Check size={11} aria-hidden="true"/>}{["Заявка","Проверки","Скоринг","Решение"][index]}</strong><span className="sr-only">{step.title}. {step.text}</span></li>)}</ol>
      <Button variant="outline" size="sm" className="application-history-trigger" aria-expanded={historyOpen} aria-controls={historyId} onClick={()=>setHistoryOpen(open=>!open)}><History size={15}/><span>История и проверки</span><span className="application-history-count">{view.events.length}</span>{historyOpen?<Minus size={14}/>:<Plus size={14}/>}</Button>
    </div>
    <div id={historyId} hidden={!historyOpen} className="application-review-details">
        <section aria-label="Результаты банковских проверок"><h4>Проверки демо-банка</h4><ul className="application-check-list">{checkNames.map(check=><li key={check.id}><span>{check.name}</span><strong data-completed={checks[check.id]?.status==="completed"}>{checks[check.id]?.status==="completed"?<><Check size={13}/>Результат получен</>:<><Clock3 size={13}/>{reviewing?"Ожидается результат":checks[check.id]?.status?"Не завершена":"Ещё нет результата"}</>}</strong></li>)}</ul></section>
        <section aria-label="История рассмотрения заявки"><h4>События заявки</h4>{view.events.length?<ol className="application-event-list">{view.events.toReversed().map(event=><li key={event.event_id}><span aria-hidden="true"/><div><strong>{eventTitle(event)}</strong><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("ru-RU",{timeZone:"Europe/Moscow",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}</time></div></li>)}</ol>:<p className="application-event-empty">После сохранения здесь появятся события заявки.</p>}</section>
    </div>
  </section>;
}
