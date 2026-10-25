// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createApplication,type ApplicationView} from "@/features/applications";
import {applicationViewSchema} from "@/features/applications/api/applications";
import {applicationKeys} from "@/features/applications/model/queries";
import {CabinetPage} from "./cabinet-page";

vi.mock("@/features/applications",async original=>({...await original<typeof import("@/features/applications")>(),createApplication:vi.fn(),ApplicationWorkspace:({view}:{view:ApplicationView})=><output data-workspace={view.application.application_id}>{view.application.application_id}</output>}));
vi.mock("./cabinet-insights",()=>({CabinetOverview:()=>null,BusinessProfile:()=>null,FinancingPortfolio:()=>null}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const fixture=(id:string,need:Record<string,unknown>={})=>applicationViewSchema.parse({application:{application_id:id,application_version:1,need,financials:{}},client_data:{},state:{status:"draft",application_version:1,next_action:{type:"edit",label:"Заполнить задачу"}},result:null,recommendation:null,readiness:null,completion:null,explorations:[],events:[]});
const old=fixture("saved-selection",{purpose:"working_capital",preferred_product:"revolving_credit_line",requested_amount:"330000",term_months:12});
beforeEach(()=>{
 localStorage.clear();vi.clearAllMocks();
 vi.stubGlobal("matchMedia",()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 Element.prototype.scrollIntoView=vi.fn();
});
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function setup(){
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 const client=new QueryClient({defaultOptions:{queries:{enabled:false,retry:false,staleTime:Infinity},mutations:{retry:false}}});
 localStorage.setItem("delo-react-contexts",JSON.stringify({manual:old.application.application_id,assistant:null}));
 client.setQueryData(applicationKeys.list,[{application_id:old.application.application_id,need:old.application.need,state:old.state,completion:null,ready_for_application:false}]);
 client.setQueryData(applicationKeys.detail(old.application.application_id),old);
 client.setQueryData(applicationKeys.profile,{company_name:"ООО «Север»",business:{},financials:{existing_loans:[]}});
 client.setQueryData(["showcase-contexts"],{});client.setQueryData(["legacy-workspaces"],[]);
 await act(async()=>root.render(<MemoryRouter initialEntries={["/cabinet?mode=manual"]}><QueryClientProvider client={client}><CabinetPage/></QueryClientProvider></MemoryRouter>));
 const click=async(text:string)=>{const button=[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>!item.closest("[hidden]")&&item.textContent?.trim()===text);expect(button,`button ${text}`).toBeTruthy();await act(async()=>button!.click());};
 return{host,client,click,dispose:async()=>{await act(async()=>root.unmount());client.clear();host.remove();}};
}
describe("explicit saved selection recovery",()=>{
 it("opens a blank form and recovers an old draft only from Applications",async()=>{
  const test=await setup();try{
   expect(test.host.textContent).toContain("На что нужны деньги?");
   expect(test.host.textContent).not.toContain("Продолжить начатый подбор?");
   expect(test.host.querySelector("[data-workspace]")).toBeNull();expect(createApplication).not.toHaveBeenCalled();
   await test.click("Заявки1");expect(test.host.querySelectorAll(".application-record")).toHaveLength(1);
   await test.click("Продолжить подбор");expect(test.host.querySelector('[data-workspace="saved-selection"]')).toBeTruthy();
   await test.click("Получить финансирование");expect(test.host.querySelector("[data-workspace]")).toBeNull();
   expect(test.host.textContent).toContain("На что нужны деньги?");
   expect(createApplication).not.toHaveBeenCalled();
  }finally{await test.dispose();}
 });
 it("preserves saved draft values without putting them into the new form or creating empty server records",async()=>{
  localStorage.setItem("delo-need:saved-selection:1",JSON.stringify({requestedAmount:"410000",termMonths:"18"}));
  const fresh=fixture("new-selection");vi.mocked(createApplication).mockResolvedValue(fresh);
  const test=await setup();try{
   expect(test.host.querySelector<HTMLInputElement>("#need-amount")?.value).toBe("");
   expect(createApplication).not.toHaveBeenCalled();
   expect(test.client.getQueryData(applicationKeys.detail("saved-selection"))).toEqual(old);
   expect(localStorage.getItem("delo-need:saved-selection:1")).toContain("410000");
   expect(fresh.application.need.requested_amount).toBeUndefined();
  }finally{await test.dispose();}
 });
 it("returns to a new entry after a long absence while preserving the saved application",async()=>{
  let now=1000;vi.spyOn(Date,"now").mockImplementation(()=>now);
  const test=await setup();try{
   await test.click("Заявки1");await test.click("Продолжить подбор");
   await act(async()=>window.dispatchEvent(new Event("blur")));now+=3*60*60*1000;
   await act(async()=>window.dispatchEvent(new Event("focus")));
   expect(test.host.querySelector("[data-workspace]")).toBeNull();
   expect(test.host.textContent).toContain("На что нужны деньги?");
   expect(test.client.getQueryData(applicationKeys.detail("saved-selection"))).toEqual(old);
  }finally{await test.dispose();}
 });
});
