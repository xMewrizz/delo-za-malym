import { Check, ChevronDown, Clock3, Minus } from "lucide-react";
import type { ApplicationView } from "../api/applications";
import { decisionTimeline } from "../model/decision-timeline";
import { formatMoney } from "@/shared/lib/format";
import "./bank-decision-timeline.css";
import { DecisionTrace, hasDecisionTrace } from "./decision-trace";
import { Disclosure } from "@/shared/ui/disclosure";

export function BankDecisionTimeline({ view, reviewing = false }: { view: ApplicationView; reviewing?: boolean }) {
  const timeline = decisionTimeline(view, reviewing);
  if (!reviewing && view.state.status !== "cancelled" && hasDecisionTrace(view)) return <Disclosure title="Как принято решение" className="bank-decision-reference"><DecisionTrace view={view} /></Disclosure>;
  if (!timeline.visible) return null;
  const content = <>
    <ol className="bank-decision-steps" aria-label="Этапы рассмотрения заявки">{timeline.steps.map((step, index) => <li key={index} data-state={step.state} aria-current={step.state === "active" ? "step" : undefined}><span className="bank-decision-node" aria-hidden="true">{step.state === "done" ? <Check size={14} /> : step.state === "stopped" ? <Minus size={14} /> : <Clock3 size={14} />}</span><div>{step.at && <time dateTime={step.at}>{new Date(step.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>}<strong>{step.title}</strong><p>{step.description}</p></div><span className="sr-only">{step.state === "done" ? "Завершено" : step.state === "waiting" ? "Ожидается" : step.state === "attention" ? "Требуется внимание" : step.state === "stopped" ? "Остановлено" : "В процессе"}</span></li>)}</ol>
    {timeline.metrics && <div className="bank-decision-basis"><p>{timeline.seasonal ? "Учтены поток за 6 месяцев, сезонность и действующие платежи. Разовый минус не означает автоматический отказ." : "Учтены история движения денег и действующие обязательства."}</p><dl><div><dt>Поток для расчёта</dt><dd>{formatMoney(timeline.metrics.underwriting_cash_flow)} / мес.</dd></div><div><dt>Текущая нагрузка</dt><dd>{formatMoney(timeline.metrics.existing_monthly_debt_service)} / мес.</dd></div><div><dt>Доступно на новый платёж</dt><dd>{formatMoney(timeline.metrics.available_monthly_payment)} / мес.</dd></div></dl></div>}
  </>;
  return reviewing ? <div className="bank-decision-progress">{content}</div> : <details className="bank-decision-timeline"><summary><span>Ход рассмотрения</span><span>{timeline.title}</span><ChevronDown size={16} aria-hidden="true" /></summary>{content}</details>;
}
