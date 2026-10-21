import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, MessageCircle, Plus, RefreshCw } from "lucide-react";
import { applicationKeys, type ApplicationView } from "@/features/applications";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader } from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { Textarea } from "@/shared/ui/textarea";
import {
  createChat,
  resolveProposal,
  sendMessage,
  type ChatView,
} from "../api/chat";
import { chatKeys, chatQueries } from "../model/queries";

const fieldNames: Record<string, string> = {
  "need.requested_amount": "Сумма",
  "need.term_months": "Срок",
  "need.purpose": "Цель",
  "need.financing_pattern": "Порядок возврата",
  "need.preferred_product": "Продукт",
};

export function AssistantPanel({
  applicationId,
  onRecordUpdated,
}: {
  applicationId: string;
  onRecordUpdated: (view: ApplicationView) => void;
}) {
  const queryClient = useQueryClient();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const list = useQuery(chatQueries.list(applicationId));
  const chatId = activeChatId || list.data?.[0]?.chat_id || null;
  const chat = useQuery({
    ...chatQueries.detail(chatId || ""),
    enabled: Boolean(chatId),
  });

  function accept(view: ChatView) {
    queryClient.setQueryData(chatKeys.detail(view.chat.chat_id), view);
    queryClient.invalidateQueries({ queryKey: chatKeys.list(applicationId) });
    onRecordUpdated(view.record);
    setActiveChatId(view.chat.chat_id);
  }

  function recover(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({
        queryKey: applicationKeys.detail(applicationId),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.list(applicationId),
      });
    }
    if (chatId)
      void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
  }

  const create = useMutation({
    mutationFn: () => createChat(applicationId),
    onSuccess: accept,
  });
  const send = useMutation({
    mutationFn: async ({ text, id }: { text: string; id: string }) => {
      let current = chat.data;
      if (!current) {
        current = await createChat(applicationId);
        accept(current);
      }
      return sendMessage(
        current.chat.chat_id,
        current.chat.chat_version,
        id,
        text,
      );
    },
    onSuccess: (view) => {
      accept(view);
      setMessage("");
      setRequestId(null);
    },
    onError: recover,
  });
  const resolve = useMutation({
    mutationFn: ({
      proposalId,
      confirm,
    }: {
      proposalId: string;
      confirm: boolean;
    }) => {
      if (!chat.data) throw new Error("Диалог не загружен.");
      return resolveProposal(
        chat.data.chat.chat_id,
        chat.data.chat.chat_version,
        proposalId,
        confirm,
      );
    },
    onSuccess: accept,
    onError: recover,
  });

  const busy = create.isPending || send.isPending || resolve.isPending;
  const error =
    create.error || send.error || resolve.error || chat.error || list.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    const id = requestId || crypto.randomUUID();
    setRequestId(id);
    send.mutate({ text, id });
  }

  return (
    <Card className="gap-0 border border-border bg-background lg:sticky lg:top-5">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <MessageCircle className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                Помощник
              </p>
              <h3 className="text-xl font-extrabold tracking-tight">
                Ассистент
              </h3>
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Новый диалог"
            title="Новый диалог"
            disabled={busy}
            onClick={() => create.mutate()}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Предложенные изменения появятся здесь и попадут в заявку только после
          подтверждения.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {chat.data && (
          <p className="rounded-xl bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">
            {chat.data.assistant.mode === "demo"
              ? "Демонстрационный режим"
              : "Подключена модель"}
          </p>
        )}
        {list.data && list.data.length > 1 && (
          <select
            aria-label="История диалогов"
            value={chatId || ""}
            onChange={(event) => setActiveChatId(event.target.value)}
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-xs"
          >
            <option value="">Выберите диалог</option>
            {list.data.map((item, index) => (
              <option key={item.chat_id} value={item.chat_id}>
                Диалог {list.data.length - index} ·{" "}
                {new Date(item.created_at).toLocaleDateString("ru-RU")}
              </option>
            ))}
          </select>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive"
          >
            <p>{getErrorMessage(error)}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => {
                void chat.refetch();
                void list.refetch();
              }}
            >
              <RefreshCw aria-hidden="true" />
              Обновить
            </Button>
          </div>
        )}
        <div
          className="flex max-h-[430px] min-h-52 flex-col gap-4 overflow-y-auto rounded-[20px] bg-card/70 p-4"
          role="log"
          aria-label="Переписка"
          aria-live="polite"
        >
          {chat.isPending && chatId && (
            <p className="text-xs text-muted-foreground">Загружаем историю…</p>
          )}
          {(!chat.data || chat.data.chat.messages.length === 0) && (
            <div className="m-auto max-w-56 text-center text-xs leading-relaxed text-muted-foreground">
              <MessageCircle className="mx-auto mb-3 size-7 text-primary" />
              Расскажите, для чего нужны деньги, или начните с примера.
            </div>
          )}
          {chat.data?.chat.messages.map((item) => (
            <div
              key={item.message_id}
              className={
                item.role === "user"
                  ? "ml-7 rounded-2xl rounded-br-sm bg-foreground px-4 py-3 text-xs leading-relaxed text-background"
                  : "mr-4 rounded-2xl rounded-bl-sm bg-background px-4 py-3 text-xs leading-relaxed text-foreground shadow-sm"
              }
            >
              <p className="mb-1 text-[10px] font-bold opacity-60">
                {item.role === "user" ? "Вы" : "Ассистент"}
              </p>
              <p className="whitespace-pre-wrap">{item.text}</p>
              {item.proposal && item.proposal.status === "pending" && (
                <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-foreground">
                  <p className="font-bold">Предложено изменить заявку</p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {Object.entries(item.proposal.changes).map(
                      ([field, value]) => (
                        <li key={field}>
                          <span className="text-muted-foreground">
                            {fieldNames[field] || field}:
                          </span>{" "}
                          {String(value)}
                        </li>
                      ),
                    )}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ConfirmAction
                      label="Применить"
                      title="Применить изменения?"
                      description="Подтверждённые поля будут сохранены в новой версии заявки. Проверьте значения в карточке перед продолжением."
                      confirmLabel="Применить"
                      disabled={busy}
                      onConfirm={() =>
                        resolve.mutate({
                          proposalId: item.proposal!.proposal_id,
                          confirm: true,
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        resolve.mutate({
                          proposalId: item.proposal!.proposal_id,
                          confirm: false,
                        })
                      }
                    >
                      Не применять
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {send.isPending && (
            <p role="status" className="text-xs text-muted-foreground">
              Ассистент готовит ответ…
            </p>
          )}
        </div>
        {chat.data?.assistant.mode === "demo" && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setMessage("Нужно 500 000 ₽ на закупку на 12 месяцев");
                setRequestId(null);
              }}
            >
              500 тысяч на закупку
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setMessage("Лучше на 18 месяцев");
                setRequestId(null);
              }}
            >
              Изменить срок
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <label htmlFor="assistant-message" className="sr-only">
            Сообщение ассистенту
          </label>
          <Textarea
            id="assistant-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setRequestId(null);
            }}
            maxLength={8000}
            placeholder="Расскажите, на что нужны деньги…"
            className="min-h-24 rounded-2xl bg-background"
          />
          <Button
            type="submit"
            disabled={busy || !message.trim()}
            className="w-full"
          >
            Отправить
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
