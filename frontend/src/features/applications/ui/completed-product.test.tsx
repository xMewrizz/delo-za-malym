import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router";
import {describe,expect,it} from "vitest";
import {applicationViewSchema} from "../api/applications";
import {OfferResults} from "./offer-results";
import {ApplicationsHub} from "./applications-hub";
import {PortfolioProductCard} from "@/pages/financing-portfolio";

const view=(completion:Record<string,unknown>)=>applicationViewSchema.parse({
 application:{application_id:"old-loan",application_version:1,need:{preferred_product:"working_capital_loan",requested_amount:"180000",term_months:12},financials:{}},
 client_data:{},state:{status:"disbursed",application_version:1,next_action:{type:"none",label:"Кредит выдан"}},
 result:null,recommendation:null,readiness:null,completion:{type:"disbursement",amount:"180000",product_id:"working_capital_loan",...completion},explorations:[],events:[],
});
const noop=()=>{};
const result=(completion:Record<string,unknown>)=>renderToStaticMarkup(<MemoryRouter><OfferResults view={view(completion)} busy={false} onSelect={noop} onSign={noop} onComplete={noop}/></MemoryRouter>);

describe("closed product navigation",()=>{
 it("replaces the refinanced loan calendar with its replacement application",()=>{
  const html=result({refinanced_by:"new-loan"});
  expect(html).toContain("Кредит погашен рефинансированием");
  expect(html).toContain("По этому договору будущих платежей нет");
  expect(html).toContain("Первоначальная сумма кредита");
  expect(html).toContain('href="/cabinet?mode=applications&amp;application=new-loan"');
  expect(html).not.toContain("Актуальный график");
  expect(html).not.toContain("Деньги зачислены на расчётный счёт");
 });
 it("hides the calendar after full repayment but keeps it for an active or unused product",()=>{
  expect(result({servicing:{closed_at:"2026-10-24"}})).not.toContain("Актуальный график");
  expect(result({servicing:{closed_at:null,principal:"100000"}})).toContain("Актуальный график");
  expect(result({type:"limit_opening",product_id:"overdraft",servicing:{principal:"0"}})).toContain("Актуальный график");
  expect(result({product_id:"refinancing"})).toContain("Актуальный график");
 });
 it("shows the current closed state in the application list and links to the new loan",()=>{
  const data=view({refinanced_by:"new-loan"});
  const html=renderToStaticMarkup(<MemoryRouter><ApplicationsHub applications={[{application_id:data.application.application_id,need:data.application.need,state:data.state,completion:data.completion}]} loading={false} refresh={noop} open={noop} create={noop}/></MemoryRouter>);
  expect(html).toContain("Погашен рефинансированием");
  expect(html).toContain("Условия и история");
  expect(html).toContain('href="/cabinet?mode=applications&amp;application=new-loan"');
  expect(html).not.toContain("Управляйте продуктом");
 });
 it("opens the old application history instead of an empty calendar from the closed portfolio card",()=>{
  const html=renderToStaticMarkup(<MemoryRouter><PortfolioProductCard product={{id:"app:old-loan",applicationId:"old-loan",title:"Кредит",kind:"loan",status:"refinanced",source:"Кабинет",principal:"0",originalPrincipal:"180000"}}/></MemoryRouter>);
  expect(html).toContain('href="/cabinet?mode=applications&amp;application=old-loan"');
  expect(html).not.toContain("mode=calendar");
 });
});
