import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import {
  applicationKeys,
  normalizeMoneyInput,
  type ApplicationView,
} from "@/features/applications";
import {
  chatKeys,
  pendingProposal,
  projectApplication,
  type ChatView,
} from "@/features/assistant";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoney } from "@/shared/lib/format";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import {
  documentsSchema,
  invoiceFileUrl,
  uploadInvoice,
  applyInvoiceData,
  type Invoice,
  type InvoiceTarget,
  type InvoiceValues,
} from "./api";

export function InvoicePanel({
  view,
  chat,
  onUpdated,
  onChatUpdated,
  onUsed,
  readOnly = false,
}: {
  view: ApplicationView;
  chat?: ChatView;
  onUpdated: (view: ApplicationView) => void;
  onChatUpdated?: (view: ChatView) => void;
  onUsed?: (target: InvoiceTarget) => void;
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const parsed = documentsSchema.safeParse(view.documents || []);
  const projected = projectApplication(view, pendingProposal(chat));
  const editable =
    !readOnly &&
    !["cancelled", "disbursed", "limit_opened"].includes(view.state.status);
  function recover(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      void queryClient.invalidateQueries({
        queryKey: applicationKeys.detail(view.application.application_id),
      });
      if (chat)
        void queryClient.invalidateQueries({
          queryKey: chatKeys.detail(chat.chat.chat_id),
        });
    }
  }
  const upload = useMutation({
    mutationFn: (file: File) => uploadInvoice(view, file),
    onSuccess: onUpdated,
    onError: recover,
  });
  const use = useMutation({
    mutationFn: ({
      invoice,
      values,
    }: {
      invoice: Invoice;
      values: InvoiceValues;
    }) => applyInvoiceData(view, invoice, values, chat),
    onSuccess: (result, request) => {
      if (result.kind === "chat") {
        onChatUpdated?.(result.view);
        onUpdated(result.view.record);
      } else onUpdated(result.view);
      onUsed?.(request.values.target);
    },
    onError: recover,
  });
  const error = upload.error || use.error;
  const busy = upload.isPending || use.isPending;
  if (view.application.need.preferred_product === "refinancing" && !readOnly) return null;
  return (
    <section
      className="invoice-panel rounded-2xl border border-border bg-card p-4"
      aria-label="Счета поставщиков"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">{readOnly ? "Счёт поставщика" : "Есть счёт на оплату?"}</h3>
          {!readOnly && <p className="mt-2 max-w-xl text-sm text-muted-foreground">Сумма и дата оплаты появятся в будущих расходах. Нехватку денег рассчитаем по банковскому остатку и другим операциям.</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Необязательно · текстовый PDF, до 2 МБ и 8 страниц
          </p>
        </div>
        {editable && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-ring">
            <FileUp className="size-4 text-primary" />
            {upload.isPending ? "Читаем счёт…" : "Загрузить счёт"}
            <input
              aria-label="Загрузить счёт PDF"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload.mutate(file);
                event.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {Boolean(error) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error instanceof Error ? error.message : getErrorMessage(error)}
        </p>
      )}
      {!parsed.success && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Не удалось прочитать карточки документов. Обновите заявку.
        </p>
      )}
      {parsed.success &&
        parsed.data.map((invoice) => (
          <InvoiceCard
            key={`${invoice.document_id}:${invoice.revision}`}
            view={projected}
            invoice={invoice}
            disabled={busy || !editable}
            readOnly={readOnly}
            onUse={(values) => use.mutate({ invoice, values })}
          />
        ))}
    </section>
  );
}

function uniqueValue(candidates: Invoice["extracted"]["amount"]) {
  const values = [...new Set(candidates.map((item) => item.value))];
  return values.length === 1 ? values[0] : "";
}

