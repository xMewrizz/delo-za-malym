export const upcomingProducts = [
  { id: "investment_loan", name: "Инвестиционный кредит", short: "Вложиться в следующий этап", description: "Оборудование, новые мощности и развитие бизнеса.", number: "05" },
] as const;

export function financingName(id?: string | null) {
  const names: Record<string, string> = {
    working_capital_loan: "Кредит на оборотные цели", overdraft: "Овердрафт",
    refinancing: "Рефинансирование", revolving_credit_line: "Возобновляемая кредитная линия", investment_loan: "Инвестиционный кредит",
  };
  return id ? names[id] || "Финансирование" : "Подбор финансирования";
}
