import {isDebtObligation,type CalendarData,type CalendarEvent} from "./api";

export const cents = (value:string) => {
  if(!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid account amount");
  const negative=value.startsWith("-"),[whole,fraction=""]=value.replace("-","").split(".");
  return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0")))*(negative?-1n:1n);
};
export const decimal = (value:bigint) => `${value<0?"-":""}${(value<0?-value:value)/100n}.${String((value<0?-value:value)%100n).padStart(2,"0")}`;
const signed = (event:CalendarEvent) => cents(event.amount)*(event.direction==="outflow"?-1n:event.direction==="inflow"?1n:0n);
export function accountForecast(calendar:CalendarData) {
  const seen=new Set<string>();
  return calendar.events.filter(event=>isDebtObligation(event)&&event.date>=calendar.today&&!seen.has(event.event_id)&&Boolean(seen.add(event.event_id)));
}
export function settlementSeries(calendar:CalendarData,days:string[]) {
  const account=calendar.settlement_account;
  if(!account) return [];
  const actual=account.events.filter(event=>!event.forecast&&event.date<=account.as_of);
  const forecast=accountForecast(calendar);
  const balance=cents(account.balance);
  return days.map(date=>{
    const delta=date<account.as_of
      ? -actual.filter(event=>event.date>date).reduce((sum,event)=>sum+signed(event),0n)
      : date>account.as_of ? forecast.filter(event=>event.date<=date).reduce((sum,event)=>sum+signed(event),0n):0n;
    return {date,balance:decimal(balance+delta),forecast:date>account.as_of};
  });
}
export function settlementEvents(calendar:CalendarData) {
  return [...(calendar.settlement_account?.events||[]),...accountForecast(calendar)];
}
