import { z } from "zod";
import { applicationViewSchema } from "@/features/applications";
import { apiRequest } from "@/shared/api/client";

const proposalSchema = z
  .object({
    proposal_id: z.string(),
    status: z.string(),
    changes: z.record(z.string(), z.unknown()),
    conflicts: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const chatViewSchema = z
  .object({
    chat: z
      .object({
        chat_id: z.string(),
        application_id: z.string(),
        chat_version: z.number().int(),
        messages: z.array(
          z
            .object({
              message_id: z.string(),
              role: z.string(),
              text: z.string(),
              created_at: z.string(),
              proposal: proposalSchema.nullable().optional(),
              mode: z.string().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    record: applicationViewSchema,
    assistant: z
      .object({
        mode: z.string(),
        model: z.string().nullable().optional(),
        max_turns: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const chatListSchema = z.array(
  z.object({ chat_id: z.string(), created_at: z.string() }),
);
export type ChatView = z.infer<typeof chatViewSchema>;

const chatPath = (id: string, suffix = ""): `/${string}` =>
  `/chats/${encodeURIComponent(id)}${suffix}`;
const send = (url: `/${string}`, body: Record<string, unknown>) =>
  apiRequest(url, chatViewSchema, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 120_000,
  });

export const listChats = (applicationId: string, signal?: AbortSignal) =>
  apiRequest(
    `/applications/${encodeURIComponent(applicationId)}/chats`,
    chatListSchema,
    { signal },
  );
export const getChat = (id: string, signal?: AbortSignal) =>
  apiRequest(chatPath(id), chatViewSchema, { signal });
export const createChat = (applicationId: string) =>
  send("/chats", { application_id: applicationId });
export const sendMessage = (
  id: string,
  version: number,
  requestId: string,
  text: string,
) =>
  send(chatPath(id, "/messages"), {
    base_chat_version: version,
    request_id: requestId,
    text,
  });
export const resolveProposal = (
  id: string,
  version: number,
  proposalId: string,
  confirm: boolean,
) =>
  send(
    chatPath(
      id,
      "/proposals/" +
        encodeURIComponent(proposalId) +
        (confirm ? "/confirm" : "/reject"),
    ),
    { base_chat_version: version, ...(confirm ? { confirmed: true } : {}) },
  );
