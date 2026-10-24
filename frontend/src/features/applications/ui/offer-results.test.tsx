// @vitest-environment jsdom
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router";
import {describe,expect,it} from "vitest";
import {applicationViewSchema} from "../api/applications";
import {OfferResults} from "./offer-results";

function render(stage="final",outcome="approved") {
 const view=applicationViewSchema.parse({application:{application_id:"offer-ui",application_version:1,need:{preferred_product:"investment_loan",requested_amount:"400000",term_months:24},financials:{}},client_data:{},state:{status:"offers_ready",application_version:1,next_action:{type:"select_offer",label:"Выберите итоговое предложение"}},result:{status:"assessed",assessment:{assessment_id:"a",stage,outcome,offers:[{offer_id:"offer",product_id:"investment_loan",amount:"400000",term_months:24,annual_rate_percent:"18",monthly_payment:"22346.20",total_repayment:"487270",investment:{project_cost:"600000",own_funds:"200000",principal_grace_months:3,grace_monthly_payment:"6000"},penalty_terms:{terms_id:"demo",version:"simple-daily-v1",daily_rate_percent:"0.05",source:"demo_contract",basis:"overdue_installment",start_rule:"day_after_due",day_count:"calendar",capitalization:false},schedule:[{date:"2026-11-25",principal_payment:"0",interest_payment:"6000",total_payment:"6000"}]}]}},events:[],completion:null,recommendation:null,readiness:null,explorations:[]});
 const host=document.createElement("div");
 host.innerHTML=renderToStaticMarkup(<MemoryRouter><OfferResults view={view} busy={false} onSelect={()=>{}} onSign={()=>{}} onComplete={()=>{}}/></MemoryRouter>);
 return host;
}

describe("decision and offer presentation",()=>{
 it("makes final approval the heading and keeps the offer identity before project details",()=>{
  const host=render();
  expect(host.querySelector("h3")?.textContent).toBe("Одобрено");
  expect(host.querySelector(".application-result-header")?.getAttribute("data-tone")).toBe("approved");
  const offer=host.querySelector(".application-offer-card")!;
  expect(offer.firstElementChild?.textContent).toContain("Инвестиционный кредит");
  expect(offer.querySelector(".investment-payment-phases")?.textContent).toContain("С 4-го месяца");
  expect(offer.querySelector("button")?.textContent).toContain("Выбрать предложение");
  const penalties=offer.querySelector(".penalty-terms-compact")!;
  expect(penalties.hasAttribute("open")).toBe(false);
  expect(penalties.querySelector("summary")?.textContent).toContain("При просрочке: 0,05% в день");
  expect(penalties.textContent).toContain("В обычные платежи без просрочки не входят");
 });
 it("does not present a preliminary calculation as bank approval",()=>{
  const host=render("preliminary");
  expect(host.querySelector("h3")?.textContent).toBe("Подходящие условия");
  expect(host.querySelector(".application-result-header")?.hasAttribute("data-tone")).toBe(false);
  expect(host.querySelector(".application-result-kicker")?.textContent).toBe("Предварительный расчёт");
 });
 it("distinguishes conditional approval from unconditional approval",()=>{
  const host=render("final","conditional_approval");
  expect(host.querySelector("h3")?.textContent).toBe("Одобрено с условием");
  expect(host.querySelector(".application-result-header")?.hasAttribute("data-tone")).toBe(false);
 });
});
