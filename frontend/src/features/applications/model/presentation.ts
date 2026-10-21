export const productName = (id: string) =>
  id === "overdraft" ? "Овердрафт" : "Кредит на оборотные цели";

const stateNames: Record<string, string> = {
  draft: "Черновик",
  waiting_for_data: "Нужны сведения",
  check_retry_pending: "Проверка недоступна",
  offers_ready: "Предложения готовы",
  conditions_pending: "Нужно выполнить условия",
  ready_to_sign: "Готово к подписанию",
  disbursed: "Кредит выдан",
  limit_opened: "Лимит открыт",
  declined: "Отказ",
  out_of_policy: "Нужен отдельный разбор",
  offer_expired: "Срок предложения истёк",
};

export const stateName = (status: string) => stateNames[status] || status;

const outcomeNames: Record<string, string> = {
  approved: "Одобрено",
  conditional_approval: "Одобрено с условием",
  alternative_offers: "Предложены другие условия",
  needs_information: "Нужны сведения",
  declined: "Отказ",
  out_of_policy: "Требуется отдельное рассмотрение",
  check_retry_pending: "Проверка временно недоступна",
  options_ready: "Варианты готовы",
  no_matching_options: "Подходящих вариантов нет",
};

export const outcomeName = (value: string) =>
  outcomeNames[value] || value.replaceAll("_", " ");

export function describeIssue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const message =
      typeof item.message === "string"
        ? item.message
        : typeof item.question === "string"
          ? item.question
          : null;
    if (message) return message;
    if (typeof item.field === "string") return `Уточните поле ${item.field}.`;
  }
  return "Проверьте данные заявки и повторите расчёт.";
}
