import { describe, expect, it } from "vitest";
import { buildOverdraftPlan, draftFromPlan, type PlanDraft } from "./overdraft-plan";

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
  it("does not resubmit cached bank schedule payments as business expenses", () => {
    const bankRow = {...sample.rows[0],id:"bank-payment:issued-loan:2026-11-01",amount:"30000",loanId:"issued-loan"};
    const draft = {...sample,rows:[bankRow,...sample.rows]};
    const plan = buildOverdraftPlan(draft, []);
    expect(plan.transactions.map(row=>row.transaction_id)).toEqual(["purchase-001","customer-001"]);
    expect(plan.existing_debt_payments).toEqual([]);
    expect(draft.rows).toHaveLength(3);
  });
  it("requires a business operation even when cached bank payments exist",()=>{
    expect(()=>buildOverdraftPlan({...sample,rows:[{...sample.rows[0],id:"bank-payment:loan:2026-11-01",loanId:"loan"}]},[])).toThrow("Добавьте хотя бы одно");
  });
  it("extends the automatic period when a receipt is later than the initial date", () => {
    const plan = buildOverdraftPlan({ ...sample, end: sample.start, automaticPeriod: true }, []);
    expect(plan.start_date).toBe("2026-11-01");
    expect(plan.end_date).toBe("2026-11-11");
  });
  it("extends a reopened plan when the receipt moves beyond its saved end", () => {
    const restored = draftFromPlan({overdraft:buildOverdraftPlan(sample,[])});
    restored.rows[1].date = "2026-11-30";
    expect(buildOverdraftPlan(restored,[]).end_date).toBe("2026-11-30");
  });
  it("preserves a deliberately extended forecast when reopening", () => {
    const restored = draftFromPlan({overdraft:buildOverdraftPlan({...sample,end:"2026-12-01"},[])});
    expect(restored.automaticPeriod).toBe(false);
    expect(buildOverdraftPlan(restored,[]).end_date).toBe("2026-12-01");
  });
  it("rejects operation outside the period", () => {
    expect(() =>
      buildOverdraftPlan(
        { ...sample, rows: [{ ...sample.rows[0], date: "2026-11-12" }] },
        [],
      ),
    ).toThrow("Дата операции должна входить");
  });
  it("identifies the exact invalid operation without discarding other entered rows", () => {
    try { buildOverdraftPlan({...sample,rows:[sample.rows[0],{...sample.rows[1],amount:""}]},[]); }
    catch(error) { expect(error).toMatchObject({fieldId:"operation-amount-customer-001"}); return; }
    throw new Error("Empty receipt must be rejected");
  });
  it("rejects impossible calendar dates before sending the plan", () => {
    expect(()=>buildOverdraftPlan({...sample,rows:[{...sample.rows[0],date:"2026-02-30"}]},[])).toThrow("корректную дату операции");
  });
});
