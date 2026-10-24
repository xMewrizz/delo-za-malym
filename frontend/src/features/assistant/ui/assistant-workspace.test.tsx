// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AssistantWorkspace, type WorkspaceSection } from "./assistant-workspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("Luma workspace navigation", () => {
  it("keeps each panel mounted, preserving edits and scroll when switching with the keyboard", async () => {
    function Harness() {
      const [section, setSection] = useState<WorkspaceSection>("data");
      return <AssistantWorkspace
        section={section} onSectionChange={setSection} headingRef={useRef(null)} offersRef={useRef(null)}
        pending updating={false}
        data={<input aria-label="Исправление суммы" defaultValue="1000000" />}
        footer={<button>Подтвердить данные</button>}
        offers={<h3>Сравнение условий</h3>}
      />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      const input = host.querySelector<HTMLInputElement>("input")!;
      input.value = "1200000";
      const scroll = input.closest(".assistant-workspace-scroll")!;
      scroll.scrollTop = 160;
      const dataTab = host.querySelector<HTMLButtonElement>('[role=tab][data-state=active]')!;
      const offersTab = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(tab => tab.textContent === "Предложения")!;
      await act(async () => offersTab.focus());
      expect(offersTab.getAttribute("aria-selected")).toBe("true");
      expect(input.closest("[hidden]")).toBeTruthy();
      expect(host.querySelector("h3")?.closest("[hidden]")).toBeNull();
      await act(async () => dataTab.focus());
      expect(input.closest("[hidden]")).toBeNull();
      expect(input.value).toBe("1200000");
      expect(scroll.scrollTop).toBe(160);
      expect(host.querySelector("input")).toBe(input);
      expect(host.querySelectorAll('[role=tabpanel]')).toHaveLength(2);
      expect(host.querySelectorAll('[role=tab]')).toHaveLength(2);
      expect(host.textContent).not.toContain("Документы");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
