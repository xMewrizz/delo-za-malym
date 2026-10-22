export const upcomingProducts: readonly { id: string; name: string; short: string; description: string; number: string }[] = [];

export function financingName(id?: string | null) {
  const names: Record<string, string> = {
    working_capital_loan: "Кредит на оборотные цели", overdraft: "Овердрафт",
    refinancing: "Рефинансирование", revolving_credit_line: "Возобновляемая кредитная линия", investment_loan: "Инвестиционный кредит",
  };
  return id ? names[id] || "Финансирование" : "Подбор финансирования";
}
