import { z } from "zod";
import { applicationViewSchema } from "@/features/applications";
import { apiRequest } from "@/shared/api/client";

export const proposalSchema = z
  .object({
    proposal_id: z.string(),
    status: z.string(),
    changes: z.record(z.string(), z.unknown()),
    conflicts: z.array(z.unknown()).optional(),
    plan_issues: z.array(z.unknown()).optional(),
  })
  .passthrough();

const clarificationSchema = z.object({
  question_id: z.string(),
  field: z.string(),
  title: z.string(),
  input_type: z.enum(["money", "date"]).nullable(),
  transaction_id: z.string().nullable().optional(),
  direction: z.enum(["inflow", "outflow"]).nullable().optional(),
  choices: z.array(z.object({ choice_id: z.string(), label: z.string() })),
});

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
    clarification: clarificationSchema.nullable().optional(),
  })
  .passthrough();

export const chatListSchema = z.array(
  z.object({ chat_id: z.string(), created_at: z.string() }),
);
export type ChatView = z.infer<typeof chatViewSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Clarification = z.infer<typeof clarificationSchema>;

const explorationResultSchema =
  applicationViewSchema.shape.explorations.element.shape.result;
export const previewSchema = z.object({
  proposal_id: z.string(),
  chat_version: z.number(),
  application_version: z.number(),
  confirmed: z.literal(false),
  issues: z.array(z.unknown()),
  result: explorationResultSchema,
});
export type ProposalPreview = z.infer<typeof previewSchema>;

const chatPath = (id: string, suffix = ""): `/${string}` =>
  `/chats/${encodeURIComponent(id)}${suffix}`;
const send = (url: `/${string}`, body: Record<string, unknown>) =>
  apiRequest(url, chatViewSchema, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 195_000,
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

export const previewProposal = (
  id: string,
  version: number,
  proposalId: string,
  signal?: AbortSignal,
) =>
  apiRequest(
    chatPath(id, "/proposals/" + encodeURIComponent(proposalId) + "/preview"),
    previewSchema,
    {
      method: "POST",
      body: JSON.stringify({ base_chat_version: version }),
      signal,
    },
  );

export const answerClarification = (
  view: ChatView,
  questionId: string,
  requestId: string,
  answer: { choice_id: string } | { value: string },
) =>
  send(
    chatPath(
      view.chat.chat_id,
      "/clarifications/" + encodeURIComponent(questionId) + "/answer",
    ),
    {
      base_chat_version: view.chat.chat_version,
      base_application_version: view.record.application.application_version,
      request_id: requestId,
      ...answer,
    },
  );

export const editProposal = (
  view: ChatView,
  proposalId: string,
  changes: Record<string, unknown>,
  overdraftPlan?: Record<string, unknown>,
) =>
  send(
    chatPath(
      view.chat.chat_id,
      "/proposals/" + encodeURIComponent(proposalId) + "/edit",
    ),
    {
      base_chat_version: view.chat.chat_version,
      base_application_version: view.record.application.application_version,
      changes,
      ...(overdraftPlan ? { overdraft_plan: overdraftPlan } : {}),
    },
  );
