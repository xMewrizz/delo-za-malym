import {useMemo,useState,type KeyboardEvent} from "react";
import {formatMoneyPrecise} from "@/shared/lib/format";
import type {CalendarData} from "./api";
import {settlementSeries} from "./settlement-balance";
import "./settlement-balance.css";

const dateLabel=(date:string)=>new Date(date+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"});
export function SettlementBalanceChart({calendar,days,selectedDate,onInspect}:{calendar:CalendarData;days:string[];selectedDate:string;onInspect:(date:string,trigger?:HTMLElement)=>void}) {
  const [hover,setHover]=useState<string|null>(null);
  const points=useMemo(()=>settlementSeries(calendar,days),[calendar,days]);
  if(!points.length) return null;
  const active=points.findIndex(point=>point.date===(hover||selectedDate));
  const index=active<0?0:active,point=points[index];
  const shortfall=point.forecast&&Number(point.balance)<0;
  const hasShortfall=points.some(item=>item.forecast&&Number(item.balance)<0);
  const values=points.map(item=>Number(item.balance)),low=Math.min(0,...values),high=Math.max(1,...values),span=high-low||1;
  const x=(i:number)=>10+i/Math.max(1,points.length-1)*980,y=(amount:number)=>116-(amount-low)/span*94;
  const path=(items:typeof points,offset:number)=>items.map((item,i)=>`${i?"L":"M"}${x(i+offset).toFixed(2)},${y(Number(item.balance)).toFixed(2)}`).join(" ");
  const boundary=points.findIndex(item=>item.forecast),actual=boundary<0?points:points.slice(0,boundary),future=boundary<0?[]:points.slice(Math.max(0,boundary-1));
  function keyDown(event:KeyboardEvent<HTMLDivElement>) {
    const offset=event.key==="ArrowRight"||event.key==="ArrowUp"?1:event.key==="ArrowLeft"||event.key==="ArrowDown"?-1:0;
    if(offset||event.key==="Home"||event.key==="End") {event.preventDefault();setHover(points[event.key==="Home"?0:event.key==="End"?points.length-1:Math.max(0,Math.min(points.length-1,index+offset))].date);}
    if(event.key==="Enter"||event.key===" ") {event.preventDefault();onInspect(point.date,event.currentTarget);}
  }
  return <section className="settlement-balance" aria-label="Остаток денег по дням">
    <header><div><h3>{shortfall?"Не хватает на платежи":"Остаток на счёте"}</h3><p>{dateLabel(point.date)} · {point.date===calendar.today?"сейчас":point.forecast?"без новых поступлений":"после операций дня"}</p></div><strong data-negative={Number(point.balance)<0}>{formatMoneyPrecise(shortfall?point.balance.slice(1):point.balance)}</strong></header>
    <div className="settlement-balance-plot" role="slider" tabIndex={0} aria-label="Дата на графике остатка. Стрелки — выбрать день, Enter — события" aria-valuemin={0} aria-valuemax={points.length-1} aria-valuenow={index} aria-valuetext={`${dateLabel(point.date)}: ${shortfall?"не хватает ":""}${formatMoneyPrecise(shortfall?point.balance.slice(1):point.balance)}`} onKeyDown={keyDown} onPointerLeave={()=>setHover(null)} onPointerMove={event=>{const bounds=event.currentTarget.getBoundingClientRect();setHover(points[Math.max(0,Math.min(points.length-1,Math.round((event.clientX-bounds.left)/bounds.width*(points.length-1))))].date);}} onClick={event=>{const bounds=event.currentTarget.getBoundingClientRect();const target=points[Math.max(0,Math.min(points.length-1,Math.round((event.clientX-bounds.left)/bounds.width*(points.length-1))))];onInspect(target.date,event.currentTarget);}}>
      <svg viewBox="0 0 1000 136" preserveAspectRatio="none" aria-hidden="true"><line className="settlement-zero" x1="10" x2="990" y1={y(0)} y2={y(0)}/>{actual.length>0&&<path className="settlement-line" d={path(actual,0)}/>} {future.length>0&&<path className="settlement-line settlement-line-forecast" d={path(future,Math.max(0,boundary-1))}/>}<line className="settlement-cursor" x1={x(index)} x2={x(index)} y1="12" y2="123"/><circle cx={x(index)} cy={y(values[index])} r="4"/></svg>
    </div>
    <footer><span>{dateLabel(days[0])}</span><span className="settlement-balance-note">{hasShortfall?"Без новых поступлений: минус — нехватка на платежи":points.some(item=>item.forecast)?"Прогноз без новых поступлений":"Фактические операции"}</span><span>{dateLabel(days.at(-1)!)}</span></footer>
  </section>;
}
