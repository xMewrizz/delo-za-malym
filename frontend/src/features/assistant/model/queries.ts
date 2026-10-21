import { queryOptions } from "@tanstack/react-query";
import { getChat, listChats } from "../api/chat";

export const chatKeys = {
  list: (applicationId: string) => ["chats", applicationId] as const,
  detail: (chatId: string) => ["chats", "detail", chatId] as const,
};

export const chatQueries = {
  list: (applicationId: string) =>
    queryOptions({
      queryKey: chatKeys.list(applicationId),
      queryFn: ({ signal }) => listChats(applicationId, signal),
    }),
  detail: (chatId: string) =>
    queryOptions({
      queryKey: chatKeys.detail(chatId),
      queryFn: ({ signal }) => getChat(chatId, signal),
    }),
};
