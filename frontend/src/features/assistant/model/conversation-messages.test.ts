import { describe, expect, it } from "vitest";
import { conversationMessages } from "./conversation-messages";
import type { ChatView } from "../api/chat";

type Message = ChatView["chat"]["messages"][number];
const answer = (text: string): Message => ({
  message_id: "answer", role: "user", text, created_at: "now",
  clarification_question: "Сколько нужно заплатить до поступления денег?",
  clarification_answer: { question_id: "amount", value: "1000000" },
});
const receipt: Message = {
  message_id: "receipt", role: "assistant", text: "Учёл ответ в черновике.",
  created_at: "now", mode: "form", question: "Когда нужно заплатить?",
};

describe("clarification history", () => {
  it.each([
    ["1000000.00 ₽", "1 000 000 ₽"],
    ["150000.35 ₽", "150 000,35 ₽"],
    ["24.10.2026", "24.10.2026"],
    ["Заплатить до поступления денег", "Заплатить до поступления денег"],
  ])("pairs the saved question with the readable answer %s", (text, expected) => {
    const messages = [answer(text), receipt];
    const result = conversationMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].message.message_id).toBe("receipt");
    expect(result[0].clarification?.question).toBe(messages[0].clarification_question);
    expect(result[0].clarification?.answer.replace(/\s/g, " ")).toBe(expected);
    // The next question and persisted history must remain untouched.
    expect(result[0].clarification?.question).not.toBe(receipt.question);
    expect(messages[0].text).toBe(text);
    expect(messages).toHaveLength(2);
  });

  it("keeps ordinary replies and incomplete or unrelated exchanges intact", () => {
    const modelReply = { ...receipt, mode: "llm", text: "Давайте сравним варианты." };
    const ordinary = { ...answer("Сравни варианты"), clarification_answer: undefined };
    for (const messages of [[answer("1000000.00 ₽")], [answer("1000000.00 ₽"), modelReply], [ordinary, receipt]]) {
      expect(conversationMessages(messages)).toEqual(messages.map(message => ({ message })));
    }
  });
});
