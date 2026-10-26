import { RefinancingWorkspace } from "@/features/applications/ui/refinancing-loans";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, RefreshCw } from "lucide-react";
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
import { LumaAvatar, LumaMark } from "@/shared/ui/luma-mark";
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
import { conversationMessages } from "../model/conversation-messages";
import { pendingProposal, projectApplication } from "../model/projection";
import { useConversationScroll } from "../model/use-conversation-scroll";
import { useLumaMotion } from "../model/use-luma-motion";
import { ClarificationCard } from "./clarification-card";
import { CollectedData } from "./collected-data";
import { LumaMessageText } from "./luma-message-text";
import { AssistantWorkspace, type WorkspaceSection } from "./assistant-workspace";

export function AssistantPanel({
  applicationId,
  record,
  actions,
  onRecordUpdated,
  renderDocuments,
  onNewTask,
  startingTask = false,
}: {
  onNewTask: () => void;
  startingTask?: boolean;
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
  const motionRoot = useRef<HTMLDivElement>(null);
  const [workspaceSection, setWorkspaceSection] = useState<WorkspaceSection>(record.explorations.length ? "offers" : "data");
  const [resultNavigation, setResultNavigation] = useState<string | null>(null);
  const offersPanel = useRef<HTMLDivElement>(null);
  const panelNavigation = useRef<HTMLDivElement>(null);
  const conversationHeading = useRef<HTMLHeadingElement>(null);
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const previousPanel = useRef(mobilePanel);
  useEffect(() => {
    if (previousPanel.current !== mobilePanel && !resultNavigation && window.matchMedia?.("(max-width: 900px)").matches) {
      (mobilePanel === "conversation" ? conversationHeading : workspaceHeading).current?.focus({ preventScroll: true });
      panelNavigation.current?.scrollIntoView({ block: "start" });
    }
    previousPanel.current = mobilePanel;
  }, [mobilePanel, resultNavigation]);
  function showPanel(panel: "conversation" | "workspace") {
    setMobilePanel(panel);
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
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false),
    sendIdentity = useRef({ text: "", id: "" }),
    answerIdentity = useRef({ text: "", id: "" });
  const list = useQuery(chatQueries.list(applicationId));
  const chatId = activeChatId || list.data?.[0]?.chat_id || null;
  const chat = useQuery({
    ...chatQueries.detail(chatId || ""),
    enabled: Boolean(chatId),
  });
  useLumaMotion(motionRoot, chat.data?.chat.chat_id || null);

  function accept(view: ChatView) {
    if (pendingProposal(view)) setWorkspaceSection("data");
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
    onSuccess: (view, { confirm }) => {
      accept(view);
      if (confirm && view.record.explorations.length && !offersPanel.current?.closest(".assistant-layout")?.closest("[hidden]")) {
        setWorkspaceSection("offers");
        setMobilePanel("workspace");
        setResultNavigation(view.chat.chat_id);
      }
    },
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
  useEffect(() => {
    if (!resultNavigation || resultNavigation !== chatId || pending || !offersPanel.current) return;
    const panel = offersPanel.current;
    panel.scrollTop = 0;
    panel.focus({ preventScroll: true });
    setResultNavigation(null);
  }, [resultNavigation, chatId, pending]);
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
    startingTask ||
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
  const replying = send.isPending || answer.isPending;
  const { log, unread, onScroll, jumpToLatest } = useConversationScroll(
    chatId,
    chat.data?.chat.messages.length || 0,
    replying,
    mobilePanel === "conversation",
  );
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
    <div className="assistant-layout" ref={motionRoot} data-mobile-panel={mobilePanel}>
      <div className="assistant-mobile-navigation" ref={panelNavigation}>
        <div className="assistant-panel-switch" role="group" aria-label="Диалог и собранные данные">
          <Button variant={mobilePanel === "conversation" ? "default" : "outline"} aria-pressed={mobilePanel === "conversation"} onClick={() => showPanel("conversation")}>Диалог</Button>
          <Button variant={mobilePanel === "workspace" ? "default" : "outline"} aria-pressed={mobilePanel === "workspace"} onClick={() => showPanel("workspace")}>Данные и предложения{pending ? " · обновлены" : ""}</Button>
        </div>
      </div>
      <Card className="assistant-conversation gap-0">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="luma-conversation-heading">
              <LumaAvatar size={44} active={replying} />
              <div><h2 ref={conversationHeading} tabIndex={-1}>Лума</h2><p>Ваш финансовый ИИ-ассистент</p></div>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="assistant-icon-control"
              title="Новый диалог"
              aria-label="Новый диалог"
              disabled={busy || startingTask}
              onClick={() => editable ? create.mutate() : onNewTask()}
            >
              <Plus />
            </Button>
          </div>
          <p className="luma-conversation-intro">
            Разберёмся вместе. Вы рассказываете — я собираю данные и объясняю варианты.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {error && (
            <div
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {getErrorMessage(error)}
              {(!sendError || (sendError instanceof ApiError && sendError.status === 409)) && <Button
                size="sm"
                variant="ghost"
                disabled={busy || list.isFetching || chat.isFetching}
                onClick={async () => {
                  if (create.isError && !chatId) {
                    const refreshed = await list.refetch();
                    if (refreshed.isSuccess) {
                      if (!refreshed.data.length) create.mutate();
                      else create.reset();
                    }
                    return;
                  }
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
              </Button>}
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
            onScroll={onScroll}
            className="assistant-messages"
            role="log"
            tabIndex={0}
            aria-label="Переписка"
            aria-live="polite"
          >
            {chat.isPending && (
              <p className="text-xs text-muted-foreground">Загружаем диалог…</p>
            )}
            {!chat.data?.chat.messages.length && !outgoing && (
              <div className="luma-empty">
                <LumaAvatar size={68} />
                <h3>Начнём с вашей идеи?</h3>
                <p>Расскажите, на что нужны деньги и когда. Я помогу уточнить детали и разобраться в вариантах.</p>
                <div className="luma-starters" aria-label="Примеры задач для Лумы">{[
                  ["Закупить товар", "Нужны деньги на закупку товара."],
                  ["Дождаться выручки", "Нужно оплатить поставщику до поступления выручки."],
                ].map(([label, text]) => <button key={label} type="button" disabled={busy || !editable} onClick={() => { setMessage(text); messageBox.current?.focus(); }}>{label}</button>)}</div>
                <small>Предложения проверяете вы. Отправка заявки — после вашего подтверждения.</small>
              </div>
            )}
            {conversationMessages(chat.data?.chat.messages ?? []).map(({ message: item, clarification }) => (
              <div
                className={`assistant-message ${item.role === "user" ? "assistant-message-user" : ""}`}
                key={item.message_id}
                data-message-key={item.role === "user" ? `user:${item.request_id || item.message_id}` : `assistant:${item.message_id}`}
              >
                <p className="luma-message-author">
                  {item.role !== "user" && <LumaMark size={16} />}
                  {item.role === "user" ? "Вы" : "Лума"}
                </p>
                {clarification ? (
                  <>
                    <p className="whitespace-pre-wrap">{clarification.question}</p>
                    <p className="luma-clarification-answer">{clarification.answer}</p>
                  </>
                ) : (
                  item.role === "user" ? <p className="whitespace-pre-wrap">{item.text}</p> : <LumaMessageText text={item.text}/>
                )}
              </div>
            ))}
            {outgoing && (
              <div className="assistant-message assistant-message-user assistant-message-outgoing" data-message-key={`user:${outgoing.id}`}>
                <p className="mb-1 text-xs font-bold opacity-60">Вы</p>
                <p className="whitespace-pre-wrap">{outgoing.text}</p>
                <p className="mt-2 text-xs opacity-75">
                  {send.isPending ? "Ожидаем ответа" : "Ответ не получен"}
                </p>
              </div>
            )}
            {replying && (
              <div role="status" className="luma-thinking">
                <LumaAvatar size={26} active /><span>Лума разбирается в задаче</span><span className="luma-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
              </div>
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
          </div>
          {unread && (
            <Button variant="outline" size="sm" onClick={jumpToLatest}>
              <ArrowDown /> К новым сообщениям
            </Button>
          )}
          {sendError && send.variables && !(sendError instanceof ApiError && sendError.status === 409) && (
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
          {pending && !chat.data?.clarification && (
            <Button className="assistant-mobile-review" variant="outline" onClick={() => { setWorkspaceSection("data"); showPanel("workspace"); }}>Проверить собранные данные</Button>
          )}
          {userTurns >= limit && (
            <p className="text-sm text-muted-foreground">
              Достигнут лимит сообщений. Начните новый диалог — подтверждённые
              данные сохранятся.
            </p>
          )}
          {!editable && <div className="luma-task-state" role="status"><strong>Диалог по этой заявке завершён</strong><p>История сохранена. Для новой задачи начните отдельный подбор.</p><div><Button asChild variant="outline" size="sm"><Link to={`/cabinet?mode=applications&application=${applicationId}`}>Открыть заявку</Link></Button><Button size="sm" disabled={startingTask} onClick={onNewTask}>{startingTask ? "Создаём…" : "Новая задача с Лумой"}</Button></div></div>}
          {editable && !chat.data && <p role="status" className="text-sm text-muted-foreground">{error ? "Диалог пока недоступен. Повторите загрузку выше." : "Подключаем диалог…"}</p>}
          <form onSubmit={submit} className="assistant-composer flex items-end gap-3">
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
              placeholder="Расскажите Луме о своей задаче…"
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
        </CardContent>
      </Card>
      <AssistantWorkspace
        section={workspaceSection}
        onSectionChange={setWorkspaceSection}
        headingRef={workspaceHeading}
        offersRef={offersPanel}
        updating={busy || preview.isFetching}
        pending={Boolean(pending)}
        data={<>
        <CollectedData
          view={projected}
          proposal={pending}
          preview={preview.data}
          busy={busy || !editable}
          loading={preview.isFetching}
          nextQuestion={chat.data?.clarification?.title}
          onEdit={(changes, plan) => edit.mutate({ changes, plan })}
          expenseImport={chat.data && renderDocuments?.({ ...chat.data, record }, accept)}
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
        {!pending && record.application.need.preferred_product === "refinancing" && <RefinancingWorkspace view={record} busy={busy || !editable} onSave={actions.save} onExplore={() => { setWorkspaceSection("offers"); actions.explore("refinancing", {}); }} />}
        {!pending && record.explorations.length > 0 && (
          <FinancialSupplement
            key={`${applicationId}:${record.application.application_version}`}
            view={record}
            busy={busy || !editable}
            onSave={actions.save}
          />
        )}
        </>}
        footer={pending && <>
            {chat.data?.clarification && <p>Ответьте Луме на оставшийся вопрос. Затем можно проверить запрос и подобрать условия.</p>}
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
              Подтвердить запрос и подобрать
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
        </>}
        offers={<>
        {pending ? (
          <div className="assistant-workspace-empty">
            <h3>Сначала проверим данные</h3>
            <p>Есть неподтверждённые изменения. Уточните суммы и даты — после подтверждения здесь появится актуальное сравнение.</p>
            <Button variant="outline" onClick={() => setWorkspaceSection("data")}>Проверить изменения</Button>
          </div>
        ) : !record.explorations.length && (
          <div className="assistant-workspace-empty">
            <h3>Подберём условия под вашу задачу</h3>
            <p>Расскажите Луме о планах и подтвердите собранные данные. Здесь можно будет сравнить платёж, срок и стоимость финансирования.</p>
            <Button variant="outline" onClick={() => setWorkspaceSection("data")}>Посмотреть данные</Button>
          </div>
        )}
        {!pending && record.explorations.length > 0 && (
          <ExplorationPanel
            key={record.application.application_id}
            compact
            focused
            view={record}
            onEditNeed={() => { setWorkspaceSection("data"); setMobilePanel("conversation"); requestAnimationFrame(() => messageBox.current?.focus({preventScroll:true})); }}
            busy={busy || !editable}
            onExplore={actions.explore}
            onSavePlan={(plan) =>
              actions.save({ "product_details.overdraft": plan })
            }
            onApply={actions.apply}
          />
        )}
        </>}
      />
    </div>
  );
}
