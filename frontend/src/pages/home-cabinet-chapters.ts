/** A small dead band keeps an idle wheel at a chapter boundary from flickering. */
export function overviewChapterAt(progress:number,current:number) {
  const next=Math.min(2,Math.max(0,Math.floor(progress*3)));
  if(next>current && progress<(current+1)/3+.025) return current;
  if(next<current && progress>current/3-.025) return current;
  return next;
}
