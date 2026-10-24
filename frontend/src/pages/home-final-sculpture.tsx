import {useId} from "react";
import "./home-final-sculpture.css";

// The existing brand mark, extruded as shallow vector layers; no bitmap backdrop.
const frame="M276 80H156A80 80 0 0 0 76 160V356A80 80 0 0 0 156 436H356A80 80 0 0 0 436 356V236A20 20 0 0 0 416 216H380A20 20 0 0 0 360 236V328A28 28 0 0 1 332 356H184A28 28 0 0 1 156 328V184A28 28 0 0 1 184 156H276A20 20 0 0 0 296 136V100A20 20 0 0 0 276 80Z";

export function FinalBrandSculpture() {
 const id=useId().replaceAll(":","");
 return <div className="ep-final-emblem depth-3" data-depth="3" aria-hidden="true">
  <div className="ep-final-emblem-entry"><div className="ep-final-emblem-float"><div className="ep-final-emblem-stack">
   {[7,6,5,4,3,2,1].map(layer=><svg key={layer} viewBox="0 0 512 512" className="ep-final-emblem-side" style={{transform:`translateZ(${-layer*4}px)`}}><path d={frame}/><rect x="328" y="68" width="116" height="116" rx="26"/></svg>)}
   <svg viewBox="0 0 512 512" className="ep-final-emblem-face"><defs><linearGradient id={`${id}-frame`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#dfc6ff"/><stop offset=".5" stopColor="#b893f3"/><stop offset="1" stopColor="#7544d8"/></linearGradient><linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f0ff9a"/><stop offset=".55" stopColor="#e0ff53"/><stop offset="1" stopColor="#b7d62c"/></linearGradient></defs><path d={frame} fill={`url(#${id}-frame)`} stroke="#ffffff55" strokeWidth="1.5"/><rect className="ep-final-emblem-tile" x="328" y="68" width="116" height="116" rx="26" fill={`url(#${id}-tile)`} stroke="#f5ffb5" strokeWidth="1.5"/></svg>
  </div></div></div><span className="ep-final-emblem-ground depth-2" data-depth="2"/>
 </div>;
}
