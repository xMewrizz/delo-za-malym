import {useEffect, type RefObject} from "react";

/** Limit both wheel travel and actual velocity, including across scene boundaries. */
export function installLandingWheel(root: HTMLElement) {
  let frame = 0, target = window.scrollY, lastFrame = 0, writing = false;
  const cancel = () => {cancelAnimationFrame(frame); frame = 0; lastFrame = 0; target = window.scrollY;};
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  function tick(time: number) {
    const elapsed = lastFrame ? Math.min(32, time-lastFrame) : 16.67;
    lastFrame = time;
    const current = window.scrollY;
    target = Math.max(0, Math.min(maxScroll(), target));
    const remaining = target-current;
    const eased = remaining*(1-Math.exp(-elapsed/100));
    // A burst can keep refreshing the destination. A per-event clamp alone therefore
    // cannot stop an accelerating wheel/trackpad from skipping the next section.
    const step = Math.max(-.54*elapsed, Math.min(.54*elapsed, eased));
    const next = Math.abs(remaining) < .6 ? target : current+step;
    writing = true; window.scrollTo({top: next, behavior: "instant"}); writing = false;
    if (next !== target) frame = requestAnimationFrame(tick);
    else {frame = 0; lastFrame = 0;}
  }
  function wheel(event: WheelEvent) {
    if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX)>Math.abs(event.deltaY) || !event.deltaY) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!root.isConnected || !element || element.closest("input,textarea,select,[contenteditable=true],[role=dialog]")) return;
    // A nested scrollable panel owns its gesture, including at its edges.
    for (let parent: Element|null=element; parent && parent!==document.body && parent!==document.documentElement; parent=parent.parentElement) {
      if (parent.scrollHeight>parent.clientHeight+1 && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return;
    }
    event.preventDefault();
    const current=window.scrollY;
    const pixels=event.deltaY*(event.deltaMode===1 ? 18 : event.deltaMode===2 ? window.innerHeight : 1);
    const delta=Math.max(-81, Math.min(81, pixels*.73));
    // Reversing the wheel discards the previous direction's remaining travel.
    if (!frame || Math.sign(delta)!==Math.sign(target-current)) target=current;
    target=Math.max(0,Math.min(maxScroll(),current+112,Math.max(current-112,target+delta)));
    if (!frame) frame=requestAnimationFrame(tick);
  }
  const externalScroll = () => {if (!writing && frame && Math.abs(window.scrollY-target)>200) cancel();};
  window.addEventListener("wheel",wheel,{passive:false});
  window.addEventListener("pointerdown",cancel,{passive:true});
  window.addEventListener("keydown",cancel);
  window.addEventListener("scroll",externalScroll,{passive:true});
  return () => {cancel();window.removeEventListener("wheel",wheel);window.removeEventListener("pointerdown",cancel);window.removeEventListener("keydown",cancel);window.removeEventListener("scroll",externalScroll);};
}

export function useLandingWheel(root: RefObject<HTMLElement|null>) {
  useEffect(()=>{
    // Wheel input has the same pace on narrow desktop windows and in the footer.
    // Touch gestures are unaffected because this handler only receives wheel events.
    if (root.current) return installLandingWheel(root.current);
  },[root]);
}
