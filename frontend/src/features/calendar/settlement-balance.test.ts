import {describe,expect,it} from "vitest";
import type {CalendarData,CalendarEvent} from "./api";
import {settlementSeries} from "./settlement-balance";
import {timelineProducts,productDays,contractSegment} from "./payment-timeline-model";
const event=(id:string,date:string,amount:string,direction:"inflow"|"outflow",forecast=false):CalendarEvent=>({event_id:id,application_id:"credit",date,amount,direction,forecast,kind:forecast?"loan_payment":"account_movement",title:"Операция"});
const calendar:CalendarData={today:"2026-10-24",accounts:[],plans:[],payment_orders:[],penalty_terms:[],events:[event("due","2026-10-25","50.10","outflow",true)],settlement_account:{balance:"100.10",as_of:"2026-10-24",events:[event("receipt","2026-10-23","100.20","inflow"),event("payment","2026-10-24","0.10","outflow")]}};
describe("settlement account",()=>{
 it("reconstructs past balances and forecasts from current cash without adding unused limits",()=>{
  expect(settlementSeries(calendar,["2026-10-22","2026-10-23","2026-10-24","2026-10-25"])).toEqual([
   {date:"2026-10-22",balance:"0.00",forecast:false},{date:"2026-10-23",balance:"100.20",forecast:false},{date:"2026-10-24",balance:"100.10",forecast:false},{date:"2026-10-25",balance:"50.00",forecast:true}]);
 });
 it("does not count duplicate installments, hypothetical draft plans or informational limit openings",()=>{
  const duplicated={...calendar,events:[...calendar.events,...calendar.events,event("limit","2026-10-25","1000000","inflow",true)]};
  expect(settlementSeries(duplicated,["2026-10-25"])[0].balance).toBe("50.00");
 });
 it("keeps cent precision and permits a negative forecast",()=>{
  expect(settlementSeries({...calendar,settlement_account:{...calendar.settlement_account!,balance:"0.10"}},["2026-10-25"])[0].balance).toBe("-50.00");
 });
 it("keeps inflows and outflows separately clickable on the same day",()=>{
  const data={...calendar,settlement_account:{...calendar.settlement_account!,events:[event("a","2026-10-24","20.00","inflow"),event("b","2026-10-24","10.00","outflow")]}};
  const row=timelineProducts(data,undefined,[],"all")[0];
  expect(row.settlement).toBe(true);expect(productDays(row,["2026-10-24"])).toHaveLength(2);
  expect(contractSegment(row,["2026-10-24"])).toBeNull();
  expect(timelineProducts(data,undefined,[],"app:credit")).toHaveLength(0);
  const week=productDays(row,["2026-10-24"],true);
  expect(week).toHaveLength(2);expect(week[0].date).toBe("2026-10-19");expect(week[0].endDate).toBe("2026-10-25");
 });
});
