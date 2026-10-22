import { z } from "zod";
import {
  applicationViewSchema,
  type ApplicationView,
} from "@/features/applications";
import { chatViewSchema, type ChatView } from "@/features/assistant";
import { apiRequest, apiUrl } from "@/shared/api/client";

const candidate = z.object({
  value: z.string(),
  page: z.number(),
  line: z.number(),
  quote: z.string(),
});
export const documentsSchema = z.array(
  z.object({
    document_id: z.string(),
    filename: z.string(),
    revision: z.number(),
    status: z.string(),
    pages: z.array(z.object({ page: z.number(), text: z.string() })),
    extracted: z.object({
      amount: z.array(candidate),
      due_date: z.array(candidate),
    }),
    values: z
      .object({ amount: z.string(), due_date: z.string().nullable() })
      .nullable(),
    last_use: z
      .object({ target: z.string(), transaction_id: z.string().nullable() })
      .optional(),
  }),
);
export type Invoice = z.infer<typeof documentsSchema>[number];
export type InvoiceTarget = "loan_amount" | "planned_expense" | "evidence";
export type InvoiceValues = {
  amount: string;
  due_date: string | null;
  target: InvoiceTarget;
  transaction_id?: string;
  replace_existing: boolean;
};
const applicationPath = (id: string) =>
  `/applications/${encodeURIComponent(id)}` as const;
export const invoiceFileUrl = (applicationId: string, documentId: string) =>
  apiUrl(
    `${applicationPath(applicationId)}/documents/${encodeURIComponent(documentId)}/file`,
  );

export async function uploadInvoice(view: ApplicationView, file: File) {
  if (file.size > 2 * 1024 * 1024)
    throw new Error("PDF должен быть не больше 2 МБ.");
  if (!file.name.toLowerCase().endsWith(".pdf"))
    throw new Error("Выберите счёт в PDF с текстовым слоем.");
  const content = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      reader.result instanceof ArrayBuffer
        ? resolve(reader.result)
        : reject(new Error("Не удалось прочитать файл."));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.readAsArrayBuffer(file);
  });
  const query = new URLSearchParams({
    filename: file.name,
    base_application_version: String(view.application.application_version),
  });
  return apiRequest(
    `${applicationPath(view.application.application_id)}/documents?${query}`,
    applicationViewSchema,
    {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: content,
    },
  );
}

export async function applyInvoiceData(
  view: ApplicationView,
  invoice: Invoice,
  values: InvoiceValues,
  chat?: ChatView,
) {
  const body = JSON.stringify({
    base_application_version: view.application.application_version,
    document_revision: invoice.revision,
    confirmed: true,
    ...values,
    ...(chat ? { base_chat_version: chat.chat.chat_version } : {}),
  });
  if (chat)
    return {
      kind: "chat" as const,
      view: await apiRequest(
        `/chats/${encodeURIComponent(chat.chat.chat_id)}/documents/${encodeURIComponent(invoice.document_id)}/use`,
        chatViewSchema,
        { method: "POST", body },
      ),
    };
  return {
    kind: "application" as const,
    view: await apiRequest(
      `${applicationPath(view.application.application_id)}/documents/${encodeURIComponent(invoice.document_id)}/use`,
      applicationViewSchema,
      { method: "POST", body },
    ),
  };
}