function InvoiceCard({
  view,
  invoice,
  disabled,
  onUse,
  readOnly,
}: {
  view: ApplicationView;
  invoice: Invoice;
  disabled: boolean;
  onUse: (values: InvoiceValues) => void;
  readOnly: boolean;
}) {
  const need = view.application.need;
  const plan = view.application.product_details?.overdraft;
  const expenses =
    plan &&
    typeof plan === "object" &&
    "transactions" in plan &&
    Array.isArray(plan.transactions)
      ? plan.transactions.filter(
          (
            row,
          ): row is {
            transaction_id: string;
            amount: string | null;
            date: string | null;
          } =>
            row?.direction === "outflow" &&
            typeof row.transaction_id === "string",
        )
      : [];
  const [draft, setDraft] = useSavedDraft(
    `delo-invoice-expense:${invoice.document_id}:${invoice.revision}`,
    {
      amount: invoice.values?.amount || uniqueValue(invoice.extracted.amount),
      dueDate:
        invoice.values?.due_date || uniqueValue(invoice.extracted.due_date),
      target: (!need.purpose || need.purpose === "working_capital"
        ? "planned_expense"
        : "evidence") as InvoiceTarget,
      transactionId: expenses.length === 1 ? expenses[0].transaction_id : "",
      replace: false,
    },
  );
  const [page, setPage] = useState<number | null>(null),
    [error, setError] = useState("");
  const operation = expenses.find(
    (row) => row.transaction_id === draft.transactionId,
  );
  let normalized: string | null = null;
  try {
    normalized = normalizeMoneyInput(draft.amount);
  } catch {
    /* Validated before submission. */
  }
  const conflict =
    draft.target === "planned_expense" &&
        Boolean(
          operation &&
            ((operation.amount != null && normalized !== operation.amount) ||
              (operation.date != null && draft.dueDate !== operation.date)),
        );
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const amount = normalizeMoneyInput(draft.amount);
      if (!amount) throw new Error("Укажите итоговую сумму счёта.");
      if (draft.target === "planned_expense" && !draft.dueDate)
        throw new Error("Укажите дату будущей оплаты.");
      if (conflict && !draft.replace)
        throw new Error(
          "Подтвердите замену отличающихся значений или выберите сохранение счёта без изменения данных.",
        );
      onUse({
        amount,
        due_date: draft.dueDate || null,
        target: draft.target,
        replace_existing: draft.replace,
        ...(draft.target === "planned_expense" && draft.transactionId
          ? { transaction_id: draft.transactionId }
          : {}),
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте значения.");
    }
  }
  return (
    <details
      id={`document-${invoice.document_id}`}
      className="mt-4 rounded-xl border border-border bg-background p-4"
      open={invoice.status === "extracted"}
    >
      <summary className="cursor-pointer text-sm font-bold">
        {invoice.filename} ·{" "}
        {invoice.status === "reviewed" ? "проверен" : "проверьте данные"}
      </summary>
      {readOnly ? (
        <p className="mt-3 text-sm">
          {invoice.values?.amount
            ? formatMoney(invoice.values.amount)
            : "Сумма не проверена"}
          {invoice.values?.due_date
            ? ` · оплатить до ${new Date(invoice.values.due_date + "T12:00:00").toLocaleDateString("ru-RU")}`
            : ""}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <fieldset disabled={disabled} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id={`invoice-amount-${invoice.document_id}`}
                label="Итого по счёту, ₽"
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    amount: event.target.value,
                    replace: false,
                  }))
                }
              />
              <FormField
                id={`invoice-date-${invoice.document_id}`}
                label="Оплатить до"
                type="date"
                value={draft.dueDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                    replace: false,
                  }))
                }
              />
            </div>
            {!uniqueValue(invoice.extracted.amount) && (
              <p className="text-xs text-muted-foreground">
                {invoice.extracted.amount.length
                  ? "В документе несколько итоговых сумм. Выберите нужную или укажите свою."
                  : "Итоговую сумму не удалось выделить. Укажите её после проверки документа."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {invoice.extracted.amount.map((source, index) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  key={index}
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      amount: source.value,
                      replace: false,
                    }));
                    setPage(source.page);
                  }}
                >
                  {formatMoney(source.value)} · стр. {source.page}
                </Button>
              ))}
            </div>
            <label className="grid gap-2 text-xs font-semibold">
              Как использовать счёт
              <select
                aria-label="Как использовать счёт"
                className="rounded-xl border border-border bg-background p-3 text-sm"
                value={draft.target}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    target: event.target.value as InvoiceTarget,
                    replace: false,
                  }))
                }
              >
                {(!need.purpose || need.purpose === "working_capital") && <option value="planned_expense">
                  Добавить предстоящую оплату
                </option>}
                <option value="evidence">
                  Сохранить как подтверждение покупки
                </option>
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              Сумма счёта — предстоящий расход, а не сумма кредита. Запрошенная сумма и банковские показатели не изменятся.
            </p>
            {draft.target === "planned_expense" && expenses.length > 0 && (
              <label className="grid gap-2 text-xs font-semibold">
                С какой оплатой сравниваем
                <select
                  aria-label="Связать счёт с оплатой"
                  className="rounded-xl border border-border bg-background p-3 text-sm"
                  value={draft.transactionId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      transactionId: event.target.value,
                      replace: false,
                    }))
                  }
                >
                  <option value="">Добавить отдельный расход</option>
                  {expenses.map((row) => (
                    <option key={row.transaction_id} value={row.transaction_id}>
                      {row.amount
                        ? formatMoney(row.amount)
                        : "Сумма уточняется"}{" "}
                      · {row.date || "дата уточняется"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {conflict && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
                <p>
                  {`Оплата в плане: ${operation?.amount ? formatMoney(operation.amount) : "сумма не указана"}, ${operation?.date || "дата не указана"}. По счёту: ${normalized ? formatMoney(normalized) : "сумма не указана"}, ${draft.dueDate || "дата не указана"}. Выберите, какие данные оставить.`}
                </p>
                <label className="mt-3 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={draft.replace}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        replace: event.target.checked,
                      }))
                    }
                  />
                  Заменить отличающиеся значения проверенными данными счёта
                </label>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={disabled || Boolean(conflict && !draft.replace)}
            >
              {draft.target === "evidence"
                ? "Подтвердить счёт"
                : "Учесть оплату счёта"}
            </Button>
          </fieldset>
        </form>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          className="font-semibold text-primary underline"
          onClick={() =>
            setPage(
              page === null ? invoice.extracted.amount[0]?.page || 1 : null,
            )
          }
        >
          {page === null ? "Показать источник" : "Скрыть источник"}
        </button>
        <a
          className="font-semibold text-primary underline"
          href={invoiceFileUrl(
            view.application.application_id,
            invoice.document_id,
          )}
        >
          Скачать оригинал
        </a>
      </div>
      {page !== null && (
        <div className="mt-3">
          <label className="text-xs">
            Страница{" "}
            <select
              aria-label="Страница источника"
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {invoice.pages.map((item) => (
                <option key={item.page} value={item.page}>
                  {item.page}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 max-h-64 overflow-auto rounded-xl bg-card p-3 font-mono text-xs leading-6">
            {invoice.pages
              .find((item) => item.page === page)
              ?.text.split("\n")
              .map((line, index) => (
                <div
                  key={index}
                  className={
                    Object.values(invoice.extracted)
                      .flat()
                      .some(
                        (source) =>
                          source.page === page && source.line === index + 1,
                      )
                      ? "bg-primary/15 font-bold"
                      : ""
                  }
                >
                  <span className="mr-3 select-none text-muted-foreground">
                    {index + 1}
                  </span>
                  {line}
                </div>
              ))}
          </div>
        </div>
      )}
    </details>
  );
}
