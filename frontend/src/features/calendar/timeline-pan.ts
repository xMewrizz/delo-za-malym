/** Keep wheel motion in calendar days, independent of zoom and OS acceleration. */
export function installTimelinePan(scroller: HTMLElement, dayWidth: () => number) {
  let frame = 0, lastTime = 0, target = scroller.scrollLeft, position = target;
  const stop = () => { cancelAnimationFrame(frame); frame = 0; lastTime = 0; target = position = scroller.scrollLeft; };
  function tick(time: number) {
    const elapsed = lastTime ? Math.min(32, time - lastTime) : 16.67;
    lastTime = time;
    const unit = dayWidth();
    target = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, target));
    const remaining = target - position;
    const limit = unit * 12 * elapsed / 1000;
    const step = Math.max(-limit, Math.min(limit, remaining * (1 - Math.exp(-elapsed / 90))));
    if (Math.abs(remaining) < .6) { scroller.scrollLeft = position = target; frame = 0; lastTime = 0; return; }
    // Retain subpixel travel at high refresh rates and the three-month scale.
    position += step;
    scroller.scrollLeft = position;
    frame = requestAnimationFrame(tick);
  }
  function wheel(event: WheelEvent) {
    if (!event.cancelable || event.defaultPrevented || event.ctrlKey || event.metaKey) return;
    const surface = event.target instanceof Element ? event.target : null;
    // The frozen product column keeps native vertical scrolling, including with 20+ rows.
    if (surface?.closest(".payment-timeline-product,.payment-timeline-corner") && !event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const unit = dayWidth();
    if (!raw || !unit) return;
    event.preventDefault();
    const pixels = raw * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? scroller.clientWidth : 1);
    const delta = Math.max(-3 * unit, Math.min(3 * unit, pixels * .75));
    const current = scroller.scrollLeft;
    if (!frame) position = current;
    if (!frame || Math.sign(delta) !== Math.sign(target - current)) target = current;
    target = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, current + 5 * unit, Math.max(current - 5 * unit, target + delta)));
    if (!frame) frame = requestAnimationFrame(tick);
  }
  scroller.addEventListener("wheel", wheel, { passive: false });
  scroller.addEventListener("pointerdown", stop);
  scroller.addEventListener("keydown", stop);
  return {
    stop,
    /** Rebase the offscreen date buffer without changing the visible date or velocity. */
    shift(pixels: number) { target += pixels; position += pixels; scroller.scrollLeft += pixels; },
    dispose() { stop(); scroller.removeEventListener("wheel", wheel); scroller.removeEventListener("pointerdown", stop); scroller.removeEventListener("keydown", stop); },
  };
}
