import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApplicationView } from "../api/applications";
import { BankDecisionTimeline } from "./bank-decision-timeline";

const view = (status="offers_ready") => ({events:[{type:"application_submitted",created_at:"2026-10-24T10:00:00+03:00"}],state:{status},result:{status:"assessed",assessment:{stage:"final",outcome:"approved",offers:[{}]},decision_trace:{application_version:3,calculated_at:"2026-10-24T10:00:00+03:00",policy_version:"demo-seasonal-v2",steps:[
 {id:"data",status:"calculated",values:{history_months:["2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"],sources:["Банковский профиль"],issues:[]}},
 {id:"risk",status:"calculated",values:{score:90,risk_grade:"low",components:[{code:"credit_history",points:50,max_points:50}]}},
 {id:"capacity",status:"calculated",values:{underwriting_cash_flow:"100000.00",total_debt_service_limit:"70000.00",existing_monthly_debt_service:"20000.00",available_monthly_payment:"50000.00",seasonal:true,replaced_debt_excluded:true}},
 {id:"product",status:"calculated",values:{policy:{minimum_amount:"100000.00",maximum_amount:"5000000.00",terms:[12,24],annual_rate_percent:"20.00"}}},
 {id:"result",status:"calculated",values:{outcome:"approved",reasons:[{message:"Долговая нагрузка в пределах правил."}],required_information:[],offers:[{amount:"300000.00",term_months:12}]}},
]}}} as unknown as ApplicationView);
describe("live decision explanation",()=>{
 it("connects the saved score, capacity, policy and decision without turning them into a new assessment",()=>{
  const html=renderToStaticMarkup(<BankDecisionTimeline view={view()}/>);
  expect(html).toContain('<details class="ui-disclosure bank-decision-reference">');
  expect(html).not.toContain('<details open');
  expect(html).toContain("90 из 100");expect(html).toContain("50 000 ₽ / мес.");
  expect(html).toContain("Платежи по заменяемым кредитам исключены");
  expect(html).toContain("Долговая нагрузка в пределах правил.");expect(html).toContain("версия заявки 3");
  expect((html.match(/decision-trace-step/g)||[])).toHaveLength(5);
 });
 it("distinguishes a conditional approval from an unconditional result",()=>{
  const conditional=view();
  const trace=conditional.result!.decision_trace as {steps:{values:{outcome?:string}}[]};
  trace.steps[4].values.outcome="conditional_approval";
  const html=renderToStaticMarkup(<BankDecisionTimeline view={conditional}/>);
  expect(html).toContain("Условия с дополнительными требованиями");
  expect(html).not.toContain("Условия доступны");
 });
 it("does not present a historical approval as the result of a cancelled application",()=>{
  const html=renderToStaticMarkup(<BankDecisionTimeline view={view("cancelled")}/>);
  expect(html).toContain("Заявка отменена");expect(html).not.toContain("Условия доступны");
 });
});
