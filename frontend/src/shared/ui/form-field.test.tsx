// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ChoiceField, FormField } from "./form-field";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("accessible field descriptions", () => {
  it("keeps caller descriptions alongside hints and errors, then clears invalid state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<FormField id="amount" label="Сумма" hint="В рублях" error="Проверьте сумму" aria-describedby="source" />));
      const input = host.querySelector("input")!;
      expect(input.labels?.[0].textContent).toBe("Сумма");
      expect(input.getAttribute("aria-describedby")).toBe("source amount-hint amount-error");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(host.querySelector("#amount-error")?.textContent).toBe("Проверьте сумму");
      await act(async () => root.render(<FormField id="amount" label="Сумма" hint="В рублях" />));
      expect(input.getAttribute("aria-invalid")).toBeNull();
      expect(input.getAttribute("aria-describedby")).toBe("amount-hint");
      expect(host.querySelector("#amount-error")).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("connects the select trigger to its label, hint and validation message", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ChoiceField id="purpose" label="Задача" value="" options={[]} onValueChange={() => {}} hint="Выберите задачу" error="Нужна цель" />));
      const trigger = host.querySelector("#purpose")!;
      expect(host.querySelector("label")?.htmlFor).toBe("purpose");
      expect(trigger.getAttribute("aria-describedby")).toBe("purpose-hint purpose-error");
      expect(trigger.getAttribute("aria-invalid")).toBe("true");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
