import { z } from "zod";
import type { ApplicationView } from "../api/applications";

const metricsSchema = z.object({ average_monthly_cash_flow: z.string(), underwriting_cash_flow: z.string(), existing_monthly_debt_service: z.string(), available_monthly_payment: z.string() });
export function decisionTimeline(view: ApplicationView, reviewing = false) {
  const last = (type: string) => [...view.events].reverse().find(event => event.type === type);
  const submitted = last("application_submitted");
  const assessment = view.result?.assessment;
  const finished = !reviewing && assessment?.stage === "final";
  const cancelled = !reviewing && view.state.status === "cancelled";
  const checking = !finished && !cancelled;
  const outcome = assessment?.outcome;
  const finalTitle = cancelled ? "Заявка отменена" : !finished ? "Решение банка" : outcome === "needs_information" ? "Нужны дополнительные сведения" : ["declined", "out_of_policy"].includes(outcome || "") ? "Финансирование недоступно" : "Условия готовы";
  const metrics = metricsSchema.safeParse(view.result?.financial_metrics);
  const version = typeof assessment?.policy_version === "string" ? assessment.policy_version : "";
  return {
    visible: reviewing || Boolean(submitted), title: finalTitle,
    steps: [
      { title: submitted ? "Заявка получена" : "Заявка отправлена", description: "Параметры переданы на рассмотрение", state: "done", at: submitted?.created_at },
      { title: "Проверки и расчёт", description: finished ? outcome === "needs_information" ? "Для расчёта потребовались уточнения" : "Оценены данные бизнеса и условия продукта" : cancelled ? "Рассмотрение остановлено" : view.state.status === "check_retry_pending" && !reviewing ? "Проверку нужно повторить" : "Оцениваем данные и условия продукта", state: finished ? "done" : cancelled ? "stopped" : "active", at: reviewing ? undefined : last("review_started")?.created_at },
      { title: finalTitle, description: cancelled ? "Новую заявку можно создать отдельно" : finished ? assessment?.offers.length ? "Можно выбрать предложение и оформить продукт" : "Причина и дальнейшие действия указаны в результате" : "Появится после завершения проверки", state: cancelled ? "stopped" : finished ? ["declined", "out_of_policy", "needs_information"].includes(outcome || "") ? "attention" : "done" : "waiting", at: cancelled ? last("application_cancelled")?.created_at : finished ? last("assessment_completed")?.created_at : undefined },
    ],
    checking, metrics: !reviewing && metrics.success ? metrics.data : null, seasonal: version.includes("seasonal-v2"),
  };
}
