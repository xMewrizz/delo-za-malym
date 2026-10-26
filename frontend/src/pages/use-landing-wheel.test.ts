// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {installLandingWheel} from "./use-landing-wheel";

describe("landing wheel travel",()=>{
 let root:HTMLDivElement,dispose:()=>void,frames:Map<number,FrameRequestCallback>,sequence:number,time:number;
 beforeEach(()=>{
  root=document.createElement("div");document.body.append(root);
  frames=new Map();sequence=0;time=0;
  vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>{frames.set(++sequence,fn);return sequence;});
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>frames.delete(id));
  vi.stubGlobal("scrollY",0);vi.stubGlobal("innerHeight",800);
  Object.defineProperty(document.documentElement,"scrollHeight",{configurable:true,value:20000});
  vi.stubGlobal("scrollTo",vi.fn((options:ScrollToOptions)=>vi.stubGlobal("scrollY",options.top??0)));
  dispose=installLandingWheel(root);
 });
 afterEach(()=>{dispose();root.remove();vi.unstubAllGlobals();});
 function wheel(deltaY:number,extra:WheelEventInit={}){const event=new WheelEvent("wheel",{deltaY,bubbles:true,cancelable:true,...extra});root.dispatchEvent(event);return event;}
 function settle(){for(let i=0;i<140&&frames.size;i++){const pending=[...frames.values()];frames.clear();time+=16.67;pending.forEach(fn=>fn(time));}expect(frames.size).toBe(0);}
 it("keeps an ordinary wheel notch close to native travel",()=>{
  wheel(120);settle();expect(window.scrollY).toBeCloseTo(118.8,0);
 });
 it("does not cancel its own asynchronous scroll events, but yields to external navigation",()=>{
  wheel(6000);wheel(6000);
  const pending=[...frames.values()];frames.clear();time+=16.67;pending.forEach(fn=>fn(time));
  window.dispatchEvent(new Event("scroll"));expect(frames.size).toBe(1);
  settle();expect(window.scrollY).toBeCloseTo(242,0);
  wheel(120);vi.stubGlobal("scrollY",1000);window.dispatchEvent(new Event("scroll"));expect(frames.size).toBe(0);
 });
 it("a large wheel event cannot skip a scene or jump when leaving it",()=>{
  vi.stubGlobal("scrollY",12000);
  expect(wheel(10000).defaultPrevented).toBe(true);
  settle();expect(window.scrollY).toBeCloseTo(12154,0);
  const values=vi.mocked(window.scrollTo).mock.calls.map(([options])=>(options as ScrollToOptions).top!);
  expect(values[0]-12000).toBeLessThan(17.43);
 });
 it("does not accumulate a long inertial queue, and reversing responds immediately",()=>{
  for(let i=0;i<30;i++)wheel(3000);
  settle();expect(window.scrollY).toBeCloseTo(242,0);
  wheel(1000);wheel(-1000);settle();expect(window.scrollY).toBeCloseTo(88,0);
 });
 it("bounds sustained input by time, rather than accelerating with the event rate",()=>{
  for(let i=0;i<60;i++){
   wheel(6000);
   const before=window.scrollY,pending=[...frames.values()];frames.clear();time+=16.67;pending.forEach(fn=>fn(time));
   expect(window.scrollY-before).toBeLessThanOrEqual(17.43);
  }
  expect(window.scrollY).toBeLessThanOrEqual(1046);
  const beforeTail=window.scrollY;settle();expect(window.scrollY-beforeTail).toBeLessThanOrEqual(242);
 });
 it("keeps the same pace over page gaps and the footer outside the landing root",()=>{
  const footer=document.createElement("footer");document.body.append(footer);
  const event=new WheelEvent("wheel",{deltaY:5000,bubbles:true,cancelable:true});footer.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);settle();expect(window.scrollY).toBeCloseTo(154,0);footer.remove();
 });
 it("preserves zoom and horizontal gestures, nested panels, keyboard cancellation and cleanup",()=>{
  expect(wheel(100,{ctrlKey:true}).defaultPrevented).toBe(false);
  expect(wheel(10,{deltaX:100}).defaultPrevented).toBe(false);
  const panel=document.createElement("div");panel.style.overflowY="auto";root.append(panel);
  Object.defineProperties(panel,{scrollHeight:{value:500},clientHeight:{value:100}});
  const nested=new WheelEvent("wheel",{deltaY:100,bubbles:true,cancelable:true});panel.dispatchEvent(nested);expect(nested.defaultPrevented).toBe(false);
  wheel(300);window.dispatchEvent(new KeyboardEvent("keydown",{key:"PageDown"}));expect(frames.size).toBe(0);
  dispose();expect(wheel(100).defaultPrevented).toBe(false);
 });
});
