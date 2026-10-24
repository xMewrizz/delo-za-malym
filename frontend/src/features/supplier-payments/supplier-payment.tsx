import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { SupplierFinancingContext } from "./financing-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { ArrowLeft, ArrowRight, Check, FileUp, Landmark, ReceiptText, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { applicationKeys } from "@/features/applications";
import { normalizeMoneyInput } from "@/features/applications/model/need";
import { calendarKey } from "@/features/calendar/keys";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoneyPrecise as money } from "@/shared/lib/format";
import { useOperationJournal } from "@/shared/lib/operation-journal";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import { OperationRecovery } from "@/shared/ui/operation-recovery";
import { OperationResult } from "@/shared/ui/operation-result";
import { emptySupplier, financeSupplier, importSupplierInvoice, paySupplier, previewSupplier, requisiteErrors, supplierAccountKey, supplierAccountOptions, supplierFieldsSchema, supplierOperationSchema, type SupplierFields, type SupplierOperation, type SupplierReceipt } from "./api";
import "./supplier-payment.css";

const draftKey = "delo-supplier-invoice";
const day = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("ru-RU", {day: "numeric", month: "long"});
function savedInvoice() {
  try { return supplierFieldsSchema.parse(JSON.parse(localStorage.getItem(draftKey) || "null")); } catch { return emptySupplier; }
}

