import { describe, expect, it } from "vitest";
import { conversationMessages } from "./conversation-messages";
import type { ChatView } from "../api/chat";

type Message = ChatView["chat"]["messages"][number];
const answer = (text: string): Message => ({
  message_id: "answer", role: "user", text, created_at: "now",
  clarification_question: "Сколько нужно заплатить?",
  clarification_answer: { question_id: "amount", value: "1000000" },
});
const receipt: Message = {
  message_id: "receipt", role: "assistant", text: "Учла ответ в черновике.",
  created_at: "now", mode: "form", question: "Когда нужно заплатить?",
};

describe("clarification history", () => {
  it.each([
    ["1000000.00 ₽", "1 000 000 ₽"],
    ["150000.35 ₽", "150 000,35 ₽"],
    ["24.10.2026", "24.10.2026"],
    ["Постепенно из выручки", "Постепенно из выручки"],
  ])("keeps a form answer in the user's voice: %s", (text, expected) => {
    const messages = [answer(text), receipt];
    const result = conversationMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].message.role).toBe("user");
    expect(result[0].message.text.replace(/\s/g, " ")).toBe(expected);
    expect(result[1].message.role).toBe("assistant");
    expect(result[1].message.text).toBe(receipt.question);
    expect(messages[0].text).toBe(text);
    expect(messages[1].text).toBe("Учла ответ в черновике.");
  });

  it("shows the current question once, in the answer card", () => {
    const result = conversationMessages([answer("Постепенно из выручки"), receipt], receipt.question as string);
    expect(result).toHaveLength(1);
    expect(result[0].message.role).toBe("user");
  });

  it("retains acknowledgement while the controls own the current question", () => {
    const reply = { ...receipt, mode: "model", text: "Поняла. Когда нужно заплатить?" };
    const result = conversationMessages([reply], "Когда нужно заплатить?");
    expect(result[0].message.text).toBe("Поняла.");
    expect(reply.text).toBe("Поняла. Когда нужно заплатить?");
  });

  it("keeps the explicit next step when no questions remain", () => {
    const done = { ...receipt, question: null, text: "Проверьте запрос справа и подтвердите его." };
    expect(conversationMessages([answer("12 мес."), done])[1].message.text).toContain("подтвердите");
  });

  it("keeps ordinary conversational replies intact", () => {
    const messages = [{ ...receipt, mode: "model", text: "Давайте сравним варианты." }];
    expect(conversationMessages(messages)).toEqual(messages.map(message => ({ message })));
  });
});
