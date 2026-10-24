// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {ApplicationMoreActions} from "./applications-hub";

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
it("creates a similar application only after selecting the secondary menu action",async()=>{
 const host=document.createElement("div");host.className="cabinet-shell";document.body.append(host);
 const root=createRoot(host),repeat=vi.fn();
 try{
  await act(async()=>root.render(<ApplicationMoreActions busy={false} onRepeat={repeat}/>));
  const trigger=host.querySelector<HTMLButtonElement>('[aria-label="Действия с заявкой"]')!;
  expect(host.querySelector('[role="menuitem"]')).toBeNull();
  await act(async()=>trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
  const item=host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(item.textContent).toBe("Создать похожую заявку");
  expect(repeat).not.toHaveBeenCalled();
  await act(async()=>item.click());
  expect(repeat).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="menuitem"]')).toBeNull();
  await act(async()=>root.render(<ApplicationMoreActions busy onRepeat={repeat}/>));
  expect(trigger.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();}
});
