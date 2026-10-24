import type { NeedDraft } from "./need";

export type NeedTask = "purchase" | "cash_gap" | "investment" | "refinancing" | "recurring" | "product";
export const needTasks: { id: NeedTask; label: string; hint: string }[] = [
  { id: "purchase", label: "Закупить товар", hint: "Одна сумма на закупку, возврат ежемесячными платежами." },
  { id: "cash_gap", label: "Дождаться выручки", hint: "Укажите расходы и поступления — рассчитаем, какой овердрафт нужен между ними." },
  { id: "investment", label: "Купить оборудование", hint: "Стоимость проекта и ваш взнос — для расчёта инвестиционного кредита." },
  { id: "refinancing", label: "Объединить кредиты", hint: "Выберите действующие кредиты, которые хотите заменить одним." },
  { id: "recurring", label: "Регулярные закупки", hint: "Возобновляемая кредитная линия: погашенную часть лимита можно использовать снова." },
  { id: "product", label: "Я знаю продукт", hint: "Выберите продукт. Затем уточним сумму и условия для него." },
];
export const needProducts = [
  { value: "working_capital_loan", label: "Кредит на оборотные цели" },
  { value: "overdraft", label: "Овердрафт" },
  { value: "investment_loan", label: "Инвестиционный кредит" },
  { value: "refinancing", label: "Рефинансирование" },
  { value: "revolving_credit_line", label: "Возобновляемая кредитная линия" },
];

export function inferNeedTask(draft: NeedDraft): NeedTask | "" {
  if (needTasks.some(task => task.id === draft.entryTask)) return draft.entryTask as NeedTask;
  if (draft.purpose === "refinancing" || draft.preferredProduct === "refinancing") return "refinancing";
  if (draft.purpose === "investment" || draft.preferredProduct === "investment_loan") return "investment";
  if (draft.preferredProduct === "revolving_credit_line") return "recurring";
  if (draft.preferredProduct) return "product";
  if (draft.financingPattern === "cash_gap") return "cash_gap";
  return draft.purpose ? "purchase" : "";
}

// A task owns its product and repayment method. Lower-level answers cannot change it.
export function scenarioDraft(draft: NeedDraft): NeedDraft {
  const task = inferNeedTask(draft);
  if (!task) return draft;
  const product = task === "product" ? draft.preferredProduct : ({purchase:"", cash_gap:"", investment:"investment_loan", refinancing:"refinancing", recurring:"revolving_credit_line"})[task];
  const investment = product === "investment_loan", refinancing = product === "refinancing";
  const cashGap = task === "cash_gap" || product === "overdraft";
  return { ...draft, entryTask:task, preferredProduct:product,
    purpose: investment ? "investment" : refinancing ? "refinancing" : "working_capital",
    financingPattern:cashGap ? "cash_gap" : "gradual_repayment",
    recurring:task === "recurring" || product === "revolving_credit_line" ? "true" : "false",
    ...(cashGap ? { requestedAmount:"", termMonths:"", minimumAmount:"", amountFlexibility:"", ownFunds:"" } : {}),
    ...(!investment ? {projectCost:"", graceMonths:"0", ownFunds:""} : {}),
  };
}

export function selectNeedTask(draft: NeedDraft, task: NeedTask, product = ""): NeedDraft {
  if (task === inferNeedTask(draft) && (task !== "product" || product === draft.preferredProduct)) return scenarioDraft(draft);
  const next = scenarioDraft({...draft, entryTask:task, preferredProduct:product,
    // A previous product's constraints must not leak into a different task.
    minimumAmount:"", amountFlexibility:"", ownFunds:"", projectCost:"", graceMonths:"0", termMonths:"",
  });
  if (next.preferredProduct === "investment_loan") next.termMonths = "36";
  if (next.preferredProduct === "revolving_credit_line") next.termMonths = "12";
  return next;
}
