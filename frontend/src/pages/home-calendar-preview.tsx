import {useLayoutEffect,useRef,useState} from "react";
import {gsap} from "gsap";
import {ScrollTrigger} from "gsap/ScrollTrigger";
import {ArrowDownLeft,ArrowRight,ArrowUpRight,CalendarDays,ChartGantt,Wallet} from "lucide-react";
import {Link} from "react-router";
import {formatMoney} from "@/shared/lib/format";
import {openingCash,promoDay,promoMonth,promoOperations,type PromoOperation} from "./home-cashflow-example";
import "./home-calendar-preview.css";

gsap.registerPlugin(ScrollTrigger);
const weekdays=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const date=(day:number)=>`2026-11-${String(day).padStart(2,"0")}`;
const money=(amount:number)=>formatMoney(String(amount));
const signed=(amount:number)=>`${amount>0?"+":"−"}${money(Math.abs(amount))}`;
const days=Array.from({length:30},(_,index)=>index+1);
const chart=days.map(day=>({day,x:(day-1)/29*1000,y:100-(promoDay(day).balance-100_000)/220_000*85}));
const path=chart.map((point,index)=>`${index?"L":"M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
const tracks=[{id:"account",title:"Расчётный счёт",hint:"Поступления и расходы"},{id:"loan",title:"Оборотный кредит",hint:"Платежи по графику"},{id:"line",title:"Кредитная линия",hint:"Платежи по графику"}] as const;

function OperationDetails({operation}:{operation:PromoOperation}){
 return <div className="ep-flow-operation" data-direction={operation.amount>0?"in":"out"}><span className="ep-flow-operation-icon" aria-hidden="true">{operation.amount>0?<ArrowDownLeft size={16}/>:<ArrowUpRight size={16}/>}</span><div><strong>{operation.title}</strong>{operation.principal!==undefined&&<small>{money(operation.principal)} — долг<br/>{money(operation.interest!)} — проценты</small>}</div><strong>{signed(operation.amount)}</strong></div>;
}

/** One ledger across the balance chart, calendar and contract tracks. No autoplay dates. */
export function HomeCalendarPreview(){
 const [selected,setSelected]=useState(18);
 const [view,setView]=useState<"calendar"|"timeline">("calendar");
 const host=useRef<HTMLDivElement>(null),timelineScroll=useRef<HTMLDivElement>(null);
 const daily=promoDay(selected),weekStart=selected-((selected+5)%7);
 const week=Array.from({length:7},(_,index)=>weekStart+index).filter(day=>day>=1&&day<=30);
 useLayoutEffect(()=>{
  if(!window.matchMedia)return;
  const context=gsap.context(()=>{gsap.fromTo(".ep-flow-chart-reveal",{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0% 0 0)",duration:1.2,ease:"power2.out",clearProps:"clipPath",scrollTrigger:{trigger:host.current,start:"top 76%",once:true}});},host);
  return ()=>context.revert();
 },[]);
 useLayoutEffect(()=>{
  if(view!=="timeline"||!window.matchMedia?.("(max-width:700px)").matches)return;
  const area=timelineScroll.current;
  if(area)area.scrollLeft=Math.max(0,(selected-.5)/30*((area.firstElementChild?.clientWidth||730)-148)-Math.max(0,area.clientWidth-148)/2);
 },[view,selected]);
 const label=(day:number)=>`${day} ноября${promoDay(day).operations.length?promoDay(day).operations.map(operation=>`, ${operation.title}, ${signed(operation.amount)}`).join(""):", нет операций"}`;
 return <div className="ep-payment-preview ep-flow-preview" ref={host} data-view={view} aria-label="Пример движения денег и платежей">
  <div className="ep-flow-overview" data-depth="4">
   <div className="ep-flow-month-label"><span><CalendarDays size={16}/>Ноябрь 2026</span><small>Демонстрационный пример</small></div>
   <div className="ep-flow-month-numbers"><div><span><i data-direction="in"/>Поступления</span><strong className="ep-flow-income">+{money(promoMonth.income)}</strong></div><div><span><i data-direction="out"/>Списания</span><strong>−{money(promoMonth.expense)}</strong></div><div className="ep-flow-closing"><span>Остаток в конце месяца</span><strong>{money(promoMonth.closingCash)}</strong></div></div>
   <div className="ep-flow-chart" role="img" aria-label={`Прогноз остатка: с ${money(openingCash)} до ${money(promoMonth.closingCash)}. На ${selected} ноября — ${money(daily.balance)}.`}><div className="ep-flow-chart-reveal" aria-hidden="true"><svg viewBox="0 0 1000 116" preserveAspectRatio="none"><path className="ep-flow-chart-area" d={`${path} L1000,116 L0,116 Z`}/><path className="ep-flow-chart-line" d={path}/>{chart.filter(point=>promoDay(point.day).operations.length>0).map(point=><circle key={point.day} cx={point.x} cy={point.y} r="3" className={promoDay(point.day).income>0?"ep-flow-chart-in":"ep-flow-chart-out"}/>)}</svg></div><span className="ep-flow-chart-cursor" style={{left:`${(selected-1)/29*100}%`}} aria-hidden="true"><i style={{top:`${chart[selected-1].y/116*100}%`}}/></span></div>
   <div className="ep-flow-chart-axis" aria-hidden="true">{[1,8,15,22,30].map(day=><span key={day}>{day} ноя</span>)}</div>
  </div>
  <div className="ep-flow-workspace" data-depth="3">
   <div className="ep-payment-month">
    <div className="ep-payment-preview-toolbar"><div className="ep-payment-view-toggle" role="group" aria-label="Вид примера"><button type="button" aria-pressed={view==="calendar"} onClick={()=>setView("calendar")}><CalendarDays size={14}/>Календарь</button><button type="button" aria-pressed={view==="timeline"} onClick={()=>setView("timeline")}><ChartGantt size={14}/>Таймлайн</button></div><div className="ep-flow-legend"><span><i data-direction="in"/>Поступления</span><span><i data-direction="out"/>Списания</span></div></div>
    <div className="ep-flow-panel" hidden={view!=="calendar"}>
     <div className="ep-payment-preview-grid" aria-label="Ноябрь 2026 — календарь на месяц">{weekdays.map(day=><span className="ep-payment-weekday" key={day}>{day}</span>)}{Array.from({length:6},(_,index)=><span className="ep-payment-empty" key={`empty-${index}`} aria-hidden="true"/>)}{days.map(day=>{const value=promoDay(day);return <button key={day} type="button" className="ep-payment-day" aria-pressed={selected===day} aria-label={label(day)} onClick={()=>setSelected(day)} data-income={value.income>0} data-expense={value.expense>0}><span>{day}</span>{value.income>0&&<strong className="ep-flow-income">+{money(value.income)}</strong>}{value.expense>0&&<strong>−{money(value.expense)}</strong>}{value.operations.length>0&&<small>{value.operations.length>1?`${value.operations.length} списания`:value.operations[0].shortTitle}</small>}</button>;})}</div>
     <div className="ep-payment-preview-week" aria-label={`Операции с ${week[0]} по ${week.at(-1)} ноября`}>{week.map(day=>{const value=promoDay(day);return <button key={day} type="button" aria-pressed={selected===day} onClick={()=>setSelected(day)}><span>{day} ноября<small>{weekdays[(day+5)%7]}</small></span><span>{value.operations.length?value.operations.length>1?`${value.operations.length} списания`:value.operations[0].shortTitle:"Нет операций"}{value.income>0&&<strong className="ep-flow-income">+{money(value.income)}</strong>}{value.expense>0&&<strong>−{money(value.expense)}</strong>}</span></button>;})}</div>
    </div>
    <div className="ep-payment-timeline ep-flow-panel" hidden={view!=="timeline"} ref={timelineScroll} aria-label="Ноябрь 2026 — операции и договоры"><div className="ep-flow-timeline-canvas">
     <div className="ep-flow-timeline-header"><span>Счёт и продукты</span><div>{days.map(day=><button key={day} type="button" onClick={()=>setSelected(day)} aria-label={`Выбрать ${day} ноября`} aria-pressed={selected===day}><span>{day}</span></button>)}</div></div>
     {tracks.map(track=><div className="ep-flow-timeline-row" key={track.id} data-account={track.id==="account"}><h4>{track.title}<small>{track.hint}</small></h4><div className="ep-flow-timeline-track"><span className="ep-flow-timeline-selected" style={{left:`${(selected-1)/30*100}%`}} aria-hidden="true"/>{track.id!=="account"&&<span className="ep-flow-contract" aria-hidden="true"/>}{promoOperations.filter(operation=>operation.track===track.id).map(operation=><button key={operation.id} type="button" className="ep-flow-milestone" data-direction={operation.amount>0?"in":"out"} data-selected={selected===operation.day} data-edge={operation.day<7?"start":operation.day>25?"end":undefined} style={{left:`${(operation.day-.5)/30*100}%`}} aria-label={`${operation.day} ноября, ${operation.title}, ${signed(operation.amount)}`} aria-pressed={selected===operation.day} onClick={()=>setSelected(operation.day)}><i aria-hidden="true">{track.id==="account"?operation.amount>0?"+":"−":null}</i><span className="ep-flow-event-tooltip" aria-hidden="true"><strong>{signed(operation.amount)}</strong><small>{operation.day} ноября</small></span></button>)}</div></div>)}
    </div></div>
   </div>
   <aside className="ep-payment-day-card" aria-label="Операции выбранного дня"><div className="ep-flow-day-content" key={selected} aria-live="polite"><div className="ep-flow-day-heading"><span>{selected} ноября</span><Wallet size={18} aria-hidden="true"/></div><p className="ep-flow-balance-label">Остаток после операций</p><strong className="ep-flow-day-balance">{money(daily.balance)}</strong><div className="ep-flow-day-totals"><span>Пришло<strong className={daily.income>0?"ep-flow-income":undefined}>{daily.income>0?"+":""}{money(daily.income)}</strong></span><span>Ушло<strong>{daily.expense>0?"−":""}{money(daily.expense)}</strong></span></div><div className="ep-flow-operations">{daily.operations.length?daily.operations.map(operation=><OperationDetails key={operation.id} operation={operation}/>):<p className="ep-payment-no-events">На эту дату операций нет. Остаток сохранится с предыдущего дня.</p>}</div></div><Link to={`/cabinet?mode=calendar&view=${view}&date=${date(selected)}`}>Открыть календарь<ArrowRight size={15}/></Link></aside>
  </div>
 </div>;
}
