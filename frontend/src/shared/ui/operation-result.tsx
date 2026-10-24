import { useEffect, useId, useRef } from "react";
import { Ban, CalendarClock, Check, ArrowRight, CircleAlert } from "lucide-react";
import { Link } from "react-router";
import { Button } from "./button";
import "./operation-result.css";

export type OperationReceipt = {
  title: string;
  description: string;
  amount?: string;
  tone?: "success" | "scheduled" | "neutral" | "error";
  facts: { label: string; value: string }[];
  calendarHref?: string;
  calendarLabel?: string;
  anotherLabel?: string;
};

export function OperationResult({ receipt, onDone, onAnother }: {
  receipt: OperationReceipt;
  onDone?: () => void;
  onAnother?: () => void;
}) {
  const heading = useId();
  const ref = useRef<HTMLElement>(null);
  const Icon = receipt.tone === "scheduled" ? CalendarClock : receipt.tone === "neutral" ? Ban : receipt.tone === "error" ? CircleAlert : Check;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.closest<HTMLElement>(".funding-dialog-body, .supplier-dialog-body")?.scrollTo?.({ top: 0, behavior: "auto" });
  }, []);
  return <section ref={ref} tabIndex={-1} aria-labelledby={heading} className={`operation-result funding-success operation-result-${receipt.tone || "success"}`}>
    <div className="operation-result-status" role="status"><span className="operation-result-icon"><Icon size={27} aria-hidden="true" /></span><h3 id={heading}>{receipt.title}</h3><p>{receipt.description}</p></div>
    {receipt.amount && <strong className="operation-result-amount">{receipt.amount}</strong>}
    {receipt.facts.length > 0 && <dl>{receipt.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
    <div className="operation-result-actions">{onDone && <Button type="button" onClick={onDone}>Готово<Check size={16} /></Button>}{receipt.calendarHref && <Button asChild variant="outline"><Link to={receipt.calendarHref}>{receipt.calendarLabel || "Открыть график"}<ArrowRight size={16} /></Link></Button>}{onAnother && <Button type="button" variant="ghost" onClick={onAnother}>{receipt.anotherLabel || "Другая операция"}</Button>}</div>
  </section>;
}
