// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,expect,it} from "vitest";
import {applicationViewSchema} from "../api/applications";
import {ApplicationOverview} from "./application-overview";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const source=()=>applicationViewSchema.parse({application:{application_id:"overview",application_version:1,need:{preferred_product:"investment_loan",requested_amount:"450000.00",term_months:36},financials:{}},client_data:{},state:{status:"waiting_for_data",application_version:1,next_action:{type:"provide_information",label:"Дополните сведения"}},result:{status:"assessed",assessment:{assessment_id:"a",stage:"final",outcome:"needs_information",offers:[]},decision_trace:{steps:[{id:"data",values:{checks:Object.fromEntries(["registration","restrictions","credit_history","obligations"].map(key=>[key,{status:"completed"}]))}},{id:"risk",status:"not_calculated",values:{}},{id:"capacity",status:"not_calculated",values:{}}]}},events:[{event_id:"received",type:"application_submitted",created_at:"2026-10-24T10:00:00+03:00"},{event_id:"review",type:"review_started",created_at:"2026-10-24T10:00:01+03:00"}],readiness:null,recommendation:null,completion:null,explorations:[]});
async function setup(reviewing=false,view=source()){
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<ApplicationOverview view={view} reviewing={reviewing}/>));
 return {host,cleanup:async()=>{await act(async()=>root.unmount());host.remove();}};
}
describe("application identity and review context",()=>{
 it("keeps the product, requested amount and term visible, and distinguishes received checks from uncalculated scoring",async()=>{
  const t=await setup();try{
   expect(t.host.querySelector("h2")?.textContent).toBe("Инвестиционный кредит");
   expect(t.host.querySelector("dl")?.textContent).toContain("450 000 ₽");
   expect(t.host.querySelector("dl")?.textContent).toContain("36 мес.");
   const steps=t.host.querySelectorAll(".application-review-stages li");
   expect(steps[1].getAttribute("data-state")).toBe("done");
   expect(steps[2].getAttribute("data-state")).toBe("attention");
   expect(steps[2].textContent).toContain("Ждём ваших уточнений");
   const button=t.host.querySelector("button")!;expect(button.getAttribute("aria-expanded")).toBe("false");
   await act(async()=>button.click());
   expect(button.getAttribute("aria-expanded")).toBe("true");
   expect(t.host.querySelector(".application-review-details")?.hasAttribute("hidden")).toBe(false);
   expect(t.host.querySelectorAll(".application-check-list [data-completed=true]")).toHaveLength(4);
   expect(t.host.querySelector(".application-event-list li")?.textContent).toContain("Начаты банковские проверки");
  }finally{await t.cleanup();}
 });
 it("does not reuse historical successful checks while a new review is running",async()=>{
  const t=await setup(true);try{
   expect(t.host.querySelector(".application-identity-status")?.textContent).toBe("На рассмотрении");
   expect(t.host.querySelectorAll('.application-review-stages [data-state="done"]')).toHaveLength(1);
   expect(t.host.querySelectorAll('.application-review-stages [data-state="active"]')).toHaveLength(1);
   expect(t.host.querySelectorAll(".application-check-list [data-completed=true]")).toHaveLength(0);
  }finally{await t.cleanup();}
 });
 it("shows selected conditions rather than the original requested amount",async()=>{
  const view=source();view.state.selected_offer_id="offer";view.result!.assessment!.offers=[{offer_id:"offer",product_id:"investment_loan",amount:"400000.00",term_months:48}];
  const t=await setup(false,view);try{
   expect(t.host.querySelector("dl")?.textContent).toContain("Выбранная сумма400 000 ₽");
   expect(t.host.querySelector("dl")?.textContent).toContain("48 мес.");
   expect(t.host.querySelector("dl")?.textContent).not.toContain("450");
  }finally{await t.cleanup();}
 });
});
