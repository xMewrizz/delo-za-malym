import { SupplierPaymentForm } from "@/features/supplier-payments/supplier-payment";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getErrorMessage } from "@/shared/api/client";
import { formatMoneyPrecise as money } from "@/shared/lib/format";
import { useOperationJournal } from "@/shared/lib/operation-journal";
import { normalizeMoneyInput } from "@/features/applications/model/need";
import { applicationKeys } from "@/features/applications";
import { calendarKey } from "@/features/calendar/keys";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import { OperationResult, type OperationReceipt } from "@/shared/ui/operation-result";
import { OperationRecovery } from "@/shared/ui/operation-recovery";
import { getOverdraft, operateOverdraft, overdraftKey, overdraftOperationSchema, previewOverdraft, type OverdraftRequest, type OverdraftState } from "./api";

const dateLabel = (date:string) => new Date(date+"T12:00:00").toLocaleDateString("ru-RU");
function LegacyOverdraftPanel({ applicationId, initialKind = "expense", onDone }: {applicationId:string;initialKind?:"expense"|"receipt";onDone?:()=>void}) {
  const client = useQueryClient();
  const query = useQuery({ queryKey:overdraftKey(applicationId),queryFn:({signal})=>getOverdraft(applicationId,signal),refetchOnMount:"always" });
  const [kind] = useState<"expense"|"receipt">(initialKind);
  const [purpose] = useState<OverdraftRequest["purpose"]>("supplier");
  const [amount,setAmount] = useState("");
  const [receipt,setReceipt] = useState<OperationReceipt|null>(null);
  const quoteHeading = useRef<HTMLHeadingElement>(null);
  const journal = useOperationJournal(`overdraft:${applicationId}`,overdraftOperationSchema);
  const request = useRef<OverdraftRequest|null>(journal.pending);
  const [restoring] = useState(()=>Boolean(journal.pending));
  const preview = useMutation({mutationFn:()=>previewOverdraft(applicationId,{kind,purpose:kind==="receipt"?"revenue":purpose,amount:normalizeMoneyInput(amount)!,base_account_version:query.data!.account_version}),onSuccess:()=>requestAnimationFrame(()=>quoteHeading.current?.focus({preventScroll:true})),onError:()=>void query.refetch()});
  async function complete(state:OverdraftState,payload:OverdraftRequest) {
    const operation = state.operations.find(item=>item.request_id===payload.request_id);
    setReceipt({title:payload.kind==="expense"?"Платёж выполнен":"Поступление зачислено",description:payload.kind==="expense" ? Number(operation?.drawn || "0") > 0 ? "Для оплаты использованы деньги счёта и овердрафт." : "Платёж выполнен из денег расчётного счёта." : "Поступление распределено на погашение овердрафтов. Остаток доступен на счёте.",amount:money(payload.amount),facts:[
      ...(payload.kind==="expense" ? [{label:"Списано из денег счёта",value:money((Number(payload.amount) - Number(operation?.drawn || "0")).toFixed(2))}, {label:"Из овердрафта",value:Number(operation?.drawn || "0") > 0 ? money(operation!.drawn) : "Не потребовался"}] : []),
      {label:"Осталось на счёте",value:money(state.cash_balance)}, {label:"Долг по этому овердрафту",value:money(state.principal)}, {label:"Свободно в лимите",value:money(state.available_limit)},
    ]});
    journal.clear();request.current=null;setAmount("");client.setQueryData(overdraftKey(applicationId),state);
    await Promise.all([client.invalidateQueries({queryKey:applicationKeys.profile}),client.invalidateQueries({queryKey:applicationKeys.all}),client.invalidateQueries({queryKey:calendarKey}),client.invalidateQueries({queryKey:["overdraft"]})]);
  }
  const operation = useMutation({mutationFn:(payload:OverdraftRequest)=>operateOverdraft(applicationId,payload),onSuccess:(result,payload)=>complete(result.state,payload),onError:error=>{if(error instanceof ApiError&&error.status<500){journal.clear();request.current=null;preview.reset();void query.refetch();}}});
  useEffect(()=>{ if(!(restoring || operation.isError)||!journal.pending||!query.data||receipt||!query.data.operations.some(item=>item.request_id===journal.pending!.request_id)) return; let active=true; void Promise.resolve().then(()=>{if(active) void complete(query.data!,journal.pending!);});return()=>{active=false;}; });
  const unresolved = Boolean(journal.pending && operation.isError);
  const state=query.data;
  let normalized: string | null = null;
  try { normalized=normalizeMoneyInput(amount); } catch { /* Show the error next to the amount. */ }
  const maximumPayment=state ? ((Math.round(Number(state.cash_balance)*100)+Math.round(Number(state.available_limit)*100))/100).toFixed(2) : "0.00";
  const amountError=amount.trim() && !normalized ? "Укажите положительную сумму в рублях." : kind==="expense" && normalized && Number(normalized)>Number(maximumPayment) ? "Сумма больше денег счёта и доступного овердрафта вместе." : undefined;
  function change(){preview.reset();operation.reset();}
  if(receipt) return <OperationResult receipt={receipt} onDone={onDone} onAnother={()=>{setReceipt(null);change();}} />;
  if((restoring||unresolved)&&journal.pending) return <OperationRecovery checking={query.isFetching} busy={operation.isPending} error={operation.error?getErrorMessage(operation.error):query.error?getErrorMessage(query.error):undefined} onCheck={()=>void query.refetch()} onRetry={()=>operation.mutate(journal.pending!)} />;
  if (kind === "expense") return <SupplierPaymentForm overdraftId={applicationId} onDone={onDone} />;
  return <section className="funding-operation space-y-5" aria-label="Поступление на расчётный счёт">
    {query.isPending && <p role="status">Загружаем счёт и лимит…</p>}
    {query.error && <div role="alert">{getErrorMessage(query.error)}<Button variant="outline" onClick={() => void query.refetch()}>Обновить</Button></div>}
    {state && <>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">{[["Деньги на счёте", state.cash_balance], ["Основной долг", state.principal], ["Начислено процентов", state.accrued_interest], ["Свободно в овердрафте", state.available_limit]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold">{money(value)}</dd></div>)}</dl>
      {state.repay_by && <p className="rounded-xl bg-secondary p-4 text-sm">Вернуть долг и проценты до <strong>{dateLabel(state.repay_by)}</strong>. Поступления погашают сначала проценты, затем основной долг.</p>}
      {preview.data ? <section className="space-y-4" aria-label="Проверка поступления"><h3 ref={quoteHeading} tabIndex={-1} className="text-xl font-semibold">Проверьте поступление</h3><strong className="text-2xl">{money(preview.data.amount)}</strong><dl className="space-y-3 text-sm">{[["На погашение процентов", preview.data.interest_paid], ["На погашение основного долга", preview.data.principal_paid], ["Останется на счёте", preview.data.cash_after], ["Долг по этому овердрафту", preview.data.principal_after]].map(([label, value]) => <div className="flex justify-between gap-3" key={label}><dt>{label}</dt><dd className="font-semibold">{money(value)}</dd></div>)}</dl><div className="flex flex-wrap gap-3"><Button disabled={operation.isPending} onClick={() => {if (!preview.data || operation.isPending) return; const payload: OverdraftRequest = {base_account_version: preview.data.account_version, calculated_on: preview.data.calculated_on, request_id: crypto.randomUUID(), confirmed: true, kind: "receipt", purpose: "revenue", amount: preview.data.amount}; if (journal.save(payload)) {request.current = payload; operation.mutate(payload);}}}>{operation.isPending ? "Зачисляем…" : "Подтвердить поступление"}</Button><Button variant="outline" disabled={operation.isPending} onClick={change}>Изменить</Button></div></section> : <form className="space-y-4" onSubmit={event => {event.preventDefault(); if (!preview.isPending) preview.mutate();}}><fieldset className="space-y-4" disabled={preview.isPending}><FormField id="overdraft-payment-amount" label="Сумма поступления, ₽" inputMode="decimal" placeholder="Например, 50 000" value={amount} error={amountError} onChange={event => {setAmount(event.target.value); change();}} /><p className="text-sm text-muted-foreground">Смоделируем зачисление выручки. Она автоматически погасит долг по открытым овердрафтам.</p><Button type="submit" disabled={preview.isPending || !normalized || Boolean(amountError)}>{preview.isPending ? "Рассчитываем…" : "Проверить поступление"}</Button></fieldset></form>}
      {state.operations.length > 0 && <details><summary className="cursor-pointer text-sm text-primary">История операций · {state.operations.length}</summary><ul className="mt-3 space-y-3 text-sm">{[...state.operations].reverse().map(item => <li key={item.operation_id} className="border-t border-border pt-3"><strong>{item.kind === "expense" ? "Оплачен счёт" : item.kind === "receipt" ? "Поступление на счёт" : "Автопогашение"} · {money(item.amount)}</strong><p className="text-muted-foreground">{dateLabel(item.date)}{item.kind === "auto_repayment" ? ` · долг ${money(item.principal_paid)} · проценты ${money(item.interest_paid)}` : item.kind === "expense" ? ` · из овердрафта ${money(item.drawn)}` : ""}</p></li>)}</ul></details>}
    </>}
    {(preview.error || operation.error || journal.error) && <p role="alert" className="text-destructive">{journal.error || getErrorMessage(preview.error || operation.error)}</p>}
  </section>;
}

export function OverdraftPanel(props: {applicationId: string; initialKind?: "expense" | "receipt"; onDone?: () => void}) {
  let pending = false;
  try { pending = Boolean(localStorage.getItem(`delo-pending-operation:overdraft:${props.applicationId}`)); } catch { /* Optional storage. */ }
  return props.initialKind === "receipt" || pending ? <LegacyOverdraftPanel {...props} /> : <SupplierPaymentForm overdraftId={props.applicationId} onDone={props.onDone} />;
}
