import { useState } from "react";
import { financingName } from "@/shared/lib/product-directions";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { getErrorMessage } from "@/shared/api/client";
import { applicationQueries } from "@/features/applications/model/queries";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import "./payment-calendar.css";
import { calendarQuery, filterProductEvents, type CalendarEvent } from "./api";

function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", options);
const amountLabel = (event: CalendarEvent) =>
  `${event.direction === "inflow" ? "+" : event.direction === "outflow" ? "−" : ""}${formatMoney(event.amount)}`;

export function PaymentCalendar({ initialPlanId, assistantPlanId }: { initialPlanId?: string | null; assistantPlanId?: string | null }) {
  const calendar = useQuery(calendarQuery);
  const profile = useQuery(applicationQueries.profile());
  const [search, setSearch] = useSearchParams();
  const product = search.get("product") || "all";
  const bankLoans = profile.data?.financials.existing_loans?.filter(loan => !loan.application_id) || [];
  const [initialToday] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }));
  const today = calendar.data?.today || initialToday;
  const [chosenMonth, setMonth] = useState<string | null>(null);
  const month = chosenMonth || today.slice(0, 7);
  const [chosenPlan, setPlan] = useState<string | null>(null);
  const plans = calendar.data?.plans.filter(plan => plan.state !== "cancelled") || [];
  const planId = chosenPlan ?? (plans.some(plan => plan.application_id === initialPlanId) ? initialPlanId : "") ?? "";
  const plan = plans.find(item => item.application_id === planId);
  const events = [...filterProductEvents(calendar.data?.events || [], product), ...(product === "all" ? plan?.events || [] : [])]
    .sort((left, right) => left.date.localeCompare(right.date) || left.event_id.localeCompare(right.event_id));
  const monthEvents = events.filter(event => event.date.startsWith(month));
  const [chosenDate, setDate] = useState<string | null>(null);
  const selectedDate = chosenDate?.startsWith(month) ? chosenDate : monthEvents[0]?.date || (today.startsWith(month) ? today : `${month}-01`);
  const selectedEvents = monthEvents.filter(event => event.date === selectedDate);
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const days = Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const nextPayment = events.find(event => event.date >= today && event.direction === "outflow" && !event.kind.startsWith("planned_"));
  return <div className="space-y-5">
    <div className="calendar-product-filter"><div><h2>Какие платежи показать?</h2><p>Общий график или обязательства по одному продукту.</p></div><label><span className="sr-only">Продукт в календаре</span><select aria-label="Продукт в календаре" value={product} onChange={event => setSearch(current => { const next = new URLSearchParams(current); if (event.target.value === "all") next.delete("product"); else next.set("product", event.target.value); return next; })}><option value="all">Все продукты</option>{bankLoans.map((loan, index) => <option key={loan.loan_id} value={`loan:${loan.loan_id}`}>Действующий кредит {index + 1} · {formatMoney(loan.outstanding_principal || "0")}</option>)}{calendar.data?.accounts.map(account => <option key={account.application_id} value={`app:${account.application_id}`}>{financingName(account.product_id)} · {formatMoney(account.amount)} · {account.application_id.slice(0, 6)}</option>)}</select></label></div>
    <p className="max-w-3xl text-sm text-muted-foreground">{product === "all" ? "Здесь собраны графики действующих продуктов. Добавьте поступления и расходы выбранного плана, чтобы видеть предстоящие платежи вместе." : "Показан график выбранного продукта. Чтобы вернуться к общему календарю, выберите «Все продукты»."} События с отметкой «По плану» ещё не исполнены.</p>
    {calendar.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{getErrorMessage(calendar.error)}<Button variant="outline" onClick={() => void calendar.refetch()}><RefreshCw />Повторить загрузку</Button></div>}
    {calendar.isLoading && <p role="status" className="text-sm text-muted-foreground">Загружаем платежи и поступления…</p>}
    <Card><CardContent className="space-y-5 pt-6">
      <div className="payment-calendar-toolbar">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
          <h2 className="min-w-0 text-xl font-extrabold capitalize" aria-live="polite">{dateLabel(`${month}-01`, { month: "long", year: "numeric" })}</h2>
          <Button variant="outline" size="icon" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => { setMonth(today.slice(0, 7)); setDate(today); }}>Сегодня</Button>
          {nextPayment && <Button variant="outline" size="sm" onClick={() => { setMonth(nextPayment.date.slice(0, 7)); setDate(nextPayment.date); }}>К ближайшему платежу</Button>}</div>
      </div>
      {product === "all" && plans.length > 0 && <label className="block max-w-xl text-sm font-semibold">Показать поступления и расходы
        <select className="mt-2 block min-h-11 w-full rounded-xl border border-input bg-background p-3 text-sm font-normal" value={planId} onChange={event => setPlan(event.target.value)}>
          <option value="">Только графики полученных кредитов</option>
          {plans.map(item => <option key={item.application_id} value={item.application_id}>{item.application_id === initialPlanId ? "Самостоятельный подбор" : item.application_id === assistantPlanId ? "Диалог с Лумой" : item.state === "disbursed" || item.state === "limit_opened" ? "Полученное финансирование" : "Другая заявка"}{item.amount ? ` · ${formatMoney(item.amount)}` : ""}{item.state === "draft" ? " · черновик" : ""}</option>)}
        </select>
        <span className="mt-2 block text-xs font-normal text-muted-foreground">Показываем один выбранный план. Платежи по всем полученным кредитам учитываются вместе с ним.</span>
      </label>}
      <div className="calendar-legend"><span className="calendar-inflow">● Поступления</span><span className="calendar-outflow">● Расходы и погашение</span><span>По плану — ожидаемое событие</span></div>
      <div className="payment-calendar-grid" aria-label="Календарь на месяц">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <div key={day} className="calendar-weekday">{day}</div>)}
        {Array.from({ length: offset }, (_, index) => <div key={`empty-${index}`} className="calendar-empty" aria-hidden="true" />)}
        {days.map(date => {
          const rows = monthEvents.filter(event => event.date === date);
          return <button key={date} data-date={date} type="button" className={`calendar-day ${date === today ? "calendar-today" : ""}`} aria-pressed={date === selectedDate} aria-label={`${dateLabel(date, { day: "numeric", month: "long" })}, событий: ${rows.length}`} onClick={() => setDate(date)}>
            <span className="calendar-day-number">{Number(date.slice(-2))}</span>
            {rows.slice(0, 2).map(event => <span key={event.event_id} className={`calendar-event calendar-${event.direction}`}><strong>{amountLabel(event)}</strong><span>{event.title}</span><span className="calendar-event-state">{event.forecast ? "По плану" : "Выполнено"}</span></span>)}
            {rows.length > 2 && <span className="calendar-more">Ещё {rows.length - 2}</span>}
          </button>;
        })}
      </div>
      <div className="payment-calendar-mobile">
        {days.filter(date => monthEvents.some(event => event.date === date)).map(date => <section key={date} className="calendar-mobile-day">
          <h3 className="font-bold">{dateLabel(date, { day: "numeric", month: "long", weekday: "short" })}</h3>
          {monthEvents.filter(event => event.date === date).map(event => <EventDetails key={event.event_id} event={event} />)}
        </section>)}
      </div>
      {!monthEvents.length && !calendar.isLoading && <p className="rounded-xl bg-secondary p-4 text-sm text-muted-foreground">В этом месяце событий нет. Выберите другой месяц или добавьте поступления и расходы при подборе финансирования.</p>}
      <section className="calendar-day-details" aria-label="События выбранного дня" aria-live="polite">
        <h3 className="font-bold">{dateLabel(selectedDate, { day: "numeric", month: "long" })}</h3>
        {selectedEvents.length ? selectedEvents.map(event => <EventDetails key={event.event_id} event={event} />) : <p className="text-sm text-muted-foreground">На этот день событий нет.</p>}
      </section>
    </CardContent></Card>
    {Boolean(calendar.data?.accounts.length) && <Card><CardContent className="pt-6"><h2 className="text-lg font-bold">Полученное финансирование</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">
      {calendar.data?.accounts.map(account => <Link key={account.application_id} className="rounded-xl border border-border p-4 hover:border-primary" to={`/cabinet?mode=applications&application=${account.application_id}`}>
        <strong>{financingName(account.product_id)} · {formatMoney(account.amount)}</strong>
        <p className="mt-2 text-sm text-muted-foreground">{account.status === "refinanced" ? "Погашен рефинансированием. Будущие платежи по этому кредиту не учитываются." : account.product_id === "overdraft" ? "Лимит открыт. Использование и погашение показаны как прогноз." : "Учтён при расчёте новых заявок. Платежи показаны по договорному графику."}</p>
      </Link>)}
    </div></CardContent></Card>}
  </div>;
}

function EventDetails({ event }: { event: CalendarEvent }) {
  return <article className="calendar-detail-event">
    <div><p className="font-semibold">{event.title}</p><p className="mt-1 text-xs text-muted-foreground">{event.forecast ? "По плану" : "Выполнено в симуляторе"}</p>
      {event.application_id && !event.kind.startsWith("planned_") && <Link className="mt-1 inline-block text-xs font-semibold text-primary underline" to={`/cabinet?mode=applications&application=${event.application_id}`}>Открыть заявку</Link>}</div>
    <strong className={`calendar-${event.direction}`}>{amountLabel(event)}</strong>
  </article>;
}
