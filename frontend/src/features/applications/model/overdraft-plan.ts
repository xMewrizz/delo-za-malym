import { z } from "zod";
import { normalizeMoneyInput } from "./need";

const planSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
  opening_cash_balance: z.string(),
  cash_reserve: z.string(),
  debt_payments_confirmed: z.boolean().optional(),
  transactions: z.array(
    z.object({
      transaction_id: z.string(),
      date: z.string(),
      direction: z.enum(["inflow", "outflow"]),
      amount: z.string(),
    }),
  ),
  existing_debt_payments: z
    .array(z.object({ loan_id: z.string(), transaction_id: z.string() }))
    .optional(),
});

export type PlanRow = {
  id: string;
  date: string;
  direction: "inflow" | "outflow";
  amount: string;
  loanId: string;
};
export type PlanDraft = {
  start: string;
  end: string;
  openingCash: string;
  reserve: string;
  rows: PlanRow[];
  debtConfirmed: boolean;
};

export function draftFromPlan(
  details: Record<string, unknown> | undefined,
): PlanDraft {
  const plan = planSchema.safeParse(details?.overdraft);
  const value = plan.success ? plan.data : null;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Europe/Moscow",
  });
  return {
    start: value?.start_date || today,
    end: value?.end_date || today,
    openingCash: value?.opening_cash_balance || "",
    reserve: value?.cash_reserve || "0.00",
    rows: (value?.transactions || []).map((row) => ({
      id: row.transaction_id,
      date: row.date,
      direction: row.direction,
      amount: row.amount,
      loanId:
        value?.existing_debt_payments?.find(
          (link) => link.transaction_id === row.transaction_id,
        )?.loan_id || "",
    })),
    debtConfirmed:
      value?.debt_payments_confirmed ?? Boolean(value?.existing_debt_payments),
  };
}

export function buildOverdraftPlan(draft: PlanDraft, loanIds: string[]) {
  if (!draft.start || !draft.end || draft.start > draft.end)
    throw new Error("Укажите корректный период плана.");
  if (draft.rows.length === 0)
    throw new Error("Добавьте хотя бы одно поступление или расход.");
  if (new Set(draft.rows.map((row) => row.id)).size !== draft.rows.length)
    throw new Error("Операции должны иметь разные идентификаторы.");
  const opening = normalizeMoneyInput(draft.openingCash, true);
  const reserve = normalizeMoneyInput(draft.reserve, true);
  if (!opening || !reserve)
    throw new Error("Укажите начальный остаток и резерв, можно 0.");
  if (loanIds.length && !draft.debtConfirmed)
    throw new Error(
      "Подтвердите, что платежи по действующим кредитам учтены в плане.",
    );
  const transactions = draft.rows.map((row) => {
    if (!row.date || row.date < draft.start || row.date > draft.end)
      throw new Error("Дата каждой операции должна входить в период плана.");
    if (
      row.loanId &&
      (row.direction !== "outflow" || !loanIds.includes(row.loanId))
    )
      throw new Error(
        "Платёж по кредиту должен быть расходом по действующему кредиту.",
      );
    const amount = normalizeMoneyInput(row.amount);
    if (!amount)
      throw new Error("Укажите положительную сумму каждой операции.");
    return {
      transaction_id: row.id,
      date: row.date,
      direction: row.direction,
      amount,
    };
  });
  return {
    start_date: draft.start,
    end_date: draft.end,
    opening_cash_balance: opening,
    cash_reserve: reserve,
    transactions,
    existing_debt_payments: draft.rows
      .filter((row) => row.loanId)
      .map((row) => ({ loan_id: row.loanId, transaction_id: row.id })),
  };
}
