// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useConversationScroll } from "./use-conversation-scroll";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Conversation({ chatId = "one", count, sending = false, visible = true }: {
  chatId?: string; count: number; sending?: boolean; visible?: boolean;
}) {
  const { log, unread, onScroll, jumpToLatest } = useConversationScroll(chatId, count, sending, visible);
  return <><div ref={log} onScroll={onScroll} data-testid="log" />{unread && <button onClick={jumpToLatest}>К новым сообщениям</button>}</>;
}

describe("conversation scroll", () => {
  it("keeps the reading position, offers new messages and resumes following on request", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<Conversation count={40} />));
      const log = host.querySelector<HTMLDivElement>("[data-testid=log]")!;
      let height = 2000;
      Object.defineProperties(log, { scrollHeight: { get: () => height }, clientHeight: { value: 400 } });
      log.scrollTop = 600;
      await act(async () => log.dispatchEvent(new Event("scroll")));
      height = 2200;
      await act(async () => root.render(<Conversation count={41} />));
      expect(log.scrollTop).toBe(600);
      expect(host.querySelector("button")?.textContent).toBe("К новым сообщениям");
      await act(async () => host.querySelector("button")!.click());
      expect(log.scrollTop).toBe(2200);
      expect(host.querySelector("button")).toBeNull();
      height = 2400;
      await act(async () => root.render(<Conversation count={42} />));
      expect(log.scrollTop).toBe(2400);
    } finally { await act(async () => root.unmount()); }
  });

  it("follows a sent message or a different chat, but does not move a reader on a mobile panel switch", async () => {
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => root.render(<Conversation count={40} />));
      const log = host.querySelector<HTMLDivElement>("[data-testid=log]")!;
      Object.defineProperties(log, { scrollHeight: { value: 2000 }, clientHeight: { value: 400 } });
      log.scrollTop = 600;
      await act(async () => log.dispatchEvent(new Event("scroll")));
      await act(async () => root.render(<Conversation count={40} visible={false} />));
      await act(async () => root.render(<Conversation count={40} />));
      expect(log.scrollTop).toBe(600);
      await act(async () => root.render(<Conversation count={40} sending />));
      expect(log.scrollTop).toBe(2000);
      log.scrollTop = 600;
      await act(async () => log.dispatchEvent(new Event("scroll")));
      await act(async () => root.render(<Conversation chatId="two" count={2} />));
      expect(log.scrollTop).toBe(2000);
      expect(host.querySelector("button")).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
});
