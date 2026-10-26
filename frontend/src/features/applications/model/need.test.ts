import { describe, expect, it } from "vitest";
import { buildNeedChanges, normalizeMoneyInput, draftFromApplication, mergeNeedDraft } from "./need";
import { scenarioDraft, selectNeedTask } from "./need-scenario";
import type { ApplicationView } from "../api/applications";

describe("need payload", () => {
  it("updates an exact amount without validating a hidden minimum from the previous request", () => {
    const draft = draftFromApplication({application:{need:{requested_amount:"500000.00",minimum_acceptable_amount:"500000.00"}}} as ApplicationView);
    const changes = buildNeedChanges({...draft,requestedAmount:"300000"});
    expect(changes["need.minimum_acceptable_amount"]).toBe("300000.00");
  });
  it("preserves the explicit entry mode across a successful save but accepts an external scenario change", () => {
    const base = draftFromApplication({application:{need:{}}} as ApplicationView);
    const draft = selectNeedTask(selectNeedTask(base, "product"), "product", "refinancing");
    const saved = draftFromApplication({application:{need:{purpose:"refinancing",preferred_product:"refinancing",financing_pattern:"gradual_repayment"}}} as ApplicationView);
    expect(scenarioDraft(mergeNeedDraft(saved,{base,draft})).entryTask).toBe("product");
    const external = {...saved,purpose:"investment",preferredProduct:"investment_loan"};
    expect(scenarioDraft(mergeNeedDraft(external,{base,draft})).entryTask).toBe("investment");
  });
  it("sends project cost and contribution without reusing a stale loan amount", () => {
    const changes = buildNeedChanges({ purpose: "investment", preferredProduct: "investment_loan", projectCost: "1 000 000", ownFunds: "200000", graceMonths: "3", termMonths: "36", requestedAmount: "old value", minimumAmount: "", financingPattern: "gradual_repayment", neededBy: "", recurring: "false" });
    expect(changes["need.project_cost"]).toBe("1000000.00");
    expect(changes["need.own_funds"]).toBe("200000.00");
    expect(changes["need.principal_grace_months"]).toBe(3);
    expect(changes["need.requested_amount"]).toBeNull();
  });
  it("keeps monetary amounts as decimal strings", () => {
    expect(normalizeMoneyInput(" 500 000,5 ")).toBe("500000.50");
    expect(normalizeMoneyInput("1\u00a0000\u202f000,50")).toBe("1000000.50");
    expect(normalizeMoneyInput("")).toBeNull();
    expect(() => normalizeMoneyInput("1.999")).toThrow();
  });

  it("maps unknown values to null and preserves an explicit zero of own funds", () => {
    const changes = buildNeedChanges({
      purpose: "working_capital",
      preferredProduct: "",
      requestedAmount: "",
      termMonths: "",
      financingPattern: "",
      minimumAmount: "",
      ownFunds: "0",
      neededBy: "",
      recurring: "",
    });
    expect(changes["need.requested_amount"]).toBeNull();
    expect(changes["need.preferred_product"]).toBeNull();
    expect(changes["need.recurring"]).toBeNull();
    expect(changes["need.own_funds"]).toBe("0.00");
  });
});
