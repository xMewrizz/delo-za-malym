// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLumaMotion } from "./use-luma-motion";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let reduced = false;
const created: { node: HTMLElement; cancel: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
  reduced = false;
  created.length = 0;
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("Animation", class {});
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn(function(this: HTMLElement) {
    const animation = { node: this, cancel: vi.fn(), onfinish: null };
    created.push(animation);
    return animation;
  }) });
});
afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).animate; vi.unstubAllGlobals(); });

function Scene({ amount = "Уточняем", bank = "100000", messages = ["history"], settled = false, chat = "one" }: {
  amount?: string; bank?: string; messages?: string[]; settled?: boolean; chat?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLumaMotion(ref, chat);
  return <div ref={ref}>
    {messages.map(id => <div className="assistant-message" data-message-key={id} key={id + String(settled)}>{id}</div>)}
    <dl className="collected-facts">
      <div className="collected-fact" data-live-field="amount"><dt>Сумма</dt><dd>{amount}</dd><input defaultValue="Черновик исправления" /></div>
      <div className="collected-fact" data-live-field="bank" data-live-static="true"><dt>Остаток банка</dt><dd>{bank}</dd></div>
    </dl>
  </div>;
}

describe("motion in a real Luma conversation", () => {
  it("highlights changed values, preserves the editor, and does not replay on unchanged data or bank refresh", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    document.body.append(host);
    try {
      await act(async () => root.render(<Scene />));
      const editor = host.querySelector("input");
      expect(created).toHaveLength(0);
      await act(async () => root.render(<Scene amount="400000" bank="120000" />));
      expect(created).toHaveLength(1);
      expect(created[0].node.tagName).toBe("DD");
      expect(host.querySelector('[data-live-field=amount]')?.hasAttribute("data-live-updated")).toBe(true);
      expect(host.querySelector('[data-live-field=bank]')?.hasAttribute("data-live-updated")).toBe(false);
      await act(async () => root.render(<Scene amount="400000" bank="130000" />));
      expect(created).toHaveLength(1);
      expect(host.querySelector("input")).toBe(editor);
      await act(async () => root.render(<Scene amount="450000" />));
      expect(created[0].cancel).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("animates new replies once and keeps an optimistic message from appearing twice", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<Scene />));
      await act(async () => root.render(<Scene messages={["history", "user:request"]} />));
      expect(created).toHaveLength(1);
      await act(async () => root.render(<Scene settled messages={["history", "user:request", "assistant:reply"]} />));
      expect(created).toHaveLength(2);
      expect(created[1].node.textContent).toBe("assistant:reply");
    } finally { await act(async () => root.unmount()); }
  });
  it("does not animate loaded history when switching conversations", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<Scene />));
      await act(async () => root.render(<Scene chat="two" amount="600000" messages={["older", "saved"]} />));
      expect(created).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
  });
  it("keeps the same animation behavior regardless of the system motion setting", async () => {
    reduced = true;
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<Scene />));
      await act(async () => root.render(<Scene amount="450000" messages={["history", "reply"]} />));
      expect(created).toHaveLength(2);
      expect(host.querySelector('[data-live-updated]')).not.toBeNull();
      expect(host.querySelector("dd")?.textContent).toBe("450000");
    } finally { await act(async () => root.unmount()); }
  });
});
