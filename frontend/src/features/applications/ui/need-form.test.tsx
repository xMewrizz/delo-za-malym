// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe,it,expect,vi } from "vitest";
import { NeedForm } from "./need-form";
import type { ApplicationView } from "../api/applications";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const view={application:{application_id:"step-test",application_version:1,need:{},financials:{cash_balance:"300000.00",existing_loans:[]}},client_data:{bank_financials:{cash_balance:"300000.00"}},field_sources:{}} as unknown as ApplicationView;
describe("guided financing form",()=>{
  it("shows a lower bound at a short term and offers fitting terms without changing the requested amount",async()=>{
    localStorage.clear();HTMLElement.prototype.scrollIntoView=()=>{};
    const product={product_id:"working_capital_loan",name:"Кредит",policy_version:"demo-v1",minimum_amount:"100000.00",maximum_amount:"100000000.00",annual_rate_percent:"24.00",terms:[12,36]};
    const capacity={calculated_at:"2026-10-26",preliminary:true,products:[{product_id:"working_capital_loan",status:"available",maximum_amount:"2000000.00",available_monthly_payment:"100000.00",terms:[{term_months:12,maximum_amount:"500000.00"},{term_months:36,maximum_amount:"2000000.00"}],reasons:[],rules_fingerprint:"test"}]};
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).includes("financing-capacity")?capacity:[product]),{status:200,headers:{"Content-Type":"application/json"}})));
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host),save=vi.fn();
    const click=async(text:string)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>!item.closest('[hidden]')&&(item.textContent===text||item.getAttribute('aria-label')===text))!.click());
    const fill=async(id:string,value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>(id)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
    try{
      await act(async()=>root.render(<NeedForm view={view} busy={false} onSave={save} continueToNextStep/>));
      await click("Закупить товар");await click("Продолжить");await fill('#need-amount','1000000');await click("Нужна вся сумма");await click("Продолжить");await fill('#need-term','12');
      expect(host.querySelector('.business-capacity')?.textContent?.replace(/\s/g,"")).toContain("до500000₽");
      await click("Посмотреть подходящие предложения");
      expect(host.querySelector('#need-term')?.getAttribute('aria-invalid')).toBe('true');expect(save).not.toHaveBeenCalled();
      await click("36 мес.");await click("Посмотреть подходящие предложения");
      expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({"need.requested_amount":"1000000.00","need.term_months":36}));
    }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();vi.unstubAllGlobals();}
  });
  it("shows the business-specific limit immediately after selection and catches an unaffordable amount before leaving the amount step",async()=>{
    localStorage.clear();HTMLElement.prototype.scrollIntoView=()=>{};
    const product={product_id:"working_capital_loan",name:"Кредит",policy_version:"demo-v1",minimum_amount:"100000.00",maximum_amount:"100000000.00",annual_rate_percent:"24.00",terms:[6,12,18,24,36]};
    const capacity={calculated_at:"2026-10-26",preliminary:true,products:[{product_id:"working_capital_loan",status:"available",maximum_amount:"2000000.00",available_monthly_payment:"100000.00",terms:[{term_months:36,maximum_amount:"2000000.00"}],reasons:[],rules_fingerprint:"test"}]};
    vi.stubGlobal("fetch",vi.fn(async(url:unknown)=>new Response(JSON.stringify(String(url).includes("financing-capacity")?capacity:[product]),{status:200,headers:{"Content-Type":"application/json"}})));
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const save=vi.fn();
    const click=async(text:string)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>!item.closest('[hidden]')&&(item.textContent===text||item.getAttribute('aria-label')===text))!.click());
    try{
      await act(async()=>root.render(<NeedForm view={view} busy={false} onSave={save} continueToNextStep/>));
      await click("Закупить товар");
      expect(host.querySelector('.business-capacity')?.textContent?.replace(/\s/g,"")).toContain("до2000000₽");
      expect(host.querySelector('#need-amount')?.closest('[hidden]')).not.toBeNull();
      await click("Продолжить");
      await act(async()=>{const input=host.querySelector<HTMLInputElement>('#need-amount')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'10000000');input.dispatchEvent(new Event('input',{bubbles:true}));});
      await click("Продолжить");
      expect(host.querySelector('#need-amount')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.textContent).toContain("По текущим данным вашему бизнесу доступно");
      expect(host.querySelector<HTMLInputElement>('#need-amount')?.value).toBe('10000000');
      expect(save).not.toHaveBeenCalled();
    }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();vi.unstubAllGlobals();}
  });
  it("shows the server catalogue range before entry and keeps an oversized request on the amount step",async()=>{
    localStorage.clear();HTMLElement.prototype.scrollIntoView=()=>{};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify([{product_id:"working_capital_loan",name:"Кредит",policy_version:"demo-v1",minimum_amount:"100000.00",maximum_amount:"100000000.00",annual_rate_percent:"24.00",terms:[6,12,18,24,36]}]),{status:200,headers:{"Content-Type":"application/json"}})));
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const save=vi.fn();
    const click=async(text:string)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>!item.closest('[hidden]')&&(item.textContent===text||item.getAttribute('aria-label')===text))!.click());
    try{
      await act(async()=>root.render(<NeedForm view={view} busy={false} onSave={save} continueToNextStep/>));
      await click("Закупить товар");await click("Продолжить");
      expect(host.textContent?.replace(/\s/g,"")).toContain("100000000₽");
      await act(async()=>{const input=host.querySelector<HTMLInputElement>('#need-amount')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'150000000');input.dispatchEvent(new Event('input',{bubbles:true}));});
      await click("Продолжить");
      expect(host.querySelector('#need-amount')?.getAttribute('aria-invalid')).toBe('true');
      expect(host.querySelector('.need-step-heading')?.textContent).toContain('Сколько нужно на задачу?');
      expect(save).not.toHaveBeenCalled();
    }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();vi.unstubAllGlobals();}
  });
  it("shows the remaining steps, validates before advancing, preserves answers and submits only after the final step",async()=>{
    localStorage.clear();HTMLElement.prototype.scrollIntoView=()=>{};
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const save=vi.fn();
    const button=(text:string)=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>(item.textContent===text||item.getAttribute("aria-label")===text)&&!item.closest("[hidden]"))!;
    const click=(text:string)=>act(async()=>button(text).click());
    const fill=(id:string,value:string)=>act(async()=>{const input=host.querySelector<HTMLInputElement>(`#${id}`)!;expect(input.closest("[hidden]")).toBeNull();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
    try{
      await act(async()=>root.render(<NeedForm view={view} busy={false} onSave={save} continueToNextStep expenseImport={<details><summary>Заполнить из счёта PDF</summary></details>}/>));
      expect(host.querySelectorAll(".need-progress li")).toHaveLength(3);
      expect(host.querySelector("#need-amount")?.closest("[hidden]")).toBeTruthy();
      expect(host.querySelector("details:not([hidden]) > summary")?.textContent).not.toBe("Заполнить из счёта PDF");
      await click("Продолжить");expect(host.querySelector('[role="alert"]')?.textContent).toContain("Выберите");
      await click("Закупить товар");await click("Продолжить");
      expect(host.querySelector(".need-step-heading h2")?.textContent).toBe("Сколько нужно на задачу?");
      expect(host.querySelector("#need-term")?.closest("[hidden]")).toBeTruthy();
      await fill("need-amount","500000");await click("Нужна вся сумма");await click("Продолжить");
      expect(host.querySelector(".need-step-heading h2")?.textContent).toBe("Как удобно возвращать?");
      expect(save).not.toHaveBeenCalled();await fill("need-term","12");await click("Назад");
      expect(host.querySelector<HTMLInputElement>("#need-amount")!.value).toBe("500000");
      await click("Продолжить");await click("Посмотреть подходящие предложения");
      expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({"need.requested_amount":"500000.00","need.term_months":12}));
    }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();}
  });
  it("separates the outgoing payment from the incoming revenue and keeps the upload outside the main form",async()=>{
    localStorage.clear();HTMLElement.prototype.scrollIntoView=()=>{};
    const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
    const click=(text:string)=>act(async()=>[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>(item.textContent===text||item.getAttribute("aria-label")===text)&&!item.closest("[hidden]"))!.click());
    try{
      await act(async()=>root.render(<NeedForm view={view} busy={false} onSave={vi.fn()} continueToNextStep expenseImport={<form aria-label="Счёт PDF"><input /></form>}/>));
      await click("Дождаться выручки");await click("Продолжить");
      expect(host.querySelectorAll('[id^="operation-amount-"]')).toHaveLength(1);
      expect(host.querySelector('form[aria-label="Счёт PDF"]')?.parentElement?.closest("form")).toBeNull();
      expect(host.querySelector('label[for^="operation-amount-"]')?.textContent).toBe("Сколько нужно заплатить, ₽");
      const field=host.querySelector<HTMLInputElement>('[id^="operation-amount-"]')!;
      await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,"450000");field.dispatchEvent(new Event("input",{bubbles:true}));});
      await click("Продолжить");
      expect(host.querySelector('label[for^="operation-amount-"]')).toBeNull();
      expect(host.textContent).toContain("Если поступления пока неизвестны");
      await click("Поступление");
      expect(host.querySelector('label[for^="operation-amount-"]')?.textContent).toBe("Сколько поступит, ₽");
    }finally{await act(async()=>root.unmount());host.remove();localStorage.clear();}
  });
});


