import { useLayoutEffect, type RefObject } from "react";

type Fact = { value: string; x: number; y: number };
const easing = "cubic-bezier(.2,.75,.25,1)";

/** Animate committed UI changes, never pending guesses or a freshly loaded conversation history. */
export function useLumaMotion(root: RefObject<HTMLElement | null>, conversationId: string | null) {
  useLayoutEffect(() => {
    const scope = root.current;
    if (!scope || !conversationId) return;
    const seenMessages = new Set<string>();
    let facts = new Map<string, Fact>();
    const animations = new Set<Animation>();
    const byNode = new WeakMap<HTMLElement, Animation>();
    const highlights = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    function animate(node: HTMLElement, frames: Keyframe[], duration: number, delay = 0) {
      if (!node.animate) return;
      const previous = byNode.get(node);
      if (previous) { previous.cancel(); animations.delete(previous); }
      const animation = node.animate(frames, { duration, delay, easing, fill: "backwards" });
      animations.add(animation);
      byNode.set(node, animation);
      animation.onfinish = () => { animations.delete(animation); if (byNode.get(node) === animation) byNode.delete(node); };
    }
    function snapshot(initial = false) {
      if (!scope) return;
      // Read layout before starting any animation. Coordinates are local to the facts grid,
      // so scrolling the page or either pane cannot create a false layout movement.
      const nextFacts = new Map<string, Fact>();
      const nodes = [...scope.querySelectorAll<HTMLElement>(".collected-facts > .collected-fact")];
      const changes: { node: HTMLElement; previous?: Fact; current: Fact }[] = [];
      for (const node of nodes) {
        const key = node.dataset.liveField || node.querySelector("dt")?.textContent || "";
        const current = { value: node.querySelector("dd")?.textContent || "", x: node.offsetLeft, y: node.offsetTop };
        nextFacts.set(key, current);
        if (!initial) changes.push({ node, previous: facts.get(key), current });
      }
      const messages: HTMLElement[] = [];
      for (const node of scope.querySelectorAll<HTMLElement>("[data-message-key]")) {
        const key = node.dataset.messageKey!;
        if (!initial && !seenMessages.has(key)) messages.push(node);
        seenMessages.add(key);
      }
      facts = nextFacts;
      if (initial) return;
      let order = 0;
      for (const { node, previous, current } of changes) {
        const changed = node.dataset.liveStatic !== "true" && (!previous || previous.value !== current.value);
        if (changed) {
          const value = node.querySelector<HTMLElement>("dd");
          if (value) animate(value, [{ opacity: .35, transform: "translateY(9px)" }, { opacity: 1, transform: "translateY(0)" }], 520, order++ * 70);
          clearTimeout(highlights.get(node));
          node.setAttribute("data-live-updated", "true");
          highlights.set(node, setTimeout(() => { node.removeAttribute("data-live-updated"); highlights.delete(node); }, 1500));
        }
        if (previous && (previous.x !== current.x || previous.y !== current.y)) {
          const x = Math.max(-56, Math.min(56, previous.x - current.x));
          const y = Math.max(-56, Math.min(56, previous.y - current.y));
          animate(node, [{ transform: `translate(${x}px,${y}px)` }, { transform: "translate(0,0)" }], 420);
        }
      }
      for (const node of messages) {
        const user = node.classList.contains("assistant-message-user");
        animate(node, [{ opacity: .15, transform: `translateY(${user ? 8 : 14}px) scale(.99)` }, { opacity: 1, transform: "translateY(0) scale(1)" }], user ? 280 : 460);
      }
    }
    function stop() {
      for (const animation of animations) animation.cancel();
      animations.clear();
      for (const [node, timer] of highlights) { clearTimeout(timer); node.removeAttribute("data-live-updated"); }
      highlights.clear();
    }
    snapshot(true);
    const observer = new MutationObserver(() => snapshot());
    observer.observe(scope, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); stop(); };
  }, [root, conversationId]);
}
