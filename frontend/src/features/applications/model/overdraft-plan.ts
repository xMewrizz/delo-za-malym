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
  automaticPeriod?: boolean;
};

export class PlanValidationError extends Error {
  fieldId: string;
  constructor(fieldId: string, message: string) { super(message); this.fieldId = fieldId; }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateCashFlowRow(row: PlanRow, period: {start: string; end: string}) {
  if (!isDate(row.date)) throw new PlanValidationError(`operation-date-${row.id}`, "Укажите корректную дату операции.");
  if (row.date < period.start || row.date > period.end) throw new PlanValidationError(`operation-date-${row.id}`, "Дата операции должна входить в период прогноза. Измените дату или расширьте период в настройках.");
  try {
    if (!normalizeMoneyInput(row.amount)) throw new Error("Укажите сумму операции больше 0 ₽.");
  } catch (cause) {
    throw new PlanValidationError(`operation-amount-${row.id}`, (cause as Error).message);
  }
}

export function planPeriod(draft: PlanDraft) {
  if (!draft.automaticPeriod) return { start: draft.start, end: draft.end };
  const dates = [draft.start, ...draft.rows.map((row) => row.date)]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return { start: dates[0] || draft.start, end: dates.at(-1) || draft.end };
}

export function draftFromPlan(
  details: Record<string, unknown> | undefined,
): PlanDraft {
  const plan = planSchema.safeParse(details?.overdraft);
  const value = plan.success ? plan.data : null;
  const lastOperation = value?.transactions
    .filter(row => !row.transaction_id.startsWith("bank-payment:"))
    .map(row => row.date).sort().at(-1);
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
    // A saved plan ending on its last operation still follows operation dates.
    // Preserve a deliberately extended forecast period when reopening it.
    automaticPeriod: !value || value.end_date === lastOperation,
  };
}

export function buildOverdraftPlan(draft: PlanDraft, loanIds: string[]) {
  // Bank schedule rows are recalculated by the server. Sending a cached copy
  // makes automatic debt payments look like manually entered business costs.
  draft = { ...draft, rows: draft.rows.filter(row => !row.id.startsWith("bank-payment:")) };
  draft = { ...draft, ...planPeriod(draft) };
  if (!isDate(draft.start)) throw new PlanValidationError("plan-start", "Укажите корректную дату начала прогноза.");
  if (!isDate(draft.end) || draft.start > draft.end) throw new PlanValidationError("plan-end", "Конец прогноза должен быть не раньше его начала.");
  if (draft.rows.length === 0)
    throw new Error("Добавьте хотя бы одно поступление или расход.");
  if (new Set(draft.rows.map((row) => row.id)).size !== draft.rows.length)
    throw new Error("Операции должны иметь разные идентификаторы.");
  const opening = normalizeMoneyInput(draft.openingCash, true);
  let reserve: string | null;
  try { reserve = normalizeMoneyInput(draft.reserve, true); }
  catch (cause) { throw new PlanValidationError("plan-reserve", (cause as Error).message); }
  if (!reserve) throw new PlanValidationError("plan-reserve", "Укажите запас денег на расходы, можно 0 ₽.");
  if (!opening) throw new Error("Не удалось получить остаток счёта. Обновите данные банка.");
  if (loanIds.length && !draft.debtConfirmed)
    throw new PlanValidationError("plan-debt-confirmed",
      "Подтвердите, что платежи по действующим кредитам учтены в плане.",
    );
  const transactions = draft.rows.map((row) => {
    validateCashFlowRow(row, draft);
    if (
      row.loanId &&
      (row.direction !== "outflow" || !loanIds.includes(row.loanId))
    )
      throw new PlanValidationError(`operation-loan-${row.id}`,
        "Связанный кредит уже недоступен. Выберите действующий кредит или уберите привязку.",
      );
    const amount = normalizeMoneyInput(row.amount);
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
