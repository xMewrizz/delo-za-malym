// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Offer } from "../api/applications";
import { OfferKeyFigures } from "./offer-key-figures";

const render = (changes: Partial<Offer> = {}) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<OfferKeyFigures option={{ offer_id: "offer", product_id: "working_capital_loan", amount: "700000.00", monthly_payment: "66192.00", ...changes }} />);
  return [...host.querySelectorAll("dl>div")].map(row => ({ label: row.querySelector("dt")!.textContent, value: row.querySelector("dd")!.textContent!.replace(/\s/g, " ") }));
};

describe("offer comparison figures", () => {
  it("puts different monthly payments alongside the same loan amount", () => {
    const shortTerm = render();
    const longTerm = render({ monthly_payment: "27463.00" });
    expect(shortTerm[0]).toEqual({ label: "Сумма кредита", value: "700 000 ₽" });
    expect(longTerm[0]).toEqual(shortTerm[0]);
    expect(shortTerm[1]).toEqual({ label: "Платёж в месяц", value: "66 192 ₽" });
    expect(longTerm[1]).toEqual({ label: "Платёж в месяц", value: "27 463 ₽" });
  });
  it("labels the investment maximum and does not imply a fixed payment for an unused line", () => {
    expect(render({ product_id: "investment_loan" })[1].label).toBe("Макс. платёж в месяц");
    expect(render({ product_id: "revolving_credit_line", monthly_payment: null })).toEqual([
      { label: "Лимит финансирования", value: "700 000 ₽" },
      { label: "Погашение", value: "До конца срока" },
    ]);
  });
});
