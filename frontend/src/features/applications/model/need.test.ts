import { describe, expect, it } from "vitest";
import { buildNeedChanges, normalizeMoneyInput } from "./need";

describe("need payload", () => {
  it("keeps monetary amounts as decimal strings", () => {
    expect(normalizeMoneyInput(" 500 000,5 ")).toBe("500000.50");
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
