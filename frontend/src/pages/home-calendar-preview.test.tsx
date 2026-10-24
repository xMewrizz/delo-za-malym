// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { HomeCalendarPreview } from "./home-calendar-preview";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("calendar example on the landing", () => {
  it("shows the full real month and opens details for the selected payment date", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<MemoryRouter><HomeCalendarPreview /></MemoryRouter>));
      expect(host.querySelectorAll(".ep-payment-day")).toHaveLength(30);
      expect(host.querySelectorAll(".ep-payment-empty")).toHaveLength(6);
      expect(host.querySelector('.ep-payment-day[aria-pressed="true"]')?.getAttribute("aria-label")).toContain("18 ноября");
      const day = [...host.querySelectorAll<HTMLButtonElement>(".ep-payment-day")].find(button => button.getAttribute("aria-label")?.startsWith("13 ноября"))!;
      await act(async () => day.click());
      const details = host.querySelector(".ep-payment-day-card")!;
      expect(details.querySelector("h4")?.textContent).toBe("13 ноября");
      expect(details.textContent).toContain("32 800 ₽");
      expect(details.textContent).toContain("26 800 ₽ — долг");
      expect(details.textContent).toContain("6 000 ₽ — проценты");
      expect(details.querySelector("a")?.getAttribute("href")).toBe("/cabinet?mode=calendar&date=2026-11-13");
      expect(host.querySelector(".ep-payment-preview-toolbar a")).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

  it("switches the demo to a timeline locally and shares the selected date with the calendar", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<MemoryRouter><HomeCalendarPreview /></MemoryRouter>));
      const toggle = [...host.querySelectorAll<HTMLButtonElement>(".ep-payment-view-toggle button")];
      await act(async () => toggle[1].click());
      expect(host.querySelector(".ep-payment-preview")?.getAttribute("data-view")).toBe("timeline");
      expect(host.querySelector<HTMLElement>(".ep-payment-preview-grid")?.hidden).toBe(true);
      expect(host.querySelector<HTMLElement>(".ep-payment-timeline")?.hidden).toBe(false);
      const payment = host.querySelector<HTMLButtonElement>('.ep-payment-timeline button[aria-label^="27 ноября"]')!;
      await act(async () => payment.click());
      expect(host.querySelector(".ep-payment-day-card h4")?.textContent).toBe("27 ноября");
      expect(host.querySelector(".ep-payment-detail")?.textContent).toContain("Кредитная линия");
      await act(async () => toggle[0].click());
      expect(host.querySelector<HTMLElement>(".ep-payment-timeline")?.hidden).toBe(true);
      expect(host.querySelector('.ep-payment-day[aria-pressed="true"]')?.getAttribute("aria-label")).toContain("27 ноября");
    } finally { await act(async () => root.unmount()); }
  });

  it("keeps the mobile week and month selection consistent and handles days without payments", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<MemoryRouter><HomeCalendarPreview /></MemoryRouter>));
      const days = [...host.querySelectorAll<HTMLButtonElement>(".ep-payment-preview-week button")];
      expect(days).toHaveLength(7);
      await act(async () => days[3].click());
      expect(host.querySelector(".ep-payment-day-card h4")?.textContent).toBe("19 ноября");
      expect(host.querySelector(".ep-payment-no-events")?.textContent).toBe("На этот день событий нет.");
      expect(host.querySelector(".ep-payment-day-total strong")?.textContent).toBe("0 ₽");
      expect(host.querySelector('.ep-payment-day[aria-pressed="true"]')?.textContent).toBe("19");
    } finally { await act(async () => root.unmount()); }
  });
});
