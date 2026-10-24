// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe,it,expect,vi } from "vitest";
import { OverdraftPanel } from "./overdraft-panel";
import { getOverdraft,operateOverdraft,type OverdraftState } from "./api";
vi.mock("./api",async original=>({...await original<typeof import("./api")>(),getOverdraft:vi.fn(),operateOverdraft:vi.fn(),previewOverdraft:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const state:OverdraftState={application_id:"od-one",account_version:"a".repeat(64),version:2,limit:"150000.00",available_limit:"50000.00",principal:"100000.00",accrued_interest:"0.00",amount_to_repay:"100000.00",annual_rate_percent:"20.00",interest_per_day:"54.79",cash_balance:"0.00",maturity_date:"2027-10-23",repay_by:"2026-12-22",max_debt_days:60,blocked:false,status:"active",today:"2026-10-23",operations:[]};
async function until(test:()=>unknown){for(let i=0;i<80;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});if(test())return;}throw new Error("Recovery failed");}
describe("overdraft confirmation recovery",()=>{
  it.each([true,false])("restores a completed expense or retries the identical operation, recorded=%s",async recorded=>{
    localStorage.clear();const request={base_account_version:"a".repeat(64),kind:"expense" as const,amount:"400000.00",purpose:"supplier" as const,request_id:crypto.randomUUID(),calculated_on:"2026-10-23",confirmed:true as const};
    const completed={...state,operations:[{operation_id:"expense-one",request_id:request.request_id,kind:"expense" as const,amount:"400000.00",date:"2026-10-23",drawn:"100000.00",principal_paid:"0.00",interest_paid:"0.00"}]};
    const quote={kind:request.kind,amount:request.amount,purpose:request.purpose,own_money:"300000.00",overdraft_used:"100000.00",principal_paid:"0.00",interest_paid:"0.00",allocations:[],cash_after:"0.00",principal_after:"100000.00",available_after:"50000.00",account_version:request.base_account_version,calculated_on:request.calculated_on};
    localStorage.setItem("delo-pending-operation:overdraft:od-one",JSON.stringify(request));
    vi.mocked(getOverdraft).mockResolvedValue(recorded?completed:state);vi.mocked(operateOverdraft).mockReset();vi.mocked(operateOverdraft).mockResolvedValue({state:completed,receipt:quote});
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    try{
      await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}><OverdraftPanel applicationId="od-one"/></QueryClientProvider></MemoryRouter>));
      if(!recorded){await until(()=>host.textContent?.includes("Повторить тот же запрос"));expect(host.querySelector("input")).toBeNull();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent==="Повторить тот же запрос")!.click());}
      await until(()=>host.querySelector(".operation-result"));expect(host.textContent).toContain("Платёж выполнен");
      if(recorded)expect(operateOverdraft).not.toHaveBeenCalled();else expect(operateOverdraft).toHaveBeenCalledExactlyOnceWith("od-one",request);
      expect(localStorage.getItem("delo-pending-operation:overdraft:od-one")).toBeNull();
    }finally{await act(async()=>root.unmount());client.clear();host.remove();localStorage.clear();}
  });
});
