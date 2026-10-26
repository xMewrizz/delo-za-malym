import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import type { ChatView } from "../api/chat";

type Message = ChatView["chat"]["messages"][number];

export type ConversationMessage = {
  message: Message;
};

function formatAnswer(text: string): string {
  const money = /^(\d+(?:\.\d{1,2})?) ₽$/.exec(text);
  if (!money || !Number.isFinite(Number(money[1]))) return text;
  return Number.isInteger(Number(money[1]))
    ? formatMoney(money[1])
    : formatMoneyPrecise(money[1]);
}

/** Keep answers in the user's voice; the current question lives with its controls. */
export function conversationMessages(messages: readonly Message[], currentQuestion?: string): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    let text = message.text;
    if (message.role === "user" && message.clarification_answer) text = formatAnswer(text);
    if (message.role === "assistant" && message.mode === "form" && typeof message.question === "string") {
      text = message.question;
    }
    if (message.role === "assistant" && index === messages.length - 1 && currentQuestion && text.endsWith(currentQuestion)) {
      text = text.slice(0, -currentQuestion.length).trim();
      if (!text) continue;
    }
    result.push({ message: text === message.text ? message : { ...message, text } });
  }
  return result;
}
