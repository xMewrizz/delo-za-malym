import { useLayoutEffect, useRef, useState } from "react";
import {gsap} from "gsap";
import {ScrollTrigger} from "gsap/ScrollTrigger";
import { ArrowRight, CalendarDays, ChartGantt } from "lucide-react";
import { Link } from "react-router";
import "./home-calendar-preview.css";

gsap.registerPlugin(ScrollTrigger);
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const payments: Record<number, { title: string; amount: string; principal: string; interest: string }> = {
  6: { title: "Кредитная линия", amount: "21 600 ₽", principal: "18 000 ₽", interest: "3 600 ₽" },
  13: { title: "Оборотный кредит", amount: "32 800 ₽", principal: "26 800 ₽", interest: "6 000 ₽" },
  18: { title: "Оборотный кредит", amount: "38 240 ₽", principal: "30 240 ₽", interest: "8 000 ₽" },
  27: { title: "Кредитная линия", amount: "21 600 ₽", principal: "18 000 ₽", interest: "3 600 ₽" },
};
const date = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

/** A compact, interactive example of the cabinet's month grid and selected-day card. */
export function HomeCalendarPreview() {
  const [selected, setSelected] = useState(18);
  const [view,setView] = useState<"calendar"|"timeline">("calendar");
  const host=useRef<HTMLDivElement>(null);
  const choose=(day:number)=>setSelected(day);
  useLayoutEffect(()=>{
    if(!window.matchMedia?.("(min-width:900px) and (pointer:fine)").matches)return;
    const context=gsap.context(()=>{
      gsap.from(".ep-payment-month",{y:16,opacity:.4,duration:1,ease:"power2.out",clearProps:"all",scrollTrigger:{trigger:host.current,start:"top 78%",once:true}});
    },host);return()=>context.revert();
  },[]);
  const payment = payments[selected];
  const weekStart = selected - ((selected + 5) % 7);
  const week = Array.from({ length: 7 }, (_, index) => weekStart + index).filter(day => day >= 1 && day <= 30);
  return <div className="ep-payment-preview" ref={host} data-view={view} aria-label="Пример платёжного календаря">
    <div className="ep-payment-month">
    <div className="ep-payment-preview-toolbar">
      <div><CalendarDays size={13} /><strong>Ноябрь 2026</strong></div>
      <div className="ep-payment-view-toggle" role="group" aria-label="Вид примера"><button type="button" aria-pressed={view==="calendar"} onClick={()=>setView("calendar")}><CalendarDays size={12}/>Календарь</button><button type="button" aria-pressed={view==="timeline"} onClick={()=>setView("timeline")}><ChartGantt size={12}/>Таймлайн</button></div>
    </div>
    <div className="ep-payment-preview-legend"><span><i />Расходы и погашение</span><span>Пример</span></div>
    <div className="ep-payment-preview-grid" hidden={view!=="calendar"} aria-label="Ноябрь 2026 — календарь на месяц">
      {weekdays.map(day => <span className="ep-payment-weekday" key={day}>{day}</span>)}
      {Array.from({ length: 6 }, (_, index) => <span className="ep-payment-empty" key={`empty-${index}`} aria-hidden="true" />)}
      {Array.from({ length: 30 }, (_, index) => index + 1).map(day => <button key={day} type="button" className="ep-payment-day" aria-pressed={selected === day} aria-label={`${day} ноября${payments[day] ? `, ${payments[day].title}, ${payments[day].amount}` : ", нет платежей"}`} onClick={() => choose(day)}>
        <span>{day}</span>{payments[day] && <><strong>{payments[day].amount}</strong><small>{payments[day].title}</small></>}
      </button>)}
    </div>
    <div className="ep-payment-preview-week" hidden={view!=="calendar"} aria-label={`Платежи за неделю с ${week[0]} по ${week.at(-1)} ноября`}>
      {week.map(day => <button key={day} type="button" aria-pressed={selected === day} onClick={() => choose(day)}><span>{day} ноября<small>{weekdays[(day + 5) % 7]}</small></span><span>{payments[day] ? payments[day].title : "Нет платежей"}{payments[day] && <strong>{payments[day].amount}</strong>}</span></button>)}
    </div>
    <div className="ep-payment-timeline" hidden={view!=="timeline"}>
      <div className="ep-payment-timeline-plot"><div className="ep-payment-timeline-axis">{[1,8,15,22,30].map(day=><span key={day} style={{left:`${(day-1)/29*100}%`}}>{day}</span>)}</div>
      <div className="ep-payment-timeline-rows">{[{title:"Оборотный кредит",days:[13,18]},{title:"Кредитная линия",days:[6,27]}].map(row=><div className="ep-payment-timeline-row" key={row.title}><h4>{row.title}<small>2 платежа в ноябре</small></h4><div>{row.days.map(day=><button type="button" key={day} style={{left:`${(day-1)/29*100}%`}} aria-label={`${day} ноября, ${row.title}, ${payments[day].amount}`} aria-pressed={selected===day} onClick={()=>choose(day)}><span>{payments[day].amount}</span><small>{day} ноября</small></button>)}</div></div>)}</div></div>
    </div>
    </div>
    <div className="ep-payment-day-card" aria-live="polite">
      <p>ВЫБРАННАЯ ДАТА</p><h4>{selected} ноября</h4>
      {payment ? <div className="ep-payment-detail"><div><strong>{payment.title}</strong><small>{payment.principal} — долг<br />{payment.interest} — проценты</small></div><strong>−{payment.amount}</strong></div> : <p className="ep-payment-no-events">На этот день событий нет.</p>}
      <div className="ep-payment-day-total"><span>К оплате в этот день</span><strong>{payment?.amount || "0 ₽"}</strong></div>
      {payment && <p className="ep-payment-cost-hint">Долг и проценты уже включены в платёж.</p>}
      <Link to={`/cabinet?mode=calendar&date=${date(selected)}`}>Открыть в кабинете<ArrowRight size={13} /></Link>
    </div>
  </div>;
}
