// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LumaScrollStory, ProductScrollShowcase } from "./home-scroll-stories";

vi.mock("gsap", () => ({ gsap: { registerPlugin: vi.fn(), matchMedia: () => ({ add: vi.fn(), revert: vi.fn() }) } }));
vi.mock("gsap/ScrollTrigger", () => ({ ScrollTrigger: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe("landing stories without scroll motion", () => {
  it("lets the visitor inspect all Luma stages and keeps the form separate from the product choice", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const click = (label: string) => act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click());
    try {
      await act(async () => root.render(<MemoryRouter><LumaScrollStory motion={false} /></MemoryRouter>));
      expect(host.querySelector(".ep-live-scroll")?.getAttribute("data-scrub")).toBe("off");
      expect(host.querySelectorAll('[data-known="true"]')).toHaveLength(1);
      await click("Сумма"); expect(host.querySelectorAll('[data-known="true"]')).toHaveLength(2);
      await click("Срок"); expect(host.querySelectorAll('[data-known="true"]')).toHaveLength(3);
      await click("Варианты");
      expect(host.querySelector(".ep-story-request")?.getAttribute("aria-hidden")).toBe("true");
      expect(host.querySelector(".ep-story-offers")?.getAttribute("aria-hidden")).toBe("false");
      expect(host.querySelectorAll(".ep-story-offer")).toHaveLength(3);
      await click("Выбор");
      expect(host.querySelector(".ep-story-selected")?.getAttribute("aria-hidden")).toBe("false");
      expect(host.querySelector(".ep-story-selected")?.textContent).toContain("24% годовых");
      await click("Задача"); expect(host.querySelectorAll('[data-known="true"]')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("changes product examples manually and removes inactive actions from the keyboard path", async () => {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(<MemoryRouter><ProductScrollShowcase motion={false} /></MemoryRouter>));
      expect(host.querySelectorAll(".ep-product-panel[inert]")).toHaveLength(4);
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Кредитная линия")!.click());
      expect(host.querySelector(".ep-product-track")?.getAttribute("style")).toBeNull();
      expect(host.querySelector(".ep-product-scroll")?.getAttribute("data-product")).toBe("2");
      expect(host.querySelector('.ep-product-panel[aria-hidden="false"]')?.textContent).toContain("320 000 ₽");
      expect(host.querySelectorAll(".ep-product-panel[inert]")).toHaveLength(4);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
