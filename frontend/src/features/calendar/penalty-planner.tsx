import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Check, ChevronDown, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { getErrorMessage } from "@/shared/api/client";
import { formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { FormField } from "@/shared/ui/form-field";
import { penaltyRateLabel, penaltySourceLabel } from "@/shared/lib/penalty-terms";
import { DatePicker } from "@/shared/ui/date-picker";
import { eventProductKey, isDebtObligation, penaltyCandidates, previewPenalty, type CalendarData, type PenaltyPreviewRequest } from "./api";
import "./penalty-planner.css";

export type CalendarProduct = { id: string; title: string; reference: string };
const dateLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("ru-RU");
const sumAmounts = (amounts: string[]) => (amounts.reduce((total, amount) => total + Math.round(Number(amount) * 100), 0) / 100).toFixed(2);
function normalizedRate(value: string) {
  const result = value.trim().replace(",", ".");
  return /^\d{1,3}(\.\d{1,6})?$/.test(result) && Number(result) <= 100 ? result : null;
}

export function PenaltyPlanner({ calendar, products, targetDate, productScope, label = "Рассчитать штраф" }: { calendar: CalendarData; products: CalendarProduct[]; targetDate: string; productScope: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><Button variant="outline"><Calculator size={16} />{label}</Button></Dialog.Trigger><Dialog.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}><Dialog.Overlay className="penalty-overlay" /><Dialog.Content className="penalty-dialog"><header><div><Dialog.Title>Расчёт пеней</Dialog.Title><Dialog.Description>Сколько добавится к платежам при задержке.</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Закрыть расчёт штрафа"><X size={20} /></Button></Dialog.Close></header><div className="penalty-dialog-body">{open && <PenaltyForm key={`${targetDate}:${productScope}`} calendar={calendar} products={products} targetDate={targetDate} productScope={productScope} />}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function PenaltyForm({ calendar, products, targetDate, productScope }: { calendar: CalendarData; products: CalendarProduct[]; targetDate: string; productScope: string }) {
  const [from, setFrom] = useState(() => {
    const unpaid = calendar.events.filter(event => isDebtObligation(event) && Number(event.amount) > 0 && event.date < targetDate && !calendar.accounts.some(account => account.application_id === event.application_id && ["closed", "refinanced"].includes(account.status || ""))).map(event => event.date);
    return [calendar.today < targetDate ? calendar.today : new Date(Date.parse(targetDate + "T12:00:00Z") - 86400000).toISOString().slice(0, 10), ...unpaid].sort()[0];
  });
  const [to, setTo] = useState(targetDate);
  const [chosen, setChosen] = useState<string[] | null>(productScope === "all" ? null : [productScope]);
  const [commonRate, setCommonRate] = useState("");
  const [customRates, setCustomRates] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null);
  const result = useRef<HTMLElement>(null);
  const editing = useRef(false);
  const preview = useMutation({ mutationFn: (payload: PenaltyPreviewRequest) => previewPenalty(payload) });
  useEffect(() => {
    if (!preview.data) {
      if (editing.current) {
        editing.current = false;
        form.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
        form.current?.querySelector<HTMLButtonElement>("#penalty-target")?.focus({ preventScroll: true });
      }
      return;
    }
    if (!result.current) return;
    result.current.scrollIntoView?.({ block: "start", behavior: "instant" });
    result.current.focus({ preventScroll: true });
  }, [preview.data]);
  const closed = new Set(calendar.accounts.filter(account => ["closed", "refinanced"].includes(account.status || "")).map(account => account.application_id));
  const events = penaltyCandidates(calendar.events, from, to).filter(event => !closed.has(event.application_id));
  const nextObligation = calendar.events.filter(event => isDebtObligation(event) && Number(event.amount) > 0 && !closed.has(event.application_id) && event.date >= from && event.date >= to && (productScope === "all" || eventProductKey(event) === productScope)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const candidates = products.filter(product => events.some(event => eventProductKey(event) === product.id));
  const selected = candidates.filter(product => chosen === null || chosen.includes(product.id));
  const terms = new Map((calendar.penalty_terms || []).map(item => [item.product_id, item]));
  const manualProducts = selected.filter(product => customRates || !terms.has(product.id));
  const selections = selected.map((product): PenaltyPreviewRequest["products"][number] | null => {
    const known = terms.get(product.id);
    if (known && !customRates) return { product_id: product.id, rate_source: "contract", terms_id: known.terms_id };
    const rate = normalizedRate(rates[product.id] || commonRate);
    return rate === null ? null : { product_id: product.id, daily_rate_percent: rate };
  });
  const complete = selected.length > 0 && selections.every(item => item !== null) && from < to;
  const dateError = !from || !to ? "Укажите обе даты." : from >= to ? "Дата оплаты должна быть позже начала периода." : (Date.parse(to) - Date.parse(from)) / 86400000 > 3660 ? "Выберите период не длиннее 10 лет." : undefined;
  const pending = preview.isPending;
  const clearResult = () => preview.reset();

  return <form ref={form} className="penalty-form" onSubmit={event => { event.preventDefault(); if (complete && !dateError) preview.mutate({ from_date: from, target_date: to, products: selections.filter((item): item is PenaltyPreviewRequest["products"][number] => item !== null) }); }}>
    {!preview.data && <>
    <div className="penalty-step-title"><span>01</span><h3>Какие даты сравним?</h3></div>
    <div className="penalty-period"><DatePicker id="penalty-from" label="Пропустить платежи начиная с" value={from} disabled={pending} onChange={value => { setFrom(value); clearResult(); }} /><DatePicker id="penalty-target" label="Оплатить всё в эту дату" value={to} disabled={pending} onChange={value => { setTo(value); clearResult(); }} /></div>
    {dateError && <p className="text-destructive" role="status">{dateError}</p>}
    <div className="penalty-step-title"><span>02</span><h3>По каким продуктам?</h3></div>
    {candidates.length ? <fieldset className="penalty-product-list" disabled={pending}><legend className="sr-only">Продукты с платежами в выбранном периоде</legend><div className="penalty-selection-actions"><span>{selected.length} из {candidates.length} выбрано</span><button type="button" onClick={() => { setChosen(chosen?.length === 0 ? null : []); clearResult(); }}>{chosen?.length === 0 ? "Выбрать все" : "Снять выбор"}</button></div>{candidates.map(product => {
      const rows = events.filter(event => eventProductKey(event) === product.id);
      return <label key={product.id} className="penalty-product-option"><input type="checkbox" checked={selected.some(item => item.id === product.id)} onChange={event => { setChosen(event.target.checked ? [...selected.map(item => item.id), product.id] : selected.filter(item => item.id !== product.id).map(item => item.id)); clearResult(); }} /><span><strong>{product.title}</strong><small>{product.reference} · {rows.length} плат. · {dateLabel(rows[0].date)}{rows.length > 1 ? ` — ${dateLabel(rows.at(-1)!.date)}` : ""}</small></span><b>{formatMoneyPrecise(sumAmounts(rows.map(row => row.amount)))}</b></label>;
    })}</fieldset> : <div className="penalty-no-payments"><Check size={20} /><p>До выбранной даты нет платежей, для которых можно рассчитать пени. Пени начинаются со следующего дня после срока оплаты.</p>{nextObligation && <Button type="button" variant="outline" onClick={() => { setTo(new Date(Date.parse(nextObligation.date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10)); clearResult(); }}>Показать задержку ближайшего платежа</Button>}</div>}
    {selected.length > 0 && <div className="penalty-step-title"><span>03</span><h3>Условия пеней</h3></div>}
    {selected.length > 0 && <div className="penalty-contract-rates">{selected.map(product => {
      const known = terms.get(product.id);
      return <div key={product.id}><span><strong>{product.title} · {product.reference}</strong><small>{customRates ? "Ручной сценарий" : known ? penaltySourceLabel(known.source) : "Условия не переданы — нужна ставка для сценария"}</small></span><b>{known && !customRates ? penaltyRateLabel(known.daily_rate_percent) : "Указать ниже"}</b></div>;
    })}</div>}
    {selected.some(product => terms.has(product.id)) && <label className="penalty-custom-toggle"><input type="checkbox" checked={customRates} disabled={pending} onChange={event => { setCustomRates(event.target.checked); clearResult(); }}/><span>Свои ставки для сценария</span></label>}
    {manualProducts.length > 0 && <>
      <FormField id="penalty-rate" label={customRates ? "Общая ставка сценария, % в день" : "Ставка для продуктов без условий, % в день"} value={commonRate} inputMode="decimal" placeholder="Например, 0,05" disabled={pending} onChange={event => { setCommonRate(event.target.value); clearResult(); }} hint={customRates ? "Изменяет только этот расчёт, условия договора сохраняются." : "Применится только к продуктам без сохранённых условий."} error={commonRate && !normalizedRate(commonRate) ? "Укажите от 0 до 100% в день, до 6 знаков после запятой." : undefined} />
      <details className="penalty-individual-rates"><summary>Разные ставки по продуктам</summary><div>{manualProducts.map(product => <FormField key={product.id} id={`penalty-rate-${product.id}`} label={`${product.title} · ${product.reference}`} placeholder="Использовать общую ставку" inputMode="decimal" value={rates[product.id] || ""} disabled={pending} onChange={event => { setRates(current => ({ ...current, [product.id]: event.target.value })); clearResult(); }} error={rates[product.id] && !normalizedRate(rates[product.id]) ? "Укажите от 0 до 100% в день." : undefined} />)}</div></details>
    </>}
    <p className="penalty-assumption">Расчёт не переносит платежи и не списывает деньги.</p>
    {candidates.length > 0 && <Button type="submit" disabled={!complete || Boolean(dateError) || pending}><Calculator size={16} />{pending ? "Считаем…" : "Рассчитать пени"}</Button>}
    {preview.error && <p role="alert" className="text-destructive">{getErrorMessage(preview.error)}</p>}
    </>}
    {preview.data && <section ref={result} tabIndex={-1} className="penalty-result" aria-labelledby="penalty-result-title" role="status">
      <p>Если оплатить {new Date(preview.data.target_date + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}</p>
      <h3 id="penalty-result-title">Пени за задержку</h3>
      <strong className="penalty-result-total">+{formatMoneyPrecise(preview.data.total_penalty)}</strong>
      <dl><div><dt>Платежи по графику</dt><dd>{formatMoneyPrecise(preview.data.missed_payments)}</dd></div><div><dt>Итого с пенями</dt><dd>{formatMoneyPrecise(preview.data.total_with_penalty)}</dd></div></dl>
      <div className="penalty-result-products">{preview.data.products.map(group => <details key={group.product_id}>
        <summary><span>{products.find(product => product.id === group.product_id)?.title}<small>{products.find(product => product.id === group.product_id)?.reference} · {penaltyRateLabel(group.daily_rate_percent)}</small></span><strong>+{formatMoneyPrecise(group.penalty)}</strong><ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="penalty-calculation-rows">{group.payments.map(payment => <div key={payment.event_id}><span>Платёж {dateLabel(payment.due_date)}<small>{formatMoneyPrecise(payment.amount)} × {group.daily_rate_percent}% × {payment.days} дн.</small></span><strong>+{formatMoneyPrecise(payment.penalty)}</strong></div>)}<p>Источник ставки: {group.rate_source === "contract" ? penaltySourceLabel(group.contract_source).toLocaleLowerCase("ru-RU") : "задана вами"}.</p></div>
      </details>)}</div>
      <details className="penalty-method"><summary>Как посчитано<ChevronDown size={15} aria-hidden="true" /></summary><div><p>Платёж × ставка в день × дни задержки.</p><p>Со следующего дня после срока платежа по {dateLabel(preview.data.target_date)} включительно. Проценты по кредиту и комиссии сюда не входят.</p></div></details>
      <div className="penalty-result-actions"><Button type="button" variant="outline" onClick={() => { editing.current = true; clearResult(); }}>Изменить расчёт</Button><Dialog.Close asChild><Button type="button">Готово</Button></Dialog.Close></div>
    </section>}
  </form>;
}
