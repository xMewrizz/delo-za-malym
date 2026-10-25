// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {afterEach, describe, expect, it, vi} from "vitest";
import {applicationViewSchema} from "../api/applications";
import {ApplicationWorkspace, type ApplicationActions} from "./application-workspace";

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const source = () => applicationViewSchema.parse({application:{application_id:"followup-test", application_version:1, need:{purpose:"investment",preferred_product:"investment_loan",project_cost:"500000.00",own_funds:"50000.00",requested_amount:"450000.00",term_months:36,financing_pattern:"gradual_repayment"},financials:{largest_buyer_share:.2,monthly:[]}},client_data:{},state:{status:"waiting_for_data",application_version:1,next_action:{type:"provide_information",label:"Дополните сведения"}},result:{status:"assessed",assessment:{assessment_id:"a",stage:"final",outcome:"needs_information",offers:[],required_information:[{field:"need.own_funds",question:"Для проекта нужен собственный взнос от 100000.00 ₽ (20%). Уточните, сможете ли его внести."}]}},events:[],explorations:[],completion:null,recommendation:null,readiness:null});
afterEach(() => {localStorage.clear(); vi.restoreAllMocks();});
async function setup() {
  localStorage.clear(); HTMLElement.prototype.scrollIntoView = () => {};
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const actions:ApplicationActions={save:vi.fn(),version:vi.fn(),explore:vi.fn(),apply:vi.fn(),select:vi.fn(),complete:vi.fn(),sign:vi.fn()};
  const render=(view=source(),busy=false, next=actions)=>act(async()=>root.render(<MemoryRouter><ApplicationWorkspace view={view} busy={busy} actions={next}/></MemoryRouter>));
  await render();
  const click=(label:string)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(button=>!button.closest("[hidden]") && button.textContent?.includes(label))!.click());
  const fill=(id:string,value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>(`#${id}`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
  const cleanup=async()=>{await act(async()=>root.unmount());host.remove();};
  return {host,actions,render,click,fill,cleanup};
}
describe("resume an application that needs information",()=>{
  it("puts a specific next action before reference information, then shows only project and contribution fields",async()=>{
    const t=await setup();try{
      expect(t.host.querySelector("h2")?.textContent).toBe("Инвестиционный кредит");
      expect(t.host.querySelector(".application-overview")?.nextElementSibling?.querySelector("h2")?.textContent).toBe("Дополните заявку, чтобы продолжить");
      expect(t.host.textContent).toContain("100 000 ₽");
      expect(t.host.textContent).not.toContain("Предложений пока нет");
      expect(t.host.querySelectorAll("input")).toHaveLength(0);
      await t.click("Уточнить взнос и стоимость");
      expect(t.host.querySelectorAll("input")).toHaveLength(2);
      expect(t.host.querySelector("#need-purpose")).toBeNull();
      expect(document.activeElement?.id).toBe("followup-own");
      expect(t.host.textContent).not.toContain("Сохранить черновик");
    }finally{await t.cleanup();}
  });
  it("validates the contribution before saving and submits the new version only after a successful save",async()=>{
    const t=await setup();try{
      await t.click("Уточнить взнос и стоимость");await t.fill("followup-own","500 000");await t.click("Сохранить и отправить на проверку");
      expect(t.actions.save).not.toHaveBeenCalled();
      expect(t.host.querySelector("#followup-own")?.getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement?.id).toBe("followup-own");
      await t.fill("followup-own","100 000");
      expect(t.host.querySelector(".followup-loan-preview")?.textContent).toContain("400 000 ₽");
      await t.click("Сохранить и отправить на проверку");
      expect(t.actions.save).toHaveBeenCalledExactlyOnceWith({"need.project_cost":"500000.00","need.own_funds":"100000.00"},expect.any(Function));
      expect(t.actions.version).not.toHaveBeenCalled();
      await act(async()=>vi.mocked(t.actions.save).mock.calls[0][1]?.());
      await t.render(source(),true);expect(t.actions.version).not.toHaveBeenCalled();
      const saved=source();saved.application.application_version=2;saved.state.status="draft";saved.state.application_version=2;saved.application.need.own_funds="100000.00";saved.result=null;
      const latest={...t.actions,version:vi.fn()};await t.render(saved,false,latest);
      expect(latest.version).toHaveBeenCalledExactlyOnceWith("submit");
      expect(t.actions.version).not.toHaveBeenCalled();
      await t.render(saved,false,latest);expect(latest.version).toHaveBeenCalledTimes(1);
    }finally{await t.cleanup();}
  });
  it("retains corrected values if saving fails and does not run a review",async()=>{
    const t=await setup();try{
      await t.click("Уточнить взнос и стоимость");await t.fill("followup-own","125000");await t.click("Сохранить и отправить на проверку");
      await t.render(source(),true);await t.render(source(),false);
      expect(t.host.querySelector<HTMLInputElement>("#followup-own")?.value).toBe("125000");
      expect(t.actions.version).not.toHaveBeenCalled();
    }finally{await t.cleanup();}
  });
  it("collects all requested sections before one save and keeps the previous answers",async()=>{
    const t=await setup();try{
      const view=source();view.application.financials.largest_buyer_share=null;await t.render(view);
      await t.click("Уточнить взнос и стоимость");await t.fill("followup-own","100000");await t.click("Продолжить");
      expect(t.actions.save).not.toHaveBeenCalled();
      expect(document.activeElement?.id).toBe("buyer-share");
      await t.fill("buyer-share","20");await t.click("Сохранить и отправить на проверку");
      expect(t.actions.save).toHaveBeenCalledExactlyOnceWith({"need.project_cost":"500000.00","need.own_funds":"100000.00","financials.largest_buyer_share":.2},expect.any(Function));
    }finally{await t.cleanup();}
  });
});
