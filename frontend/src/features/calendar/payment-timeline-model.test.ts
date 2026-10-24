import { describe, expect, it } from "vitest";
import type { CalendarData, CalendarEvent } from "./api";
import { timelineMarkerLanes, contractSegment, productDays, timelineDays, timelineProducts } from "./payment-timeline-model";

const payment = (id: string, fields: Partial<CalendarEvent> = {}): CalendarEvent => ({ event_id: id, application_id: "first", date: "2026-11-15", amount: "0.10", forecast: true, direction: "outflow", kind: "loan_payment", title: "Платёж", ...fields });
const calendar: CalendarData = { today: "2026-10-23", plans: [], penalty_terms: [], payment_orders: [], events: [], accounts: [
  { application_id: "first", product_id: "working_capital_loan", amount: "500000", opened_at: "2026-10-22T12:00:00+03:00", maturity_date: "2027-10-22", outstanding_principal: "500000" },
  { application_id: "second", product_id: "working_capital_loan", amount: "400000", opened_at: "2026-10-22", outstanding_principal: "400000" },
] };
describe("payment timeline display model", () => {
  it("keeps same-named products separate and isolates forecasts from the actual contract", () => {
    const events = [payment("a"), payment("a"), payment("b", { application_id: "second" }), payment("plan", { kind: "planned_expense" })];
    const rows = timelineProducts(calendar, undefined, events, "all");
    expect(rows.map(row => row.id)).toEqual(["app:first", "app:second", "plan:cashflow"]);
    expect(rows[0].events).toHaveLength(1);
    expect(rows[1].events[0].event_id).toBe("b");
    expect(rows[2].planned).toBe(true);
    expect(timelineProducts(calendar, undefined, events, "app:first")).toHaveLength(1);
  });
  it("clips contract spans to the visible window without inventing unknown dates", () => {
    const days = timelineDays("2026-11-01", 1), rows = timelineProducts(calendar, undefined, [], "all");
    expect(contractSegment(rows[0], days)).toEqual({ left: 0, width: 100, continuesBefore: true, continuesAfter: true });
    expect(rows[1].maturity).toBeUndefined();
    expect(contractSegment({ ...rows[0], opened: "2026-12-01" }, days)).toBeNull();
    expect(contractSegment({ ...rows[0], maturity: "2026-10-31" }, days)).toBeNull();
    expect(contractSegment({ ...rows[0], opened: "2026-11-04", maturity: "2026-11-09" }, days)).toMatchObject({ left: 10, width: 20 });
  });
  it("groups same-day events with exact cent sums and distinguishes performed operations", () => {
    const events = [payment("a"), payment("b", { amount: "0.20" }), payment("paid", { amount: "10", forecast: false }), payment("later", { date: "2026-12-15" })];
    const row = timelineProducts(calendar, undefined, events, "all")[0];
    const days = productDays(row, timelineDays("2026-11-01", 1));
    expect(days).toHaveLength(1);
    expect(days[0].payment).toBe("0.30");
    expect(days[0].events).toHaveLength(3);
    expect(events).toHaveLength(4);
  });
  it("uses actual calendar days across leap months and year boundaries", () => {
    expect(timelineDays("2028-02-01", 1)).toHaveLength(29);
    expect(timelineDays("2026-12-01", 3).at(-1)).toBe("2027-02-28");
    expect(timelineDays("2026-10-01", 3)).toHaveLength(92);
    expect(timelineDays("9999-12-01", 3).at(-1)).toBe("9999-12-31");
    expect(timelineDays("0001-01-01", 1)).toHaveLength(31);
  });
  it("ends a refinanced contract when the replacement opens, without removing its historical row",()=>{
    const rows=timelineProducts({...calendar,accounts:[{...calendar.accounts[0],status:"refinanced",refinanced_by:"second"},{...calendar.accounts[1],opened_at:"2026-11-10"}]},undefined,[],"all");
    expect(rows).toHaveLength(2);expect(rows[0].maturity).toBe("2026-11-10");
    expect(contractSegment(rows[0],timelineDays("2026-12-01",1))).toBeNull();
  });
});

it("separates nearby operations into lanes while leaving distant markers on the main line", () => {
  expect(timelineMarkerLanes(["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-11-22"], 3)).toEqual([0, -1, 1, 0, 0]);
  expect(timelineMarkerLanes(["2026-10-22", "2026-10-23"], 1)).toEqual([0, 0]);
});
