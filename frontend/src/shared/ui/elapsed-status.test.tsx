// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ElapsedStatus } from "./elapsed-status";
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT:true});
describe("demo bank elapsed time",()=>{
  it("shows elapsed time and stops its timer when the response replaces it",async()=>{
    vi.useFakeTimers();const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    try {
      await act(async()=>root.render(<ElapsedStatus title="Демо-банк рассматривает заявку" description="Проверяем данные" focus/>));
      expect(document.activeElement).toBe(host.firstElementChild);
      await act(async()=>vi.advanceTimersByTime(2200));
      expect(host.textContent).toContain("Прошло 2 с");
      expect(host.querySelector('[aria-live="off"]')).toBeTruthy();
      await act(async()=>root.render(<p>Предложения готовы</p>));
      expect(vi.getTimerCount()).toBe(0);
      expect(host.textContent).toBe("Предложения готовы");
    } finally {await act(async()=>root.unmount());host.remove();vi.useRealTimers();}
  });
});
