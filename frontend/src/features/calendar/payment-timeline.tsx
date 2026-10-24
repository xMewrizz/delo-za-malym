import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type UIEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link } from "react-router";
import { Dialog } from "radix-ui";
import type { Profile } from "@/features/applications";
import { Button } from "@/shared/ui/button";
import { DatePicker } from "@/shared/ui/date-picker";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { isDebtObligation, type CalendarData, type CalendarEvent } from "./api";
import { PenaltyPlanner, type CalendarProduct } from "./penalty-planner";
import { EventDetails } from "./calendar-event-details";
import { contractSegment, productDays, shiftDay, shiftTimelineMonth, sumTimelineAmounts, timelineMarkerLanes, timelineProducts } from "./payment-timeline-model";
import { installTimelinePan } from "./timeline-pan";
import "./payment-timeline.css";

const BUFFER_BEFORE = 366;
const BUFFER_DAYS = 1098;

type Inspection = { kind: "day"; date: string; productId?: string } | { kind: "product"; productId: string };

const label = (value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) => new Date(value + "T12:00:00Z").toLocaleDateString("ru-RU", { ...options, timeZone: "UTC" });

export function PaymentTimeline({ calendar, profile, events, products, productScope, selectedDate, onSelectDate, canCalculatePenalty }: {
  calendar: CalendarData; profile?: Profile; events: CalendarEvent[]; products: CalendarProduct[]; productScope: string;
  selectedDate: string; onSelectDate: (date: string) => void; canCalculatePenalty: boolean;
}) {
  const [months, setMonths] = useState(1);
  const [start, setStart] = useState(() => shiftDay(selectedDate.slice(0, 7) + "-01", -BUFFER_BEFORE));
  const [viewStart, setViewStart] = useState(selectedDate.slice(0, 7) + "-01");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [previousScope, setPreviousScope] = useState(productScope);
  const [recenterVersion, setRecenterVersion] = useState(0);

  const detailsId = useId();
  const canvas = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const pan = useRef<ReturnType<typeof installTimelinePan> | null>(null);
  const rebasePixels = useRef<number | null>(null);
  const jumpTo = useRef<string | null>(selectedDate.slice(0, 7) + "-01");
  const lastSelection = useRef(selectedDate);
  const [observedDate, setObservedDate] = useState(selectedDate);
  const windowDays = months === 1 ? 30 : 90;
  const days = useMemo(() => [...new Set(Array.from({ length: BUFFER_DAYS }, (_, index) => shiftDay(start, index)))], [start]);
  const viewEnd = shiftDay(viewStart, windowDays - 1);
  if (previousScope !== productScope) { setPreviousScope(productScope); setInspection(null); }
  if (observedDate !== selectedDate) {
    setObservedDate(selectedDate);
    if (inspection?.kind === "day" && inspection.date !== selectedDate) setInspection(null);
    if (selectedDate < start || selectedDate > days.at(-1)!) setStart(shiftDay(selectedDate, -BUFFER_BEFORE));
  }
  function dayWidth() {
    const track = canvas.current?.querySelector<HTMLElement>(".payment-timeline-days");
    return track ? track.getBoundingClientRect().width / track.children.length : 0;
  }
  useLayoutEffect(() => {
    const scroller = canvas.current;
    if (!scroller) return;
    const selectionChanged = lastSelection.current !== selectedDate;
    lastSelection.current = selectedDate;
    if (rebasePixels.current != null) {
      const offset = rebasePixels.current; rebasePixels.current = null;
      if (pan.current) pan.current.shift(offset); else scroller.scrollLeft += offset;
      return;
    }
    const jumped = Boolean(jumpTo.current);
    if (jumpTo.current) {
      const date = jumpTo.current; jumpTo.current = null;
      pan.current?.stop();
      scroller.scrollLeft = Math.max(0, days.indexOf(date)) * dayWidth();
    }
    const button = scroller.querySelector<HTMLButtonElement>(`[data-timeline-date="${selectedDate}"]`);
    if (!button) return;
    if (pendingFocus.current === selectedDate) { button.focus({ preventScroll: true }); pendingFocus.current = null; }
    // Selecting an on-screen day must not move the timeline. Only explicit navigation recentres it.
    if ((recenterVersion || selectionChanged) && !jumped) {
      const bounds = scroller.getBoundingClientRect(), target = button.getBoundingClientRect();
      const stickyWidth = scroller.querySelector(".payment-timeline-corner")?.getBoundingClientRect().width || 0;
      if (target.left < bounds.left + stickyWidth || target.right > bounds.right) {
        pan.current?.stop();
        scroller.scrollLeft += (target.left + target.right) / 2 - (bounds.left + stickyWidth + (bounds.width - stickyWidth) / 2);
      }
    }
  }, [selectedDate, start, months, recenterVersion, days]);
  useEffect(() => {
    if (!canvas.current) return;
    const controller = installTimelinePan(canvas.current, () => {
      const track = canvas.current?.querySelector<HTMLElement>(".payment-timeline-days");
      return track ? track.getBoundingClientRect().width / track.children.length : 0;
    });
    pan.current = controller;
    return () => { controller.dispose(); pan.current = null; };
  }, []);
  function onPan(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget, unit = dayWidth();
    if (!unit || rebasePixels.current != null) return;
    const first = Math.max(0, Math.min(days.length - 1, Math.floor(scroller.scrollLeft / unit)));
    setViewStart(days[first]);
    // Replace dates far outside the viewport, preserving the pixel position of every visible day.
    const shift = first < 180 ? -BUFFER_BEFORE : first > days.length - 366 - windowDays ? BUFFER_BEFORE : 0;
    if (!shift) return;
    const next = shiftDay(start, shift);
    if (next === start) return;
    rebasePixels.current = (Date.parse(start) - Date.parse(next)) / 86400000 * unit;
    setStart(next);
  }
  const rows = timelineProducts(calendar, profile, events, productScope).filter(row => !row.planned);
  const visibleRows = rows;
  const selectedRow = inspection?.productId ? rows.find(row => row.id === inspection.productId) : undefined;
  const inspectedDate = inspection?.kind === "day" ? inspection.date : selectedDate;
  const dayEvents = [...new Map((selectedRow ? selectedRow.events : events).filter(event => event.date === inspectedDate).map(event => [event.event_id, event])).values()];
  const nextPayment = events.find(event => event.date >= calendar.today && isDebtObligation(event));
  const selectedIndex = days.indexOf(selectedDate);
  const monthGroups = useMemo(() => [...new Set(days.map(date => date.slice(0, 7)))].map(month => ({ month, count: days.filter(date => date.startsWith(month)).length })), [days]);
  const ticks = useMemo(() => days.map(date => ({ number: Number(date.slice(-2)), weekday: label(date, { weekday: "short" }), title: label(date, { day: "numeric", month: "long", year: "numeric" }), accessible: label(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) })), [days]);
  const selectDay = (date: string) => { pan.current?.stop(); if (!days.includes(date)) { jumpTo.current = date; setStart(shiftDay(date, -BUFFER_BEFORE)); } setRecenterVersion(value => value + 1); onSelectDate(date); };
  function inspectDay(date: string, productId?: string, trigger?: HTMLElement) {
    returnFocus.current = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    selectDay(date);
    setInspection({ kind: "day", date, productId });
  }
  function inspectProduct(productId: string, trigger: HTMLElement) {
    returnFocus.current = trigger;
    setInspection({ kind: "product", productId });
  }
  function pointDate(event: MouseEvent<HTMLElement>) {
    const track = event.currentTarget.closest<HTMLElement>(".payment-timeline-track")!;
    const rect = track.getBoundingClientRect();
    return event.detail > 0 && rect.width > 0 ? days[Math.min(days.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * days.length)))] : selectedDate;
  }
  function page(direction: number) { const next = shiftTimelineMonth(viewStart, months * direction); jumpTo.current = next; setViewStart(next); setStart(shiftDay(next, -BUFFER_BEFORE)); selectDay(next); }
  function changeScale(count: number) { pan.current?.stop(); jumpTo.current = viewStart; setStart(shiftDay(viewStart, -BUFFER_BEFORE)); setMonths(count); }
  function focusDate(date: string) {
    pendingFocus.current = date;
    setInspection(null);
    selectDay(date);
  }
  const detailEvents = inspection?.kind === "product" && selectedRow ? selectedRow.events.filter(event => event.date >= viewStart && event.date <= viewEnd) : dayEvents;
  const plannedOut = sumTimelineAmounts(dayEvents.filter(event => event.forecast && event.direction === "outflow"));
  return <section className="payment-timeline" aria-label="Таймлайн финансирования">
    <div className="payment-timeline-tools"><div className="payment-timeline-period"><Button variant="outline" size="icon" aria-label="Предыдущий период таймлайна" onClick={() => page(-1)}><ChevronLeft size={17} /></Button><h2 aria-live="polite">{`${label(viewStart, { day: "numeric", month: "short" })} — ${label(viewEnd, { day: "numeric", month: "short", year: "numeric" })}`}</h2><Button variant="outline" size="icon" aria-label="Следующий период таймлайна" onClick={() => page(1)}><ChevronRight size={17} /></Button></div><div className="payment-timeline-range" role="group" aria-label="Масштаб таймлайна">{[1, 3].map(count => <button type="button" key={count} aria-pressed={months === count} onClick={() => changeScale(count)}>{count === 1 ? "Месяц" : "3 месяца"}</button>)}</div></div>
    <div className="payment-timeline-jump"><DatePicker id="timeline-date" label="Перейти к дате" value={selectedDate} onChange={date => inspectDay(date)} /><div><Button variant="ghost" size="sm" onClick={event => inspectDay(calendar.today, undefined, event.currentTarget)}>Сегодня</Button>{nextPayment && <Button variant="outline" size="sm" onClick={event => inspectDay(nextPayment.date, undefined, event.currentTarget)}>К ближайшему платежу</Button>}</div></div>
    <p className="payment-timeline-hint">Даты — колесом над шкалой или Shift + колесо. Над названиями колесо прокручивает страницу.</p>
    <div className="payment-timeline-layout">
      <div className="payment-timeline-board"><div className="payment-timeline-scroll" ref={canvas} onScroll={onPan} tabIndex={0} role="region" aria-label="Шкала дат и продуктов. Колесо над шкалой прокручивает даты"><div className="payment-timeline-canvas" data-months={months} style={{ "--tl-count": days.length, "--tl-window-days": windowDays } as CSSProperties}>
        <div className="payment-timeline-axis"><div className="payment-timeline-corner">Продукты · {rows.length}</div><div className="payment-timeline-dates"><div className="payment-timeline-months">{monthGroups.map(group => <span key={group.month} style={{ gridColumn: `span ${group.count}` }}><span>{label(group.month + "-01", { month: "long", year: "numeric" })}</span></span>)}</div><div className="payment-timeline-days">{days.map((date, index) => <button key={date} data-tick={index % 7 === 0 && Math.abs(index - selectedIndex) > 2} data-timeline-date={date} title={ticks[index].title} type="button" tabIndex={date === selectedDate || (selectedIndex < 0 && index === 0) ? 0 : -1} aria-pressed={date === selectedDate} aria-current={date === calendar.today ? "date" : undefined} aria-label={`${ticks[index].accessible}${date === calendar.today ? ", сегодня" : ""}`} onClick={event => inspectDay(date, undefined, event.currentTarget)} onKeyDown={event => {
          const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          let next = event.key in offsets ? shiftDay(date, offsets[event.key]) : event.key === "Home" ? viewStart : event.key === "End" ? viewEnd : null;
          if (event.key === "PageUp" || event.key === "PageDown") next = shiftTimelineMonth(date, event.key === "PageUp" ? -1 : 1);
          if (next) { event.preventDefault(); focusDate(next); }
        }}><span>{ticks[index].number}</span><small>{ticks[index].weekday}</small></button>)}</div></div></div>
        {visibleRows.map(row => { const milestones = productDays(row, days), lanes = timelineMarkerLanes(milestones.map(day => day.date), months === 3 ? 3 : 1), segment = contractSegment(row, days), total = sumTimelineAmounts(row.events.filter(event => days.includes(event.date) && isDebtObligation(event))); return <div className="payment-timeline-row" key={row.id} data-product-id={row.id} data-active={selectedRow?.id === row.id}>
          <button type="button" className="payment-timeline-product" aria-label={`Условия: ${row.title}, ${row.reference}`} title={`${row.title}, ${row.reference}`} aria-expanded={inspection?.kind === "product" && selectedRow?.id === row.id} aria-controls={detailsId} onClick={event => inspectProduct(row.id, event.currentTarget)}><strong>{row.title}</strong><small>{row.status === "refinanced" ? "Погашен рефинансированием" : row.status === "closed" ? "Погашен" : row.limit ? `Лимит ${formatMoney(row.limit)}` : row.principal != null ? `Долг ${formatMoney(row.principal)}` : Number(total) > 0 ? `${formatMoney(total)} к оплате` : row.planned ? "Поступления и расходы" : "Нет данных о долге"}</small></button>
          <div className="payment-timeline-track"><button className="payment-timeline-date-hit" type="button" onMouseDown={event => event.preventDefault()} aria-label={`Выбрать дату на шкале ${row.title}, ${row.reference}`} tabIndex={-1} onClick={event => inspectDay(pointDate(event), row.id, event.currentTarget)} />{selectedIndex >= 0 && <i className="payment-timeline-selection" style={{ left: `${selectedIndex / days.length * 100}%`, width: `${100 / days.length}%` }} aria-hidden="true" />}
            {segment && <button type="button" className="payment-timeline-contract" tabIndex={-1} onMouseDown={event => event.preventDefault()} data-left-continuation={segment.continuesBefore} data-right-continuation={segment.continuesAfter} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} aria-label={`Подробности: ${row.title}, ${row.reference}${row.maturity ? `, окончание ${label(row.maturity, { day: "numeric", month: "long", year: "numeric" })}` : ", дата окончания не передана"}`} aria-controls={detailsId} onClick={event => inspectProduct(row.id, event.currentTarget)}></button>}
            {milestones.map((day, index) => <button key={day.date} type="button" className="payment-timeline-milestone" tabIndex={day.date >= viewStart && day.date <= viewEnd ? 0 : -1} data-paid={day.events.every(event => !event.forecast)} data-selected={day.date === selectedDate} data-payment={Number(day.payment) > 0} data-overdue={day.events.some(event => isDebtObligation(event) && event.date < calendar.today)} style={{ left: `${(days.indexOf(day.date) + .5) / days.length * 100}%`, "--tl-lane": lanes[index] } as CSSProperties} aria-label={`${row.title}, ${row.reference}: ${label(day.date)}, ${day.events.length} событий${Number(day.payment) > 0 ? `, к оплате ${formatMoneyPrecise(day.payment)}` : ""}`} onClick={event => inspectDay(day.date, row.id, event.currentTarget)}><i aria-hidden="true" /></button>)}
          </div>
        </div>; })}
        {!visibleRows.length && <div className="payment-timeline-empty">Нет продуктов для отображения. Выберите другой продукт или период.</div>}
      </div></div><div className="payment-timeline-legend"><span><i />Платёж по графику</span><span><i />Операция по счёту</span></div></div>
    </div>
    <Dialog.Root modal={false} open={Boolean(inspection && (!inspection.productId || selectedRow))} onOpenChange={open => { if (!open) setInspection(null); }}>
      <Dialog.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}>
        <Dialog.Content className="timeline-inspector" id={detailsId} ref={details} tabIndex={-1}
          onOpenAutoFocus={event => { event.preventDefault(); details.current?.focus({ preventScroll: true }); }}
          onCloseAutoFocus={event => { event.preventDefault(); (returnFocus.current?.isConnected ? returnFocus.current : canvas.current)?.focus({ preventScroll: true }); }}
          onFocusOutside={event => event.preventDefault()}
          onInteractOutside={event => { const target = event.target instanceof Element ? event.target : null; if (document.querySelector(".penalty-dialog") || target?.closest(".payment-timeline")) event.preventDefault(); }}>
          <header><div><p>{inspection?.kind === "product" ? "УСЛОВИЯ ДОГОВОРА" : "СОБЫТИЯ ДНЯ"}</p><Dialog.Title aria-live="polite">{inspection?.kind === "product" ? selectedRow?.title : label(inspectedDate, { day: "numeric", month: "long", year: "numeric" })}</Dialog.Title><Dialog.Description>{selectedRow ? `${inspection?.kind === "day" ? selectedRow.title + " · " : ""}${selectedRow.reference}` : "Все продукты"}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Закрыть подробности"><X size={18} /></Button></Dialog.Close></header>
          <div className="timeline-inspector-body">
            {inspection?.kind === "product" && selectedRow ? <><dl className="payment-timeline-product-facts">{!selectedRow.planned && <><div><dt>Основной долг</dt><dd>{selectedRow.principal == null ? "Не передан" : formatMoneyPrecise(selectedRow.principal)}</dd></div>{selectedRow.limit && <div><dt>Открытый лимит</dt><dd>{formatMoney(selectedRow.limit)}</dd></div>}{selectedRow.available != null && <div><dt>Свободно в лимите</dt><dd>{formatMoney(selectedRow.available)}</dd></div>}<div><dt>Открытие</dt><dd>{selectedRow.opened ? label(selectedRow.opened, { day: "numeric", month: "short", year: "numeric" }) : "Дата не передана"}</dd></div><div><dt>Окончание</dt><dd>{selectedRow.maturity ? label(selectedRow.maturity, { day: "numeric", month: "short", year: "numeric" }) : "Дата не передана"}</dd></div></>}</dl><p className="payment-timeline-events-title">Операции за выбранный период</p></> : <div className="payment-timeline-day-total"><span>К оплате</span><strong>{formatMoneyPrecise(plannedOut)}</strong></div>}
            <div className="payment-timeline-event-list">{detailEvents.length ? detailEvents.map(event => <EventDetails key={event.event_id} event={event} today={calendar.today} />) : <p>На выбранную дату или период событий нет.</p>}</div>
          </div>
          <footer className="payment-timeline-detail-actions">{canCalculatePenalty && <PenaltyPlanner calendar={calendar} products={products} targetDate={inspectedDate} productScope={selectedRow && !selectedRow.planned ? selectedRow.id : productScope} label="Рассчитать пени" />}{selectedRow?.applicationId && inspection?.kind === "product" && <Link to={selectedRow.productId === "overdraft" || ["closed", "refinanced"].includes(selectedRow.status) ? `/cabinet?mode=applications&application=${selectedRow.applicationId}` : `/cabinet?mode=portfolio&manage=${selectedRow.applicationId}&action=repay`}>{["closed", "refinanced"].includes(selectedRow.status) ? "Условия и история" : selectedRow.productId === "overdraft" ? "Условия продукта" : "Открыть продукт"}<ChevronRight size={15} aria-hidden="true" /></Link>}</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </section>;
}
