// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {applicationListSchema} from "../api/applications";
import {DeleteDraftAction} from "./applications-hub";
import {forgetDraftStorage} from "../model/deleted-draft";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
afterEach(()=>localStorage.clear());
const draft=applicationListSchema.parse([{application_id:"draft-one",need:{preferred_product:"investment_loan",requested_amount:"400000"},state:{status:"draft",application_version:2,next_action:{type:"edit",label:"Продолжить"}}}])[0];

it("requires explicit confirmation and hides deletion after submission",async()=>{
 const host=document.createElement("div");host.className="cabinet-shell";document.body.append(host);
 const root=createRoot(host),remove=vi.fn();
 try{
  await act(async()=>root.render(<DeleteDraftAction application={draft} busy={false} onDelete={remove}/>));
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  expect(remove).not.toHaveBeenCalled();
  const buttons=[...host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
  await act(async()=>buttons.find(b=>b.textContent==="Оставить черновик")!.click());
  expect(remove).not.toHaveBeenCalled();
  await act(async()=>host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(b=>b.textContent==="Удалить черновик")!.click());
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async()=>root.render(<DeleteDraftAction application={{...draft,state:{...draft.state,status:"offers_ready"}}} busy={false} onDelete={remove}/>));
  expect(host.querySelector("button")).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();}
});

it("forgets only the deleted application's saved form and chat bindings",()=>{
 localStorage.setItem("delo-react-contexts",JSON.stringify({manual:"draft-one",assistant:"keep"}));
 localStorage.setItem("delo-workspace-contexts",JSON.stringify({manual:{chat_id:"chat-one"},assistant:{chat_id:"chat-keep"}}));
 localStorage.setItem("delo-chat:draft-one",JSON.stringify("chat-one"));
 localStorage.setItem("delo-need:draft-one:2","{}");
 localStorage.setItem("delo-step:draft-one",'"need"');
 localStorage.setItem("delo-need:keep:1","{}");
 forgetDraftStorage("draft-one");
 expect(JSON.parse(localStorage.getItem("delo-react-contexts")!)).toEqual({manual:null,assistant:"keep"});
 expect(JSON.parse(localStorage.getItem("delo-workspace-contexts")!)).toEqual({assistant:{chat_id:"chat-keep"}});
 expect(localStorage.getItem("delo-chat:draft-one")).toBeNull();
 expect(localStorage.getItem("delo-need:draft-one:2")).toBeNull();
 expect(localStorage.getItem("delo-step:draft-one")).toBeNull();
 expect(localStorage.getItem("delo-need:keep:1")).toBe("{}");
});