describe("task and product selection", () => {
  async function setup(source = view) {
    localStorage.clear(); HTMLElement.prototype.scrollIntoView = () => {};
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), save = vi.fn();
    const render = () => act(async () => root.render(<NeedForm view={source} busy={false} onSave={save} continueToNextStep />));
    await render();
    const button = (text:string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => (item.textContent === text || item.getAttribute("aria-label") === text) && !item.closest("[hidden]"))!;
    const click = (text:string) => act(async () => button(text).click());
    const fill = (id:string,value:string) => act(async () => { const input = host.querySelector<HTMLInputElement>(`#${id}`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); });
    const choose = async (label:string) => {
      await act(async () => (host.querySelector("#need-product") as HTMLButtonElement).click());
      await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent === label)!.click());
    };
    const cleanup = async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); };
    return {host,root,save,render,button,click,fill,choose,cleanup};
  }
  it("keeps regular purchases selected, offers no conflicting purpose or product and submits a recurring line", async () => {
    const t = await setup();
    try {
      await t.click("Регулярные закупки");
      expect(t.button("Регулярные закупки").getAttribute("aria-pressed")).toBe("true");
      expect(t.host.querySelector("select,#need-product,#need-pattern,#need-recurring")).toBeNull();
      expect(t.host.textContent).not.toContain("Далее:");
      await t.click("Продолжить"); await t.fill("need-amount","350000"); await t.click("Продолжить");
      await t.click("Посмотреть подходящие предложения");
      expect(t.save).toHaveBeenCalledWith(expect.objectContaining({"need.purpose":"working_capital","need.preferred_product":"revolving_credit_line","need.recurring":true,"need.term_months":12}));
    } finally { await t.cleanup(); }
  });
  it("makes known-product mode independent, requires an explicit product and restores it after remount", async () => {
    const t = await setup();
    try {
      await t.click("Регулярные закупки"); await t.click("Я знаю продукт");
      expect(t.button("Я знаю продукт").getAttribute("aria-pressed")).toBe("true");
      expect(t.button("Закупить товар").getAttribute("aria-pressed")).toBe("false");
      await t.click("Продолжить");
      expect(t.host.querySelector("#need-product")?.getAttribute("aria-invalid")).toBe("true");
      await t.choose("Овердрафт");
      expect(t.button("Я знаю продукт").getAttribute("aria-pressed")).toBe("true");
      await t.click("Продолжить");
      expect(t.host.querySelector(".need-step-heading h2")?.textContent).toBe("Сколько и когда нужно заплатить?");
      expect(t.host.querySelector("#need-term")).toBeNull();
      await act(async () => t.root.render(<div />)); await t.render();
      expect(t.host.querySelector(".need-step-heading h2")?.textContent).toBe("Сколько и когда нужно заплатить?");
      await t.click("Назад");
      expect(t.host.querySelector("#need-product")?.textContent).toBe("Овердрафт");
      expect(t.button("Я знаю продукт").getAttribute("aria-pressed")).toBe("true");
    } finally { await t.cleanup(); }
  });
  it("lets known-product mode calculate every product without replacing the selected entry mode", async () => {
    const t = await setup();
    try {
      await t.click("Я знаю продукт");
      for (const [product,title] of [["Кредит на оборотные цели","Сколько нужно на задачу?"],["Овердрафт","Сколько и когда нужно заплатить?"],["Инвестиционный кредит","Сколько стоит ваш проект?"],["Рефинансирование","Какие кредиты объединим?"],["Возобновляемая кредитная линия","Какой лимит нужен?"]]) {
        await t.choose(product!);
        expect(t.button("Я знаю продукт").getAttribute("aria-pressed")).toBe("true");
        await t.click("Продолжить");
        expect(t.host.querySelector(".need-step-heading h2")?.textContent).toBe(title);
        await t.click("Назад");
      }
    } finally { await t.cleanup(); }
  });
  it("clears incompatible constraints when moving from equipment or recurring purchases to a cash gap", async () => {
    const t = await setup();
    try {
      await t.click("Купить оборудование"); await t.click("Продолжить");
      await t.fill("need-project-cost","1000000"); await t.fill("need-own","200000");
      await t.click("Назад"); await t.click("Дождаться выручки");
      expect(t.host.querySelector("#need-product")).toBeNull();
      await t.click("Продолжить");
      const stored = JSON.parse(localStorage.getItem("delo-need:step-test:1")!);
      expect(stored).toMatchObject({entryTask:"cash_gap",preferredProduct:"",termMonths:"",ownFunds:"",projectCost:"",financingPattern:"cash_gap",recurring:"false"});
      expect(t.host.querySelector("#need-term,#need-project-cost,#need-own,#need-amount")).toBeNull();
    } finally { await t.cleanup(); }
  });
  it("asks about the amount before calculating, validates a flexible minimum immediately, and preserves the choice", async () => {
    const t = await setup();
    try {
      await t.click("Закупить товар"); await t.click("Продолжить"); await t.fill("need-amount","300000");
      await t.click("Продолжить");
      expect(t.host.querySelector(".need-step-heading h2")?.textContent).toBe("Сколько нужно на задачу?");
      expect(t.host.querySelector('[role=alert]')?.textContent).toContain("Выберите");
      await t.click("Подойдёт меньше"); await t.click("Продолжить");
      expect(t.host.querySelector("#need-minimum")?.getAttribute("aria-invalid")).toBe("true");
      expect(t.save).not.toHaveBeenCalled();
      await t.fill("need-minimum","400000"); await t.click("Продолжить");
      expect(t.host.querySelector('[role=alert]')?.textContent).toContain("не может превышать");
      await t.fill("need-minimum","200000"); await t.click("Продолжить");
      expect(t.host.querySelector(".need-step-heading h2")?.textContent).toBe("Как удобно возвращать?");
      expect(t.host.textContent).not.toContain("Показать, как кредит");
      expect(t.host.querySelector("#need-minimum")?.closest("[hidden]")).toBeTruthy();
      const disclosure = [...t.host.querySelectorAll("details")].find(item => item.textContent?.includes("Дополнительные условия"));
      expect(disclosure?.querySelector(".ui-disclosure-toggle")).not.toBeNull();
      await t.click("Посмотреть подходящие предложения");
      expect(t.save).toHaveBeenCalledWith(expect.objectContaining({"need.requested_amount":"300000.00","need.minimum_acceptable_amount":"200000.00","need.term_months":null}));
    } finally { await t.cleanup(); }
  });
  it("does not silently allow smaller offers when the client needs the full amount", async () => {
    const t = await setup();
    try {
      await t.click("Закупить товар"); await t.click("Продолжить"); await t.fill("need-amount","500000");
      await t.click("Нужна вся сумма"); await t.click("Продолжить");
      await t.click("Посмотреть подходящие предложения");
      expect(t.save).toHaveBeenCalledWith(expect.objectContaining({"need.requested_amount":"500000.00","need.minimum_acceptable_amount":"500000.00"}));
    } finally { await t.cleanup(); }
  });
});

