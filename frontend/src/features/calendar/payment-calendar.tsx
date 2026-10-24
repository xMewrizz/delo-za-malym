import { useEffect, useState } from "react";
import { financingName } from "@/shared/lib/product-directions";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChartGantt, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { getErrorMessage } from "@/shared/api/client";
import { applicationQueries } from "@/features/applications/model/queries";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import "./payment-calendar.css";
import { calendarQuery, filterProductEvents, isDebtObligation, type CalendarEvent } from "./api";
import { PenaltyPlanner, type CalendarProduct } from "./penalty-planner";
import { PaymentTimeline } from "./payment-timeline";
import { EventDetails } from "./calendar-event-details";

function shiftMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", options);
const amountLabel = (event: CalendarEvent) =>
  `${event.direction === "inflow" ? "+" : event.direction === "outflow" ? "−" : ""}${formatMoney(event.amount)}`;

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function PaymentCalendar() {
  const calendar = useQuery(calendarQuery);
  const profile = useQuery(applicationQueries.profile());
  const [search, setSearch] = useSearchParams();
  const product = search.get("product") || "all";
  const bankLoans = profile.data?.financials.existing_loans?.filter(loan => !loan.application_id) || [];
  const calendarProducts: CalendarProduct[] = [
    ...bankLoans.map((loan, index) => ({ id: `loan:${loan.loan_id}`, title: loan.product_id ? financingName(loan.product_id) : "Кредит", reference: `Договор банка ${index + 1}` })),
    ...(calendar.data?.accounts || []).map(account => ({ id: `app:${account.application_id}`, title: financingName(account.product_id), reference: `№ ${account.application_id.slice(0, 6)}` })),
  ];
  const [initialToday] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" }));
  const today = calendar.data?.today || initialToday;
  const actualPortfolio = (calendar.data?.events || []).filter(event => !event.forecast || !event.kind.startsWith("overdraft_") || event.kind === "overdraft_payment_due");
  const events = filterProductEvents(actualPortfolio, product)
    .sort((left, right) => left.date.localeCompare(right.date) || left.event_id.localeCompare(right.event_id));
  const nextPayment = events.find(event => event.date >= today && isDebtObligation(event));
  const requestedDate = validDate(search.get("date"));
  const selectedDate = requestedDate || (product !== "all" && nextPayment ? nextPayment.date : today);
  const month = selectedDate.slice(0, 7);
  const [smallScreenList, setSmallScreenList] = useState(() => window.matchMedia?.("(max-width: 760px)").matches || false);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const update = () => setSmallScreenList(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const timelineView = search.get("view") === "timeline";
  const listView = !timelineView && smallScreenList;
  const weekStart = new Date(selectedDate + "T12:00:00Z");
  weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
  const weekDates = Array.from({ length: 7 }, (_, offset) => { const value = new Date(weekStart); value.setUTCDate(value.getUTCDate() + offset); return value.toISOString().slice(0,10); });
  function chooseView(value: "calendar" | "timeline") { setSearch(current => { const next = new URLSearchParams(current); if (value === "timeline") next.set("view", value); else next.delete("view"); return next; }, { replace: true }); }
  function selectDate(value: string) { setSearch(current => { const next = new URLSearchParams(current); next.set("date", value); return next; }, { replace: true }); }
  const monthEvents = events.filter(event => event.date.startsWith(month));
  const selectedEvents = monthEvents.filter(event => event.date === selectedDate);
  const selectedExpenses = (selectedEvents.filter(event => event.forecast && event.direction === "outflow").reduce((total, event) => total + Math.round(Number(event.amount) * 100), 0) / 100).toFixed(2);
  const dayPaymentActions = <div className="calendar-penalty-entry"><h4>К оплате в этот день</h4><strong>{formatMoneyPrecise(selectedExpenses)}</strong>{calendar.data && profile.data && !calendar.error && !profile.error && <PenaltyPlanner calendar={calendar.data} products={calendarProducts} targetDate={selectedDate} productScope={product} />}</div>;
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const days = Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return <div className="space-y-5">

    {calendar.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">{getErrorMessage(calendar.error)}<Button variant="outline" onClick={() => void calendar.refetch()}><RefreshCw />Повторить загрузку</Button></div>}
    {profile.error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Не удалось загрузить данные договоров для расчёта пеней.<Button variant="outline" size="sm" onClick={() => void profile.refetch()}>Обновить договоры</Button></div>}
    {calendar.isLoading && <p role="status" className="text-sm text-muted-foreground">Загружаем платежи и поступления…</p>}
    <Card><CardContent className="space-y-6">
      <div className="calendar-presentation-controls">
      <div className="calendar-presentation-switch" role="group" aria-label="Представление платежей"><Button size="sm" variant={timelineView ? "ghost" : "default"} aria-pressed={!timelineView} onClick={() => chooseView("calendar")}><CalendarDays size={16} />Календарь</Button><Button size="sm" variant={timelineView ? "default" : "ghost"} aria-pressed={timelineView} onClick={() => chooseView("timeline")}><ChartGantt size={16} />Таймлайн</Button></div>
    <div className="calendar-product-filter calendar-product-filter-compact"><label><span className="sr-only">Продукт в календаре</span><select aria-label="Продукт в календаре" value={product} onChange={event => setSearch(current => { const next = new URLSearchParams(current); if (event.target.value === "all") next.delete("product"); else next.set("product", event.target.value); return next; })}><option value="all">Все продукты</option>{bankLoans.map((loan, index) => <option key={loan.loan_id} value={`loan:${loan.loan_id}`}>Действующий кредит {index + 1} · {formatMoney(loan.outstanding_principal || "0")}</option>)}{calendar.data?.accounts.map(account => <option key={account.application_id} value={`app:${account.application_id}`}>{financingName(account.product_id)} · {formatMoney(account.amount)} · {account.application_id.slice(0, 6)}</option>)}</select></label></div>
      </div>
      {!timelineView && <div className="payment-calendar-toolbar">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label={listView ? "Предыдущая неделя" : "Предыдущий месяц"} onClick={() => selectDate(listView ? new Date(weekStart.getTime() - 7 * 86400000).toISOString().slice(0,10) : shiftMonth(month, -1) + "-01")}><ChevronLeft /></Button>
          <h2 className="min-w-0 text-xl font-semibold capitalize" aria-live="polite">{listView ? `${dateLabel(weekDates[0], { day: "numeric", month: "short" })} — ${dateLabel(weekDates[6], { day: "numeric", month: "short", year: "numeric" })}` : dateLabel(`${month}-01`, { month: "long", year: "numeric" })}</h2>
          <Button variant="outline" size="icon" aria-label={listView ? "Следующая неделя" : "Следующий месяц"} onClick={() => selectDate(listView ? new Date(weekStart.getTime() + 7 * 86400000).toISOString().slice(0,10) : shiftMonth(month, 1) + "-01")}><ChevronRight /></Button>
        </div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => selectDate(today)}>Сегодня</Button>
          {nextPayment && <Button variant="outline" size="sm" onClick={() => selectDate(nextPayment.date)}>К ближайшему платежу</Button>}</div>
      </div>}
      {!timelineView && <div className="calendar-legend"><span className="calendar-inflow">● Поступления</span><span className="calendar-outflow">● Расходы и погашение</span><span>По плану — ожидаемое событие</span></div>}
      {timelineView ? calendar.data ? <PaymentTimeline calendar={calendar.data} profile={profile.data} events={events} products={calendarProducts} productScope={product} selectedDate={selectedDate} onSelectDate={selectDate} canCalculatePenalty={Boolean(profile.data) && !calendar.error && !profile.error} /> : <p role="status">Загружаем таймлайн…</p> : listView ? <div className="calendar-week-list" aria-label="Платежи за неделю">{weekDates.map(date => { const rows = events.filter(item => item.date === date); return <section key={date} className={date === selectedDate ? "calendar-week-selected" : ""}><button type="button" aria-pressed={date === selectedDate} onClick={() => selectDate(date)}>{dateLabel(date, { weekday: "short", day: "numeric", month: "long" })}<span>{rows.length ? `${rows.length} событий` : "Нет событий"}</span></button>{rows.map(event => <EventDetails key={event.event_id} event={event}/>)}{date === selectedDate && dayPaymentActions}</section>; })}</div> : <div className="payment-calendar-layout"><div><div className="payment-calendar-grid" aria-label="Календарь на месяц">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map(day => <div key={day} className="calendar-weekday">{day}</div>)}
        {Array.from({ length: offset }, (_, index) => <div key={`empty-${index}`} className="calendar-empty" aria-hidden="true" />)}
        {days.map(date => {
          const rows = monthEvents.filter(event => event.date === date);
          return <button key={date} data-date={date} type="button" className={`calendar-day ${date === today ? "calendar-today" : ""}`} aria-pressed={date === selectedDate} aria-label={`${dateLabel(date, { day: "numeric", month: "long" })}, событий: ${rows.length}`} onClick={() => selectDate(date)}>
            <span className="calendar-day-number">{Number(date.slice(-2))}</span>
            {rows.length > 0 && <span className="calendar-day-dot" aria-hidden="true" />}
            {rows.slice(0, 2).map(event => <span key={event.event_id} className={`calendar-event calendar-${event.direction}`}><strong>{amountLabel(event)}</strong><span>{event.title}</span></span>)}
            {rows.length > 2 && <span className="calendar-more">Ещё {rows.length - 2}</span>}
          </button>;
        })}
      </div>
      {!monthEvents.length && !calendar.isLoading && <p className="rounded-xl bg-secondary p-4 text-sm text-muted-foreground">В этом месяце событий нет. Выберите другой месяц.</p>}
      </div><aside className="calendar-day-details" aria-label="События выбранного дня">
        <p className="calendar-detail-kicker">ВЫБРАННАЯ ДАТА</p>
        <h3 aria-live="polite">{dateLabel(selectedDate, { day: "numeric", month: "long" })}</h3>
        {selectedEvents.length ? selectedEvents.map(event => <EventDetails key={event.event_id} event={event} />) : <p className="text-sm text-muted-foreground">На этот день событий нет.</p>}
        {dayPaymentActions}
      </aside></div>}

    </CardContent></Card>
    <Link className="calendar-portfolio-link" to="/cabinet?mode=portfolio">Управлять продуктами и вносить платежи<ChevronRight size={16} /></Link>
  </div>;
}
