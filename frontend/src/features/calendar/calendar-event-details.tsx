import { SupplierPaymentDetails } from "@/features/supplier-payments/supplier-payment";
import { Link } from "react-router";
import { formatMoneyPrecise } from "@/shared/lib/format";
import { isDebtObligation, type CalendarEvent } from "./api";

export function EventDetails({ event, today, showDate=false }: { event: CalendarEvent; today?: string;showDate?:boolean }) {
  return <article className="calendar-detail-event">
    <div>{showDate&&<time className="mb-1 block text-xs text-muted-foreground" dateTime={event.date}>{new Date(event.date+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"long",timeZone:"UTC"})}{event.forecast?" · по графику":""}</time>}<p className="font-semibold">{event.title}</p>{today && isDebtObligation(event) && event.date < today && <p className="mt-1 text-xs text-destructive">Срок платежа прошёл</p>}
      {event.principal_amount !== undefined && event.interest_amount !== undefined && <p className="mt-1 text-xs text-muted-foreground">{formatMoneyPrecise(event.principal_amount)} — долг<br />{formatMoneyPrecise(event.interest_amount)} — проценты</p>}
      {event.supplier_payment && <SupplierPaymentDetails receipt={event.supplier_payment} />}
      {event.application_id && event.kind !== "account_movement" && !event.kind.startsWith("planned_") && <Link className="mt-1 inline-block text-xs font-semibold text-primary underline" to={`/cabinet?mode=portfolio&manage=${event.application_id}&action=repay`}>Управлять продуктом</Link>}</div>
    <strong className={`calendar-${event.direction}`}>{`${event.direction === "inflow" ? "+" : event.direction === "outflow" ? "−" : ""}${formatMoneyPrecise(event.amount)}`}</strong>
  </article>;
}
