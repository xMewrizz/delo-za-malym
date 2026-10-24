// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router";
import {afterEach,describe,expect,it,vi} from "vitest";
import {DocumentationPage} from "./documentation-page";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
afterEach(()=>vi.restoreAllMocks());

describe("documentation reader",()=>{
 it("resolves a direct chapter link after the page has mounted and renders every TOC destination",async()=>{
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const scroll=vi.fn();
  Object.defineProperty(HTMLElement.prototype,"scrollIntoView",{configurable:true,value:scroll});
  try{
   await act(async()=>{root.render(<MemoryRouter initialEntries={["/documentation#credit-line"]}><DocumentationPage/></MemoryRouter>);await new Promise(resolve=>setTimeout(resolve,30));});
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
   const links=[...host.querySelectorAll<HTMLAnchorElement>(".documentation-toc nav a")];
   expect(links).toHaveLength(30);
   expect(links.every(link=>host.querySelector(link.hash))).toBe(true);
   expect(document.activeElement?.id).toBe("credit-line-title");
   expect(scroll).toHaveBeenCalled();
   expect(host.querySelectorAll(".documentation-table-scroll table").length).toBeGreaterThan(4);
   const toggle=host.querySelector<HTMLButtonElement>(".documentation-toc-toggle")!;
   await act(async()=>toggle.click());expect(toggle.getAttribute("aria-expanded")).toBe("true");
   await act(async()=>links.find(link=>link.hash==="#servicing")!.click());
   expect(toggle.getAttribute("aria-expanded")).toBe("false");
   expect(host.querySelector('.documentation-toc a[aria-current="location"]')?.getAttribute("href")).toBe("/documentation#servicing");
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
   const previous=scroll.mock.calls.length;
   await act(async()=>links.find(link=>link.hash==="#servicing")!.click());
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
   expect(scroll.mock.calls.length).toBeGreaterThan(previous);
  }finally{await act(async()=>root.unmount());host.remove();}
 });
});