export function SupplierPaymentForm({onDone, overdraftId}: {onDone?: () => void; overdraftId?: string}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const financingCreated = useContext(SupplierFinancingContext);
  const account = useQuery(supplierAccountOptions(overdraftId));
  const [fields, setFields] = useState<SupplierFields>(savedInvoice);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof SupplierFields, string>>>({});
  const [importNote, setImportNote] = useState("");
  const [receipt, setReceipt] = useState<SupplierReceipt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const journal = useOperationJournal("supplier-payment", supplierOperationSchema);
  const [recovery, setRecovery] = useState(Boolean(journal.pending));
  const preview = useMutation({mutationFn: (data: SupplierFields) => overdraftId ? previewSupplier(data, account.data!.account_version, overdraftId) : previewSupplier(data, account.data!.account_version), onSuccess: () => setStep(2), onError: () => void account.refetch()});
  const operation = useMutation({mutationFn: paySupplier, onSuccess: data => finish(data), onError: error => {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) { journal.clear(); setRecovery(false); preview.reset(); setStep(1); void account.refetch(); }
    else setRecovery(true);
  }});
  function finish(data: SupplierReceipt) {
    setReceipt(data); journal.clear(); setRecovery(false);
    try { localStorage.removeItem(draftKey); } catch { /* Draft storage is optional. */ }
    void client.invalidateQueries({queryKey: applicationKeys.all});
    void client.invalidateQueries({queryKey: calendarKey});
    void client.invalidateQueries({queryKey: supplierAccountKey});
    void client.invalidateQueries({queryKey: ["overdraft"]});
  }
  useEffect(() => {
    if (!journal.pending || !account.data) return;
    const found = account.data.payments.find(item => item.request_id === journal.pending!.request_id);
    if (found) { let active = true; queueMicrotask(() => { if (active) finish(found); }); return () => { active = false; }; }
  });
  useEffect(() => {
    if (!receipt) try { localStorage.setItem(draftKey, JSON.stringify(fields)); } catch { /* Payment confirmation checks storage separately. */ }
  }, [fields, receipt]);
  useEffect(() => { heading.current?.focus({preventScroll: true}); heading.current?.closest(".supplier-dialog-body, .funding-dialog-body")?.scrollTo?.({top: 0}); }, [step]);
  const upload = useMutation({mutationFn: importSupplierInvoice, onSuccess: result => {
    setFields(current => ({...current, ...result.fields})); setErrors({});
    setImportNote(Object.keys(result.fields).length ? "Данные из PDF подставлены. Проверьте их перед оплатой." : "Не удалось найти реквизиты. Заполните счёт вручную.");
  }});
  const financing = useMutation({mutationFn: () => financeSupplier(preview.data!.shortfall, account.data!.today), onSuccess: view => {
    const id = view.application.application_id;
    client.setQueryData(applicationKeys.detail(id), view);
    financingCreated?.(view);
    void client.invalidateQueries({queryKey: applicationKeys.list});
    navigate(`/cabinet?mode=manual&invoice-financing=${id}`);
  }});
  function change(key: keyof SupplierFields, value: string) { setFields(current => ({...current, [key]: value})); setErrors(current => ({...current, [key]: undefined})); preview.reset(); operation.reset(); }
  function next(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    if (step === 0) {
      if (fields.recipient_name.trim().length < 2) found.recipient_name = "Укажите название компании или имя ИП.";
      let amount: string | null = null;
      try { amount = normalizeMoneyInput(fields.amount); } catch { /* Inline error below. */ }
      if (!amount || Number(amount) <= 0) found.amount = "Укажите сумму больше нуля, до двух знаков после запятой.";
      if (fields.purpose.trim().length < 5) found.purpose = "Укажите, за что платите, и НДС при необходимости.";
      setErrors(found);
      if (!Object.keys(found).length) { setFields(current => ({...current, amount: amount!})); setStep(1); }
    } else {
      Object.assign(found, requisiteErrors(fields)); setErrors(found);
      if (!Object.keys(found).length) preview.mutate(fields);
    }
    if (Object.keys(found).length) requestAnimationFrame(() => document.querySelector<HTMLElement>('.supplier-payment [aria-invalid="true"]')?.focus());
  }
  function confirm() {
    const quote = preview.data;
    if (!quote?.can_pay || journal.pending || operation.isPending) return;
    const payload: SupplierOperation = {...fields, ...(overdraftId ? {overdraft_application_id: overdraftId} : {}), base_account_version: quote.account_version, calculated_on: quote.calculated_on, request_id: crypto.randomUUID(), confirmed: true};
    if (journal.save(payload)) operation.mutate(payload);
  }
  if (receipt) return <div className="supplier-payment"><OperationResult receipt={{title: "Демо-платёж выполнен", description: receipt.request.recipient_name, amount: money(receipt.request.amount), facts: [
    {label: "Счёт поставщика", value: receipt.request.invoice_number || "Без номера"},
    {label: "Назначение", value: receipt.request.purpose},
    {label: "Из денег счёта", value: money(receipt.quote.own_money)},
    {label: "Из овердрафта", value: Number(receipt.quote.overdraft_used) ? money(receipt.quote.overdraft_used) : "Не потребовался"},
    {label: "Осталось на счёте", value: money(receipt.quote.cash_after)},
  ], calendarLabel: "Платёж в календаре", calendarHref: `/cabinet?mode=calendar&date=${receipt.date}`, anotherLabel: "Оплатить другой счёт"}} onDone={onDone} onAnother={() => {setReceipt(null); setFields({...emptySupplier}); setStep(0); preview.reset(); operation.reset(); setImportNote("");}} /><SupplierPaymentDetails receipt={receipt} /></div>;
  if (recovery && journal.pending) return <OperationRecovery checking={account.isFetching} busy={operation.isPending} error={operation.error ? getErrorMessage(operation.error) : account.error ? getErrorMessage(account.error) : undefined} onCheck={() => void account.refetch()} onRetry={() => operation.mutate(journal.pending!)} />;
  const quote = preview.data;
  const busy = preview.isPending || operation.isPending || upload.isPending || financing.isPending;
  return <section className="supplier-payment" aria-label="Оплата счёта поставщика">
    <ol className="supplier-steps" aria-label="Шаги оплаты">{["Счёт", "Реквизиты", "Проверка"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} data-done={step > index}><span>{step > index ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
    <div className="supplier-layout"><div className="supplier-main">
      <div className="supplier-step-heading"><span>Шаг {step + 1} из 3</span><h3 ref={heading} tabIndex={-1}>{["Кому и сколько платим", "Куда перевести деньги", "Проверьте платёж"][step]}</h3></div>
      {step < 2 ? <form onSubmit={next} noValidate>
        <fieldset disabled={busy}><legend className="sr-only">{step === 0 ? "Данные счёта" : "Реквизиты поставщика"}</legend>
          {step === 0 ? <>
            <div className="supplier-import"><Button type="button" variant="outline" onClick={() => uploadInput.current?.click()} disabled={busy}><FileUp size={16} aria-hidden="true" />{upload.isPending ? "Читаем PDF…" : "Заполнить из PDF"}</Button><span>Необязательно · до 2 МБ</span><input ref={uploadInput} hidden tabIndex={-1} type="file" accept="application/pdf,.pdf" aria-label="PDF счёта поставщика" onChange={event => {const file = event.target.files?.[0]; if (file) {if (file.size > 2 * 1024 * 1024) setImportNote("PDF должен быть не больше 2 МБ."); else upload.mutate(file);} event.target.value = "";}} /></div>
            {importNote && <p className="supplier-note" role="status">{importNote}</p>}{upload.error && <p className="supplier-error" role="alert">{getErrorMessage(upload.error)}</p>}
            <FormField id="supplier-name" required label="Получатель" autoComplete="organization" placeholder="ООО «Поставщик» или ИП" value={fields.recipient_name} onChange={event => change("recipient_name", event.target.value)} maxLength={160} error={errors.recipient_name} />
            <div className="supplier-fields-pair"><FormField id="supplier-amount" required label="Сумма, ₽" inputMode="decimal" placeholder="0,00" value={fields.amount} onChange={event => change("amount", event.target.value)} error={errors.amount} /><FormField id="supplier-number" label="Номер счёта · необязательно" placeholder="Например, 148/26" value={fields.invoice_number} maxLength={80} onChange={event => change("invoice_number", event.target.value)} /></div>
            <FormField id="supplier-purpose" required label="Назначение платежа" placeholder="Оплата товара по счёту № 148/26. Без НДС." value={fields.purpose} maxLength={210} onChange={event => change("purpose", event.target.value)} error={errors.purpose} />
          </> : <>
            <div className="supplier-recipient"><ReceiptText size={22} aria-hidden="true" /><div><strong>{fields.recipient_name}</strong><span>{fields.invoice_number ? `Счёт № ${fields.invoice_number}` : "Счёт поставщика"}</span></div><b>{money(fields.amount)}</b></div>
            <FormField id="supplier-inn" required label="ИНН получателя" inputMode="numeric" autoComplete="off" placeholder="10 или 12 цифр" value={fields.recipient_inn} maxLength={12} onChange={event => change("recipient_inn", event.target.value.replace(/\D/g, ""))} onBlur={() => setErrors(current => ({...current, recipient_inn: requisiteErrors(fields).recipient_inn}))} error={errors.recipient_inn} />
            <FormField id="supplier-account" required label="Расчётный счёт получателя" inputMode="numeric" autoComplete="off" placeholder="20 цифр" value={fields.recipient_account} maxLength={20} onChange={event => change("recipient_account", event.target.value.replace(/\D/g, ""))} error={errors.recipient_account} />
            <FormField id="supplier-bik" required label="БИК банка получателя" inputMode="numeric" autoComplete="off" placeholder="9 цифр" value={fields.recipient_bik} maxLength={9} onChange={event => change("recipient_bik", event.target.value.replace(/\D/g, ""))} error={errors.recipient_bik} />
          </>}
        </fieldset>
        <div className="supplier-actions">{step > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => {setStep(0); preview.reset();}}><ArrowLeft size={16} aria-hidden="true" />Назад</Button>}<Button type="submit" disabled={busy || !account.data || Boolean(account.error)}>{preview.isPending ? "Проверяем деньги…" : step === 0 ? "Далее: реквизиты" : "Проверить платёж"}<ArrowRight size={16} aria-hidden="true" /></Button></div>
      </form> : quote && <div className="supplier-review">
        <div className="supplier-recipient"><ReceiptText size={22} aria-hidden="true" /><div><strong>{fields.recipient_name}</strong><span>{fields.invoice_number ? `Счёт № ${fields.invoice_number}` : "Счёт поставщика"}</span></div></div>
        <strong className="supplier-payment-amount">{money(quote.amount)}</strong><p className="supplier-purpose">{fields.purpose}</p>
        <dl className="supplier-split"><div><dt>Из денег счёта</dt><dd>{money(quote.own_money)}</dd></div><div><dt>Из овердрафта{Number(quote.overdraft_used) > 0 && <small data-overdraft-terms>{Number(quote.overdraft_rate)}% годовых · {money(quote.overdraft_daily_interest)} в день после оплаты</small>}</dt><dd>{Number(quote.overdraft_used) ? money(quote.overdraft_used) : "Не потребуется"}{Number(quote.overdraft_used) > 0 && <small>Вернуть до {day(quote.overdraft_repay_by!)}</small>}</dd></div><div className="supplier-split-total"><dt>Останется на счёте</dt><dd>{money(quote.cash_after)}</dd></div></dl>
        {!quote.can_pay && <div className="supplier-shortfall" role="status"><strong>Для оплаты не хватает {money(quote.shortfall)}</strong><p>Счёт сохранён. Подберите финансирование и вернитесь к оплате.</p></div>}
        <details className="supplier-requisites"><summary>Реквизиты и условия</summary>{Number(quote.overdraft_used) > 0 && <p className="supplier-purpose">Поступления на счёт автоматически погашают овердрафт.</p>}<dl><div><dt>ИНН</dt><dd>{fields.recipient_inn}</dd></div><div><dt>Расчётный счёт</dt><dd>{fields.recipient_account}</dd></div><div><dt>БИК</dt><dd>{fields.recipient_bik}</dd></div></dl></details>
        <div className="supplier-actions"><Button variant="outline" disabled={busy} onClick={() => {setStep(1); preview.reset();}}><ArrowLeft size={16} aria-hidden="true" />Изменить</Button>{!quote.can_pay && <Button disabled={busy} onClick={() => financing.mutate()}>{financing.isPending ? "Создаём подбор…" : "Подобрать финансирование"}<ArrowRight size={16} aria-hidden="true" /></Button>}{quote.can_pay && <Button disabled={busy || Boolean(journal.pending)} onClick={confirm}>{operation.isPending ? "Выполняем платёж…" : `Оплатить ${money(quote.amount)}`}</Button>}</div>
      </div>}
      {(preview.error || operation.error || financing.error || journal.error) && <p role="alert" className="supplier-error">{journal.error || getErrorMessage(preview.error || operation.error || financing.error)}</p>}
    </div><aside className="supplier-context" aria-label="Деньги и ближайшие платежи">
      <div className="supplier-context-balance"><Landmark size={21} aria-hidden="true" /><span>На расчётном счёте</span><strong>{account.data ? money(account.data.cash_balance) : "…"}</strong></div>
      {account.isPending && <p role="status">Загружаем остаток…</p>}
      {account.error && <div role="alert"><p>{getErrorMessage(account.error)}</p><Button variant="outline" onClick={() => void account.refetch()}>Повторить</Button></div>}
      {account.data?.overdraft && <div className="supplier-context-limit"><span>{overdraftId ? "Свободно в этом овердрафте" : "Свободно в овердрафте"}</span><strong>{money(account.data.overdraft.available_limit)}</strong><small>{Number(account.data.overdraft.annual_rate_percent)}% годовых · на использованную сумму</small></div>}
      {quote && <div className="supplier-upcoming"><h4>Платежи по кредитам</h4><p>До {day(quote.upcoming_until)}, без будущих поступлений</p><strong>{money(quote.upcoming_total)}</strong>{quote.upcoming_payments.length > 0 && <details><summary>Показать график · {quote.upcoming_payments.length}</summary><ul>{quote.upcoming_payments.map((item, index) => <li key={`${item.date}:${index}`}><span>{day(item.date)}<small>{item.title}</small></span><b>{money(item.amount)}</b></li>)}</ul></details>}{quote.can_pay && <div className="supplier-reserve" data-shortfall={Number(quote.cash_after_upcoming) < 0}><span>{Number(quote.cash_after_upcoming) < 0 ? "К этим платежам нужно добавить" : "После оплаты счёта и кредитов"}</span><b>{money(String(Math.abs(Number(quote.cash_after_upcoming))))}</b></div>}</div>}
    </aside></div>
  </section>;
}

