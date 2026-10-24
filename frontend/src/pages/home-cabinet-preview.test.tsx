// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {describe,expect,it,vi} from "vitest";
import {HomeCabinetShowcase} from "./home-cabinet-preview";
import {ScrollTrigger} from "gsap/ScrollTrigger";
vi.mock("gsap",()=>({gsap:{registerPlugin:vi.fn(),from:vi.fn(),timeline:()=>({from:vi.fn()}),matchMedia:()=>({add:(_query:string,setup:()=>void)=>setup(),revert:vi.fn()}),context:(setup:()=>void)=>{setup();return {revert:vi.fn()};}}}));
vi.mock("gsap/ScrollTrigger",()=>({ScrollTrigger:{create:vi.fn(()=>({kill:vi.fn()}))}}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
describe("cabinet promo composition",()=>{
 it("keeps the cabinet next to a readable local explanation for each focus",async()=>{
  const host=document.createElement("div"),root=createRoot(host);
  try{
   await act(async()=>root.render(<MemoryRouter><HomeCabinetShowcase/></MemoryRouter>));
   expect(host.querySelector(".ep-overview-chapter[data-active=true] h2")?.textContent).toContain("Видеть главное");
   expect(host.querySelectorAll(".ep-overview-tabs button")).toHaveLength(0);
   expect(host.querySelectorAll(".ep-overview-tabs li")).toHaveLength(3);
   const update=vi.mocked(ScrollTrigger.create).mock.calls.at(-1)![0]!.onUpdate!;
   await act(async()=>update({progress:.45} as Parameters<typeof update>[0]));
   expect(host.querySelector(".ep-overview-showcase")?.getAttribute("data-focus")).toBe("1");
   await act(async()=>update({progress:.33} as Parameters<typeof update>[0]));
   expect(host.querySelector('[aria-current="step"]')?.textContent).toBe("Платежи");
   expect(host.querySelector(".ep-overview-chapter[data-active=true] .ep-overview-fact")?.textContent).toContain("18 ноября");
   await act(async()=>update({progress:.8} as Parameters<typeof update>[0]));
   expect(host.querySelector(".ep-overview-chapter[data-active=true] .ep-overview-fact")?.textContent).toContain("1 заявка");
   expect(host.querySelector('[aria-current="step"]')?.textContent).toBe("Заявки");
   await act(async()=>update({progress:0} as Parameters<typeof update>[0]));
   expect(host.querySelector('[aria-current="step"]')?.textContent).toBe("Деньги");
   expect(host.querySelectorAll(".ep-cabinet")).toHaveLength(1);
   expect(host.querySelectorAll('.ep-overview-chapter[aria-hidden="false"]')).toHaveLength(1);
   expect(host.querySelectorAll('.ep-overview-chapter')).toHaveLength(3);
  }finally{await act(async()=>root.unmount());}
 });
});
