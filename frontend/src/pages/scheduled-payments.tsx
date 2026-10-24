import { useSavedDraft } from "@/shared/lib/saved-draft";
import { Button } from "@/shared/ui/button";
import { Link } from "react-router";
import type { CalendarData } from "@/features/calendar/api";
import { formatMoneyPrecise } from "@/shared/lib/format";
const labels = { pending: "Запланирован", executed: "Выполнен", failed: "Не исполнен", cancelled: "Отменён" };
export function ScheduledPayments({ orders, compact = false }: { orders: CalendarData["payment_orders"]; compact?: boolean }) {
  const [seen, setSeen] = useSavedDraft<string[]>("delo-seen-payment-statuses", []);
  const visible = orders.filter(item => !compact || item.status === "pending" || (["failed", "executed"].includes(item.status) && !seen.includes(`${item.order_id}:${item.status}`))).slice().sort((a,b) => b.execution_date.localeCompare(a.execution_date));
  if (!visible.length) return null;
  return <section className="scheduled-payments" aria-label="Запланированные платежи"><h2>{compact ? "Запланированные платежи и их статус" : "Запланированные платежи"}</h2>{compact && visible.some(item => item.status !== "pending") && <Button variant="ghost" size="sm" onClick={() => setSeen(current => [...new Set([...current, ...visible.filter(item => item.status !== "pending").map(item => `${item.order_id}:${item.status}`)])])}>Отметить результаты прочитанными</Button>}<div>{visible.map(item => <Link key={item.order_id} onClick={() => setSeen(current => [...new Set([...current, `${item.order_id}:${item.status}`])])} className={`scheduled-payment scheduled-payment-${item.status}`} to={`/cabinet?mode=portfolio&manage=${item.application_id}&action=repay`}><span><strong>{labels[item.status]} · {new Date(item.execution_date + "T12:00:00").toLocaleDateString("ru-RU")}</strong><small>{item.error || `Кредит № ${item.application_id.slice(0,6)}`}</small></span><b>{formatMoneyPrecise(item.amount)}</b></Link>)}</div></section>;
}
