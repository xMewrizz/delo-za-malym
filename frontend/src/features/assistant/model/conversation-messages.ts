import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import type { ChatView } from "../api/chat";

type Message = ChatView["chat"]["messages"][number];

export type ConversationMessage = {
  message: Message;
  clarification?: { question: string; answer: string };
};

function formatAnswer(text: string): string {
  const money = /^(\d+(?:\.\d{1,2})?) ₽$/.exec(text);
  if (!money || !Number.isFinite(Number(money[1]))) return text;
  return Number.isInteger(Number(money[1]))
    ? formatMoney(money[1])
    : formatMoneyPrecise(money[1]);
}

/** Present a saved form exchange as one question-and-answer bubble from Luma. */
export function conversationMessages(messages: readonly Message[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const reply = messages[index + 1];
    if (
      message.role === "user" &&
      message.clarification_answer?.question_id &&
      message.clarification_question?.trim() &&
      reply?.role === "assistant" &&
      reply.mode === "form"
    ) {
      result.push({
        message: reply,
        clarification: {
          question: message.clarification_question,
          answer: formatAnswer(message.text),
        },
      });
      index++;
    } else {
      result.push({ message });
    }
  }
  return result;
}
