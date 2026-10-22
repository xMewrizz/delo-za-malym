import { describe, expect, it } from "vitest";
import { filterProductEvents, type CalendarEvent } from "./api";

describe("product calendar scope", () => {
  const events: CalendarEvent[] = [
    { event_id: "bank-one", application_id: "", loan_id: "bank-1", date: "2026-11-15", amount: "35000.00", direction: "outflow", kind: "existing_loan_payment", title: "Банковский кредит", forecast: true },
    { event_id: "app-one", application_id: "app-1", date: "2026-11-16", amount: "40000.00", direction: "outflow", kind: "loan_payment", title: "Кредит из кабинета", forecast: true },
    { event_id: "app-two", application_id: "app-2", date: "2026-11-17", amount: "12000.00", direction: "outflow", kind: "overdraft_repayment", title: "Овердрафт", forecast: true },
  ];
  it("keeps all products in the common calendar and isolates each product", () => {
    expect(filterProductEvents(events, "all")).toHaveLength(3);
    expect(filterProductEvents(events, "loan:bank-1").map(event => event.event_id)).toEqual(["bank-one"]);
    expect(filterProductEvents(events, "app:app-1").map(event => event.event_id)).toEqual(["app-one"]);
    expect(filterProductEvents(events, "app:app-2").map(event => event.event_id)).toEqual(["app-two"]);
  });
  it("does not expose other products for an unavailable product link", () => {
    expect(filterProductEvents(events, "loan:missing")).toEqual([]);
    expect(filterProductEvents(events, "invalid")).toEqual([]);
  });
});
