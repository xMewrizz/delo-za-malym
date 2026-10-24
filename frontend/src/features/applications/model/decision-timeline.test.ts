import { describe, expect, it } from "vitest";
import type { ApplicationView } from "../api/applications";
import { decisionTimeline } from "./decision-timeline";

const view = (fields: Partial<ApplicationView> = {}) => ({ events: [{ event_id: "submit", type: "application_submitted", created_at: "2026-10-23T10:00:00+03:00" }], state: { status: "under_review" }, result: null, ...fields } as ApplicationView);
describe("bank decision timeline", () => {
  it("does not convert elapsed time or an earlier preliminary result into completed checks", () => {
    const pending = decisionTimeline(view({ result: { status: "assessed", assessment: { assessment_id: "a", stage: "preliminary", outcome: "approved", offers: [] } } }), true);
    expect(pending.steps.map(step => step.state)).toEqual(["done", "active", "waiting"]);
    expect(pending.metrics).toBeNull();
    expect(decisionTimeline(view({ events: [] })).visible).toBe(false);
  });
  it("shows a decline as a finished decision requiring attention, without claiming approval", () => {
    const timeline = decisionTimeline(view({ result: { status: "assessed", assessment: { assessment_id: "a", stage: "final", outcome: "declined", offers: [] } } }));
    expect(timeline.steps.map(step => step.state)).toEqual(["done", "done", "attention"]);
    expect(timeline.title).toBe("Финансирование недоступно");
  });
  it("retains cancellation even if an older approval is present", () => {
    const cancelled = decisionTimeline(view({ state: { status: "cancelled" } as ApplicationView["state"], result: { status: "assessed", assessment: { assessment_id: "a", stage: "final", outcome: "approved", offers: [] } } }));
    expect(cancelled.title).toBe("Заявка отменена");
    expect(cancelled.steps.at(-1)?.state).toBe("stopped");
  });
});