export function SupplierPaymentEntry() {
  const [search, setSearch] = useSearchParams();
  const open = search.get("pay") === "supplier";
  function toggle(value: boolean) {setSearch(current => {const next = new URLSearchParams(current); if (value) next.set("pay", "supplier"); else next.delete("pay"); return next; });}
  return <Dialog.Root open={open} onOpenChange={toggle}><Dialog.Trigger asChild><Button variant="outline"><ReceiptText size={16} aria-hidden="true" />Оплатить счёт</Button></Dialog.Trigger><Dialog.Portal container={document.querySelector<HTMLElement>(".cabinet-shell")}><Dialog.Overlay className="supplier-dialog-overlay" /><Dialog.Content className="supplier-dialog" aria-modal="true"><header><div><span className="supplier-overline">РАСЧЁТНЫЙ СЧЁТ</span><div className="supplier-dialog-title"><Dialog.Title>Оплата поставщику</Dialog.Title><span className="supplier-mode">Демо</span></div><Dialog.Description className="sr-only">Счёт, реквизиты и проверка денег перед оплатой</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Закрыть оплату счёта"><X size={20} /></Button></Dialog.Close></header><div className="supplier-dialog-body"><SupplierPaymentForm onDone={() => toggle(false)} /></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function SupplierPaymentDetails({receipt}: {receipt: SupplierReceipt}) {
  return <details className="supplier-event-receipt"><summary>Детали платежа</summary><dl>{[["Получатель", receipt.request.recipient_name], ["Счёт поставщика", receipt.request.invoice_number || "Без номера"], ["Назначение", receipt.request.purpose], ["ИНН", receipt.request.recipient_inn], ["Расчётный счёт", receipt.request.recipient_account], ["БИК", receipt.request.recipient_bik], ["Из денег счёта", money(receipt.quote.own_money)], ["Из овердрафта", money(receipt.quote.overdraft_used)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><span className="supplier-demo">Демо-платёж</span></details>;
}
