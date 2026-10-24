// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {installTimelinePan} from "./timeline-pan";

describe("timeline wheel pacing",()=>{
 let scroller:HTMLDivElement,unit:number,frames:Map<number,FrameRequestCallback>,time:number,sequence:number,pan:ReturnType<typeof installTimelinePan>;
 beforeEach(()=>{
  scroller=document.createElement("div");document.body.append(scroller);unit=40;time=0;sequence=0;frames=new Map();
  Object.defineProperties(scroller,{scrollWidth:{value:20000},clientWidth:{value:1000}});scroller.scrollLeft=5000;
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>frames.delete(id));
  pan=installTimelinePan(scroller,()=>unit);
 });
 afterEach(()=>{pan.dispose();scroller.remove();vi.unstubAllGlobals();});
 const wheel=(deltaY:number,target:HTMLElement=scroller,extra:WheelEventInit={})=>{const e=new WheelEvent("wheel",{deltaY,bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e;};
 function tick(){const callbacks=[...frames.values()];frames.clear();time+=16.67;callbacks.forEach(callback=>callback(time));}
 function settle(){for(let i=0;i<150&&frames.size;i++)tick();expect(frames.size).toBe(0);}
 it("limits even an accelerated wheel notch to three days at either scale",()=>{
  expect(wheel(10000).defaultPrevented).toBe(true);settle();expect(scroller.scrollLeft).toBeCloseTo(5120);
  unit=10;wheel(10000);settle();expect(scroller.scrollLeft).toBeCloseTo(5150);
 });
 it("limits sustained motion to twelve days per second and leaves no long inertial queue",()=>{
  for(let i=0;i<60;i++){wheel(3000);const before=scroller.scrollLeft;tick();expect(scroller.scrollLeft-before).toBeLessThanOrEqual(unit*12*.01668);}
  expect(scroller.scrollLeft-5000).toBeLessThanOrEqual(unit*12*1.001);
  const before=scroller.scrollLeft;settle();expect(scroller.scrollLeft-before).toBeLessThanOrEqual(5*unit);
 });
 it("preserves the remaining travel when offscreen dates are rebased and responds immediately to reversal",()=>{
  wheel(3000);tick();pan.shift(2400);settle();expect(scroller.scrollLeft).toBeCloseTo(7520);
  wheel(3000);wheel(-3000);settle();expect(scroller.scrollLeft).toBeCloseTo(7400);
 });
 it("preserves zoom and vertical product scrolling, cancels on direct navigation and cleans up",()=>{
  const product=document.createElement("button");product.className="payment-timeline-product";scroller.append(product);
  expect(wheel(100,product).defaultPrevented).toBe(false);expect(wheel(100,scroller,{ctrlKey:true}).defaultPrevented).toBe(false);
  wheel(100);scroller.dispatchEvent(new Event("pointerdown"));expect(frames.size).toBe(0);
  pan.dispose();expect(wheel(100).defaultPrevented).toBe(false);
 });
 it("accumulates subpixel movement instead of stalling on a narrow date grid",()=>{
  let rounded=5000;Object.defineProperty(scroller,"scrollLeft",{configurable:true,get:()=>rounded,set:(value:number)=>{rounded=Math.round(value);}});
  unit=6;wheel(10000);settle();expect(scroller.scrollLeft).toBe(5018);
 });
});
