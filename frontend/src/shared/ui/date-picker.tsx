import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import "./date-picker.css";

const iso = (day: Date) => day.toISOString().slice(0, 10);
const parse = (value: string) => new Date(value + "T12:00:00Z");
const monthStart = (value: string) => value.slice(0, 7) + "-01";
const addMonth = (value: string, count: number) => {
  const day = parse(value), original = day.getUTCDate();
  day.setUTCDate(1); day.setUTCMonth(day.getUTCMonth() + count);
  const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  day.setUTCDate(Math.min(original, last)); return iso(day);
};
const label = (value: string) => parse(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function DatePicker({ id, label: title, value, onChange, min, max, disabled, hint }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  min?: string; max?: string; disabled?: boolean; hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(value));
  const [focused, setFocused] = useState(value);
  const content = useRef<HTMLDivElement>(null);
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);
  useEffect(() => { if (open) content.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus(); }, [focused, open]);
  function select(day: string) { onChange(day); setOpen(false); }
  function move(event: KeyboardEvent, day: string) {
    let next = parse(day);
    const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in offset) next.setUTCDate(next.getUTCDate() + offset[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") next = parse(addMonth(day, event.key === "PageUp" ? -1 : 1));
    else if (event.key === "Home" || event.key === "End") next.setUTCDate(next.getUTCDate() + (event.key === "Home" ? 0 : 6) - ((next.getUTCDay() + 6) % 7));
    else return;
    event.preventDefault();
    const candidate = iso(next);
    if (!allowed(candidate)) return;
    if (candidate < month || candidate >= addMonth(month, 2)) setMonth(monthStart(candidate));
    setFocused(candidate);
  }
  function navigate(count: number) {
    const next = addMonth(month, count);
    setMonth(next);
    const target = count < 0 && min && next < min ? min : next;
    setFocused(max && target > max ? max : target);
  }
  return <div className="form-field bank-date-field"><label htmlFor={id}>{title}</label>
    <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (next) { setMonth(monthStart(value)); setFocused(value); } }}>
      <Popover.Trigger asChild><Button id={id} type="button" variant="outline" className="bank-date-trigger" disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined}><CalendarDays size={17} />{label(value)}<ChevronRight size={15} /></Button></Popover.Trigger>
      <Popover.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}>
        <Popover.Content className="bank-date-picker" sideOffset={8} align="start" collisionPadding={12} aria-label={title} ref={content} onOpenAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => content.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus()); }}>
          <header><span>ДАТА ОПЕРАЦИИ</span><strong>{label(value)}</strong></header>
          <div className="bank-date-navigation"><Button type="button" variant="ghost" size="icon" aria-label="Предыдущий месяц" disabled={Boolean(min && addMonth(month, 1) <= monthStart(min))} onClick={() => navigate(-1)}><ChevronLeft size={17} /></Button><span>Выберите день</span><Button type="button" variant="ghost" size="icon" aria-label="Следующий месяц" disabled={Boolean(max && addMonth(month, 1) > monthStart(max))} onClick={() => navigate(1)}><ChevronRight size={17} /></Button></div>
          <div className="bank-date-months">{[month, addMonth(month, 1)].map(start => {
            const first = parse(start), offset = (first.getUTCDay() + 6) % 7;
            const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
            const cells = Array.from({ length: Math.ceil((days + offset) / 7) * 7 }, (_, index) => index >= offset && index < offset + days ? start.slice(0, 8) + String(index - offset + 1).padStart(2, "0") : null);
            const caption = first.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
            return <table role="grid" aria-label={caption} key={start}><caption>{caption}</caption><thead><tr>{weekdays.map(day => <th key={day} scope="col">{day}</th>)}</tr></thead><tbody>{Array.from({ length: cells.length / 7 }, (_, week) => <tr key={week}>{cells.slice(week * 7, week * 7 + 7).map((day, index) => <td key={day || index} aria-selected={day === value ? true : undefined}>{day && <button type="button" data-date={day} tabIndex={day === focused ? 0 : -1} disabled={!allowed(day)} aria-label={label(day)} onFocus={() => setFocused(day)} onKeyDown={event => move(event, day)} onClick={() => select(day)}>{Number(day.slice(8))}</button>}</td>)}</tr>)}</tbody></table>;
          })}</div>
          <footer><label htmlFor={`${id}-exact`}>Или введите дату</label><input id={`${id}-exact`} type="date" value={value} min={min} max={max} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && allowed(event.target.value)) select(event.target.value); }} /></footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>{hint && <p id={`${id}-hint`}>{hint}</p>}
  </div>;
}
