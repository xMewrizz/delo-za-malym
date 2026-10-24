import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
export function ElapsedStatus({ title, description, focus = false, compact = false }: { title: string; description?: string; focus?: boolean; compact?: boolean }) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = setInterval(() => setSeconds(Math.floor((Date.now()-started)/1000)),250); return () => clearInterval(timer); }, [started]);
  useEffect(() => { if (focus) { ref.current?.focus({preventScroll:true}); ref.current?.scrollIntoView?.({block:"center"}); } }, [focus]);
  return <div ref={ref} tabIndex={-1} className={`bank-elapsed-status${compact ? " bank-elapsed-status-compact" : ""}`}>{!compact && <span className="bank-elapsed-icon"><Clock3 size={23} aria-hidden="true"/></span>}<div><p role="status"><strong>{title}</strong></p>{description && <p>{description}</p>}</div><span className="bank-elapsed-time" aria-live="off">Прошло {seconds} с</span></div>;
}
