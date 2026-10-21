import { describe, expect, it } from "vitest";
import { buildOverdraftPlan, type PlanDraft } from "./overdraft-plan";

const sample: PlanDraft = {
  start: "2026-11-01",
  end: "2026-11-11",
  openingCash: "100000",
  reserve: "0",
  debtConfirmed: true,
  rows: [
    {
      id: "purchase-001",
      date: "2026-11-01",
      direction: "outflow",
      amount: "250000",
      loanId: "",
    },
    {
      id: "customer-001",
      date: "2026-11-11",
      direction: "inflow",
      amount: "200000",
      loanId: "",
    },
  ],
};

describe("overdraft plan payload", () => {
  it("preserves dates and IDs and sends decimal amounts as strings", () => {
    expect(buildOverdraftPlan(sample, [])).toEqual({
      start_date: "2026-11-01",
      end_date: "2026-11-11",
      opening_cash_balance: "100000.00",
      cash_reserve: "0.00",
      transactions: [
        {
          transaction_id: "purchase-001",
          date: "2026-11-01",
          direction: "outflow",
          amount: "250000.00",
        },
        {
          transaction_id: "customer-001",
          date: "2026-11-11",
          direction: "inflow",
          amount: "200000.00",
        },
      ],
      existing_debt_payments: [],
    });
  });
  it("requires confirmation for existing loan payments", () => {
    expect(() =>
      buildOverdraftPlan({ ...sample, debtConfirmed: false }, ["loan-1"]),
    ).toThrow("Подтвердите");
  });
  it("rejects operation outside the period", () => {
    expect(() =>
      buildOverdraftPlan(
        { ...sample, rows: [{ ...sample.rows[0], date: "2026-11-12" }] },
        [],
      ),
    ).toThrow("Дата каждой операции");
  });
});
