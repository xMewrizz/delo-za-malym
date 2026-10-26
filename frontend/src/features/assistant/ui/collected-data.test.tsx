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
  it("projects a reply into identified fields without saving the application and keeps bank money separate",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("unavailable",{status:503})));
    const host=document.createElement("div"),root=createRoot(host),edit=vi.fn();
    const proposal={proposal_id:"p",status:"pending",changes:{"need.purpose":"working_capital","need.requested_amount":"200000.00","need.term_months":12}};
    try{
      await act(async()=>root.render(<CollectedData view={source} busy={false} loading={false} onEdit={edit}/>));
      expect(host.textContent).toContain("Расскажите, на что нужны деньги");
      await act(async()=>root.render(<CollectedData view={projectApplication(source,proposal)} proposal={proposal} busy={false} loading={false} onEdit={edit} nextQuestion="Когда понадобятся деньги?"/>));
      expect(host.querySelector('[data-live-field=amount] dd')?.textContent?.replace(/\s/g,"")).toBe("200000₽");
      expect(host.querySelector('[data-live-field=term] dd')?.textContent).toBe("12 мес.");
      expect(host.querySelector('[data-live-field=amount]')?.hasAttribute('data-proposed')).toBe(true);
      expect(host.querySelector('.collected-bank-context')?.textContent?.replace(/\s/g,"")).toContain("1359977₽");
      expect(host.querySelector('.collected-next-question')?.textContent).toContain("Когда понадобятся деньги?");
      expect(host.textContent).not.toContain("ПРЕДЛОЖЕНО ИЗ РАЗГОВОРА");
      expect(host.textContent).not.toContain("Из разговора");
      expect(host.querySelector('.collected-request-heading')).toBeNull();
      expect(source.application.need.requested_amount).toBeUndefined();
      expect(edit).not.toHaveBeenCalled();
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
});
