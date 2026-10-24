// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {env} from "node:process";
import {describe, expect, it, vi} from "vitest";
import {CabinetPage} from "@/pages/cabinet-page";
import {createApplication, getApplication, patchApplication, versionAction} from "@/features/applications/api/applications";

const base=env.CABINET_TEST_URL, nativeFetch=globalThis.fetch;
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
describe.skipIf(!base)("complete requested information against the real bank API",()=>{
 it("validates inline, saves the correction and submits the new version without asking the user to find another screen",async()=>{
  const requests:{method:string;body:Record<string,unknown>;url:string}[]=[];
  vi.stubGlobal("fetch",async(url:string|URL,options?:RequestInit)=>{if(options?.method)requests.push({method:options.method,body:JSON.parse(String(options.body||"{}")),url:String(url)});return nativeFetch(new URL(url,base),options);});
  HTMLElement.prototype.scrollIntoView=()=>{};
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  localStorage.clear();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  async function until(condition:()=>unknown){for(let i=0;i<200;i++){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});if(await condition())return;}throw new Error(host.textContent?.slice(-1800));}
  const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===text);
  const click=(text:string)=>act(async()=>button(text)!.click());
  try{
   let view=await createApplication();
   const id=view.application.application_id;
   view=await patchApplication(id,view.application.application_version,{"need.purpose":"investment","need.preferred_product":"investment_loan","need.financing_pattern":"gradual_repayment","need.project_cost":"500000.00","need.own_funds":"50000.00","need.term_months":36,"need.principal_grace_months":0});
   view=await versionAction(id,view.application.application_version,"submit");
   expect(view.state.status).toBe("waiting_for_data");const previousVersion=view.application.application_version;
   requests.length=0;
   await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/cabinet?mode=applications&application=${id}`]}><CabinetPage/></MemoryRouter></QueryClientProvider>));
   await until(()=>button("Уточнить взнос и стоимость"));await click("Уточнить взнос и стоимость");
   await click("Сохранить и отправить на проверку");
   expect(host.querySelector("#followup-own")?.getAttribute("aria-invalid")).toBe("true");
   expect(requests.filter(item=>item.method==="PATCH")).toHaveLength(0);
   await act(async()=>{const field=host.querySelector<HTMLInputElement>("#followup-own")!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,"100000");field.dispatchEvent(new Event("input",{bubbles:true}));});
   await click("Сохранить и отправить на проверку");
   await until(()=>host.textContent?.includes("Выбрать предложение"));
   const result=await getApplication(id);
   expect(result.state.status).toBe("offers_ready");
   expect(result.application.need.own_funds).toBe("100000.00");
   expect(result.application.need.requested_amount).toBe("400000.00");
   expect(result.application.application_version).toBe(previousVersion+1);
   expect(requests.filter(item=>item.method==="PATCH")).toHaveLength(1);
   expect(requests.filter(item=>item.url.endsWith("/submit"))).toEqual([expect.objectContaining({body:expect.objectContaining({base_application_version:previousVersion+1})})]);
  }finally{await act(async()=>root.unmount());client.clear();host.remove();localStorage.clear();vi.unstubAllGlobals();}
 },30_000);
});
