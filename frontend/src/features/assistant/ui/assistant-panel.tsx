import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, MessageCircle, Plus, RefreshCw } from "lucide-react";
import {
  applicationKeys,
  ExplorationPanel,
  FinancialSupplement,
  type ApplicationActions,
  type ApplicationView,
} from "@/features/applications";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { Textarea } from "@/shared/ui/textarea";
import {
  answerClarification,
  createChat,
  editProposal,
  previewProposal,
  resolveProposal,
  sendMessage,
  type ChatView,
} from "../api/chat";
import { chatKeys, chatQueries } from "../model/queries";
import { pendingProposal, projectApplication } from "../model/projection";
import { ClarificationCard } from "./clarification-card";
import { CollectedData } from "./collected-data";

export function AssistantPanel({
  applicationId,
  record,
  actions,
  onRecordUpdated,
  renderDocuments,
}: {
  applicationId: string;
  record: ApplicationView;
  actions: ApplicationActions;
  onRecordUpdated: (view: ApplicationView) => void;
  renderDocuments?: (
    chat: ChatView,
    onUpdated: (chat: ChatView) => void,
  ) => ReactNode;
}) {
  const [mobilePanel, setMobilePanel] = useState<"conversation" | "workspace">("conversation");
  const panelNavigation = useRef<HTMLDivElement>(null);
  function showPanel(panel: "conversation" | "workspace") {
    setMobilePanel(panel);
    if (window.matchMedia?.("(max-width: 900px)").matches)
      panelNavigation.current?.scrollIntoView({ block: "start" });
  }
  const queryClient = useQueryClient();
  const [activeChatId, setActiveChatId] = useSavedDraft<string | null>(
    `delo-chat:${applicationId}`,
    null,
  );
  const [message, setMessage] = useSavedDraft(
    `delo-message:${applicationId}`,
    "",
  );
  const messageBox = useRef<HTMLTextAreaElement>(null),
    log = useRef<HTMLDivElement>(null);
  const initialized = useRef(false),
    sendIdentity = useRef({ text: "", id: "" }),
    answerIdentity = useRef({ text: "", id: "" });
  const list = useQuery(chatQueries.list(applicationId));
  const chatId = activeChatId || list.data?.[0]?.chat_id || null;
  const chat = useQuery({
    ...chatQueries.detail(chatId || ""),
    enabled: Boolean(chatId),
  });

  function accept(view: ChatView) {
    queryClient.setQueryData(chatKeys.detail(view.chat.chat_id), view);
    void queryClient.invalidateQueries({
      queryKey: chatKeys.list(applicationId),
    });
    onRecordUpdated(view.record);
    setActiveChatId(view.chat.chat_id);
  }
  function recover(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({
        queryKey: applicationKeys.detail(applicationId),
      });
      if (chatId)
        void queryClient.invalidateQueries({
          queryKey: chatKeys.detail(chatId),
        });
    }
  }
  const create = useMutation({
    mutationFn: () => createChat(applicationId),
    onSuccess: accept,
  });
  useEffect(() => {
    if (list.data && !chatId && !initialized.current) {
      initialized.current = true;
      create.mutate();
    }
  }, [list.data, chatId, create]);
  useEffect(() => {
    if (
      chat.data &&
      chat.data.record.application.application_version <
        record.application.application_version
    )
      void queryClient.invalidateQueries({
        queryKey: chatKeys.detail(chat.data.chat.chat_id),
      });
  }, [record.application.application_version, chat.data, queryClient]);
  const send = useMutation({
    mutationFn: ({
      text,
      id,
      chatId,
      version,
    }: {
      text: string;
      id: string;
      chatId: string;
      version: number;
    }) => sendMessage(chatId, version, id, text),
    onMutate: (sent) => {
      setMessage((current) => (current.trim() === sent.text ? "" : current));
    },
    onSuccess: (view, sent) => {
      accept(view);
      setMessage((current) => (current.trim() === sent.text ? "" : current));
      sendIdentity.current = { text: "", id: "" };
    },
    onError: (error, sent) => {
      setMessage((current) => (current.trim() ? current : sent.text));
      recover(error);
    },
  });
  const resolve = useMutation({
    mutationFn: ({ id, confirm }: { id: string; confirm: boolean }) => {
      if (!chat.data) throw new Error("Диалог не загружен.");
      return resolveProposal(
        chat.data.chat.chat_id,
        chat.data.chat.chat_version,
        id,
        confirm,
      );
    },
    onSuccess: accept,
    onError: recover,
  });
  const answer = useMutation({
    mutationFn: (value: { choice_id: string } | { value: string }) => {
      if (!chat.data?.clarification) throw new Error("Обновите вопрос.");
      const identity = JSON.stringify([
        chat.data.clarification.question_id,
        value,
      ]);
      if (answerIdentity.current.text !== identity)
        answerIdentity.current = { text: identity, id: crypto.randomUUID() };
      return answerClarification(
        chat.data,
        chat.data.clarification.question_id,
        answerIdentity.current.id,
        value,
      );
    },
    onSuccess: (view) => {
      accept(view);
      answerIdentity.current = { text: "", id: "" };
    },
    onError: recover,
  });
  const pending = pendingProposal(chat.data);
  const edit = useMutation({
    mutationFn: ({
      changes,
      plan,
    }: {
      changes: Record<string, unknown>;
      plan?: Record<string, unknown>;
    }) => {
      if (!chat.data || !pending) throw new Error("Черновик не загружен.");
      const fields = { ...pending.changes, ...changes };
      delete fields["product_details.overdraft"];
      return editProposal(chat.data, pending.proposal_id, fields, plan);
    },
    onSuccess: accept,
    onError: recover,
  });
  const preview = useQuery({
    queryKey: [
      "proposal-preview",
      chatId,
      pending?.proposal_id,
      chat.data?.chat.chat_version,
      record.application.application_version,
    ],
    queryFn: ({ signal }) =>
      previewProposal(
        chatId!,
        chat.data!.chat.chat_version,
        pending!.proposal_id,
        signal,
      ),
    enabled: Boolean(chatId && pending && !pending.conflicts?.length),
  });
  const busy =
    create.isPending ||
    send.isPending ||
    resolve.isPending ||
    answer.isPending ||
    edit.isPending;
  const editable = !["cancelled", "disbursed", "limit_opened"].includes(
    record.state.status,
  );
  const sendError = send.variables?.chatId === chatId ? send.error : null;
  const error =
    create.error ||
    sendError ||
    resolve.error ||
    answer.error ||
    edit.error ||
    chat.error ||
    list.error;
  const projected = projectApplication(record, pending);
  const userTurns =
    chat.data?.chat.messages.filter((item) => item.role === "user").length || 0;
  const limit = chat.data?.assistant.max_turns || 40;
  const outgoing =
    send.variables?.chatId === chatId &&
    (send.isPending || send.isError) &&
    !chat.data?.chat.messages.some(
      (item) => item.request_id === send.variables?.id,
    )
      ? send.variables
      : null;
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.data?.chat.chat_version, send.isPending]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy || !editable || !chat.data || userTurns >= limit) return;
    if (sendIdentity.current.text !== text)
      sendIdentity.current = { text, id: crypto.randomUUID() };
    send.mutate({
      text,
      id: sendIdentity.current.id,
      chatId: chat.data.chat.chat_id,
      version: chat.data.chat.chat_version,
    });
  }
  return (
    <div className="assistant-layout" data-mobile-panel={mobilePanel}>
      <div className="assistant-mobile-navigation" ref={panelNavigation}>
        <div className="assistant-panel-switch" role="group" aria-label="Диалог и собранные данные">
          <Button variant={mobilePanel === "conversation" ? "default" : "outline"} aria-pressed={mobilePanel === "conversation"} onClick={() => showPanel("conversation")}>Диалог</Button>
          <Button variant={mobilePanel === "workspace" ? "default" : "outline"} aria-pressed={mobilePanel === "workspace"} onClick={() => showPanel("workspace")}>Данные и предложения{pending ? " · обновлены" : ""}</Button>
        </div>
      </div>
      <Card className="assistant-conversation gap-0">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xl font-extrabold">
              <MessageCircle className="text-primary" /> Ассистент
            </h2>
            <Button
              variant="outline"
              size="icon"
              className="assistant-icon-control"
              title="Новый диалог"
              aria-label="Новый диалог"
              disabled={busy || !editable}
              onClick={() => create.mutate()}
            >
              <Plus />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Рассказывайте о задаче — кабинет собирает данные рядом.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {getErrorMessage(error)}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void chat.refetch();
                  void list.refetch();
                  create.reset();
                  send.reset();
                  answer.reset();
                  edit.reset();
                  resolve.reset();
                }}
              >
                <RefreshCw />
                Обновить
              </Button>
            </div>
          )}
          {chat.data?.assistant.mode === "demo" && (
            <p className="text-xs text-muted-foreground">
              Демонстрационный диалог
            </p>
          )}
          {list.data && list.data.length > 1 && (
            <select
              aria-label="История диалогов"
              className="rounded-xl border border-border bg-background p-2 text-xs"
              disabled={busy}
              value={chatId || ""}
              onChange={(event) => setActiveChatId(event.target.value)}
            >
              {list.data.map((item) => (
                <option value={item.chat_id} key={item.chat_id}>
                  {new Date(item.created_at).toLocaleString("ru-RU")}
                </option>
              ))}
            </select>
          )}
          <div
            ref={log}
            className="assistant-messages"
            role="log"
            aria-label="Переписка"
            aria-live="polite"
          >
            {chat.isFetching && (
              <p className="text-xs text-muted-foreground">Загружаем диалог…</p>
            )}
            {!chat.data?.chat.messages.length && !outgoing && (
              <p className="m-auto max-w-64 text-center text-sm text-muted-foreground">
                Например: «Завтра нужно заплатить поставщику 450 тысяч. Через
                неделю покупатель перечислит 500 тысяч».
              </p>
            )}
            {chat.data?.chat.messages.map((item) => (
              <div
                className={`assistant-message ${item.role === "user" ? "assistant-message-user" : ""}`}
                key={item.message_id}
              >
                <p className="mb-1 text-xs font-bold opacity-60">
                  {item.role === "user" ? "Вы" : "Ассистент"}
                </p>
                <p className="whitespace-pre-wrap">{item.text}</p>
              </div>
            ))}
            {outgoing && (
              <div className="assistant-message assistant-message-user assistant-message-outgoing">
                <p className="mb-1 text-xs font-bold opacity-60">Вы</p>
                <p className="whitespace-pre-wrap">{outgoing.text}</p>
                <p className="mt-2 text-xs opacity-75">
                  {send.isPending ? "Ожидаем ответа" : "Ответ не получен"}
                </p>
              </div>
            )}
            {send.isPending && (
              <p role="status" className="text-sm text-primary">
                Собираем данные и готовим ответ…
              </p>
            )}
          </div>
          {sendError && send.variables && (
            <Button
              variant="outline"
              disabled={
                busy ||
                !editable ||
                (sendError instanceof ApiError && sendError.status === 409)
              }
              onClick={() => send.mutate(send.variables!)}
            >
              <RefreshCw />
              Повторить запрос
            </Button>
          )}
          {chat.data?.clarification && editable && (
            <ClarificationCard
              key={chat.data.clarification.question_id}
              card={chat.data.clarification}
              busy={busy || userTurns >= limit}
              onAnswer={(value) => answer.mutate(value)}
              onFreeText={() => messageBox.current?.focus()}
            />
          )}
          {pending && !chat.data?.clarification && (
            <Button className="assistant-mobile-review" variant="outline" onClick={() => showPanel("workspace")}>Проверить собранные данные</Button>
          )}
          {userTurns >= limit && (
            <p className="text-sm text-muted-foreground">
              Достигнут лимит сообщений. Начните новый диалог — подтверждённые
              данные сохранятся.
            </p>
          )}
          <form onSubmit={submit} className="flex items-end gap-2">
            <Textarea
              ref={messageBox}
              aria-label="Сообщение ассистенту"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={8000}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Расскажите о задаче…"
              className="min-h-20 resize-none"
              disabled={!editable}
            />
            <Button
              type="submit"
              size="icon"
              className="assistant-icon-control"
              aria-label="Отправить сообщение"
              disabled={
                busy ||
                !message.trim() ||
                !editable ||
                !chat.data ||
                userTurns >= limit
              }
            >
              <ArrowUp />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Enter — отправить · Shift + Enter — новая строка
          </p>
        </CardContent>
      </Card>
      <div className="assistant-working-area space-y-5">
        <CollectedData
          view={projected}
          proposal={pending}
          preview={preview.data}
          busy={busy || !editable}
          loading={preview.isFetching}
          onEdit={(changes, plan) => edit.mutate({ changes, plan })}
        />
        {preview.error && (
          <p role="alert" className="text-sm text-destructive">
            {getErrorMessage(preview.error)}{" "}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void preview.refetch()}
            >
              Обновить расчёт
            </Button>
          </p>
        )}
        {pending && (
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                busy ||
                !editable ||
                Boolean(chat.data?.clarification) ||
                Boolean(pending.conflicts?.length) ||
                Boolean(pending.plan_issues?.length)
              }
              onClick={() =>
                resolve.mutate({ id: pending.proposal_id, confirm: true })
              }
            >
              Подтвердить данные и подобрать
            </Button>
            <Button
              variant="outline"
              disabled={busy || !editable}
              onClick={() =>
                resolve.mutate({ id: pending.proposal_id, confirm: false })
              }
            >
              Отклонить изменения
            </Button>
          </div>
        )}
        {!pending && record.explorations.length > 0 && (
          <FinancialSupplement
            key={`${applicationId}:${record.application.application_version}`}
            view={record}
            busy={busy || !editable}
            onSave={actions.save}
          />
        )}
        {!pending && record.explorations.length > 0 && (
          <ExplorationPanel
            key={record.application.application_id}
            compact
            view={record}
            busy={busy || !editable}
            onExplore={actions.explore}
            onSavePlan={(plan) =>
              actions.save({ "product_details.overdraft": plan })
            }
            onApply={actions.apply}
          />
        )}
        {chat.data && renderDocuments?.({ ...chat.data, record }, accept)}
      </div>
    </div>
  );
}
