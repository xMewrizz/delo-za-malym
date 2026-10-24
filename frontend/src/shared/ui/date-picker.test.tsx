// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DatePicker } from "./date-picker";
import { Dialog } from "radix-ui";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Fixture() {
  const [value, change] = useState("2028-02-28");
  return <Dialog.Root defaultOpen><Dialog.Content><Dialog.Title>Управление продуктом</Dialog.Title><Dialog.Description>Выберите дату платежа</Dialog.Description><DatePicker id="test-date" label="Когда списать деньги" value={value} onChange={change} min="2028-02-20" max="2028-03-15" /></Dialog.Content></Dialog.Root>;
}
describe("bank date picker", () => {
  it("supports leap days, keyboard navigation across months, bounds and returning focus", async () => {
    const host = document.createElement("div"); host.className = "cabinet-shell"; document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Fixture />));
      const trigger = host.querySelector<HTMLButtonElement>("#test-date")!;
      await act(async () => trigger.click());
      expect(document.querySelectorAll('[role="grid"]').length).toBe(2);
      expect(document.querySelector<HTMLButtonElement>('[data-date="2028-02-19"]')?.disabled).toBe(true);
      expect(document.querySelector<HTMLButtonElement>('[data-date="2028-03-16"]')?.disabled).toBe(true);
      const day = () => document.activeElement as HTMLButtonElement;
      await act(async () => document.querySelector<HTMLButtonElement>('[data-date="2028-02-28"]')!.focus());
      await act(async () => day().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(day().dataset.date).toBe("2028-02-29");
      await act(async () => day().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(day().dataset.date).toBe("2028-03-01");
      await act(async () => day().click());
      expect(trigger.textContent).toContain("1 марта 2028");
      expect(document.querySelector('[role="grid"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      await act(async () => trigger.click());
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(document.querySelector('[role="grid"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
