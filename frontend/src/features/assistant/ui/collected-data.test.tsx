// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe,it,expect,vi} from "vitest";
import {CollectedData} from "./collected-data";
import {projectApplication} from "../model/projection";
import type {ApplicationView} from "@/features/applications";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const source={application:{application_id:"live",application_version:1,need:{},financials:{cash_balance:"1359976.99",existing_loans:[]},product_details:{}},client_data:{},explorations:[],state:{status:"draft"}} as unknown as ApplicationView;
describe("live request summary",()=>{
  it("shows one pending payment once, without duplicate totals or detached editing controls",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("unavailable",{status:503})));
    const host=document.createElement("div"),root=createRoot(host);
    const proposal={proposal_id:"payment",status:"pending",changes:{"need.financing_pattern":"cash_gap","product_details.overdraft":{transactions:[{transaction_id:"expense",amount:"300000.00",direction:"outflow",date:null}]}}};
    try{
      await act(async()=>root.render(<CollectedData view={projectApplication(source,proposal)} proposal={proposal} loading={false}/>));
      expect(host.querySelector('.collected-operations')).toBeNull();
      expect(host.querySelector('[data-live-field=amount] dt')?.textContent).toBe('Сумма платежа');
      expect(host.querySelector('[data-live-field=amount] dd')?.textContent?.replace(/\s/g,"")).toBe('300000₽');
      expect(host.querySelector('[data-live-field=payment-date] dd')?.textContent).toBe('Уточняем');
      expect(host.querySelectorAll('button,form')).toHaveLength(0);
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
  it("projects a reply into identified fields without saving the application and keeps bank money separate",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("unavailable",{status:503})));
    const host=document.createElement("div"),root=createRoot(host);
    const proposal={proposal_id:"p",status:"pending",changes:{"need.purpose":"working_capital","need.requested_amount":"200000.00","need.term_months":12}};
    try{
      await act(async()=>root.render(<CollectedData view={source} loading={false}/>));
      expect(host.textContent).toContain("Не выбрана");
      expect(host.querySelector("[data-live-field=amount]")?.getAttribute("data-empty")).toBe("true");
      expect(host.querySelector(".collected-fact-hero")).toBeNull();
      await act(async()=>root.render(<CollectedData view={projectApplication(source,proposal)} proposal={proposal} loading={false}/>));
      expect(host.querySelector('[data-live-field=amount] dd')?.textContent?.replace(/\s/g,"")).toBe("200000₽");
      expect(host.querySelector('[data-live-field=term] dd')?.textContent).toBe("12 мес.");
      expect(host.querySelector('[data-live-field=amount]')?.hasAttribute('data-proposed')).toBe(true);
      expect(host.querySelector('.collected-bank-context')?.textContent?.replace(/\s/g,"")).toContain("1359977₽");
      expect(host.querySelector('.collected-next-question')).toBeNull();
      expect(host.textContent).not.toContain("ПРЕДЛОЖЕНО ИЗ РАЗГОВОРА");
      expect(host.textContent).not.toContain("Из разговора");
      expect(host.querySelector('.collected-request-heading')).toBeNull();
      expect(source.application.need.requested_amount).toBeUndefined();
      expect(host.querySelectorAll(".collected-correction")).toHaveLength(0);
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
});
