import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CreditCard, Landmark, Plus, Repeat2, Wallet, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Link, useSearchParams } from "react-router";
import { applicationQueries } from "@/features/applications";
import { calendarQuery } from "@/features/calendar/api";
import { CreditLinePanel } from "@/features/credit-line/credit-line-panel";
import { OverdraftPanel } from "@/features/overdraft/overdraft-panel";
import { LoanPaymentPanel } from "@/features/loans/loan-payment-panel";
import { getErrorMessage } from "@/shared/api/client";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { ScheduledPayments } from "./scheduled-payments";
import { CashBalanceBreakdown } from "./cash-balance-breakdown";
import { portfolioProducts, sumDisplayAmounts, type PortfolioProduct } from "./portfolio-products";
import "./financing-portfolio.css";

const dateLabel = (value: string) => new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const closedProduct = (product: PortfolioProduct) => ["closed", "refinanced"].includes(product.status);
const statuses: Record<string, string> = { closed: "Погашен", refinanced: "Рефинансирован", expired: "Срок лимита истёк", overdue: "Просрочка" };
type ManageAction = "draw" | "repay";

function UpcomingPayments({product}:{product:PortfolioProduct}) {
  if(closedProduct(product)||!product.upcomingPayments?.length) return null;
  const shortDate=(date:string)=>new Date(date+"T12:00:00Z").toLocaleDateString("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"});
  return <section className="funding-upcoming" aria-label="Ближайшие платежи по продукту">
    <p>Ближайшие платежи</p>
    <ol>{product.upcomingPayments.map((payment,index)=><li key={payment.date} data-next={index===0}><span>{shortDate(payment.date)}</span><strong>{formatMoneyPrecise(payment.amount)}</strong></li>)}</ol>
    {product.kind==="loan"&&product.principalStartsOn && <div className="funding-grace-note"><CalendarDays size={15} aria-hidden="true"/><span>Сейчас — только проценты. Возврат основного долга — с {shortDate(product.principalStartsOn).replace(/\.$/,"")}.</span></div>}
  </section>;
}

export function LimitUtilization({ product }: { product: PortfolioProduct }) {
  if (product.kind !== "limit" || closedProduct(product)) return null;
  const total = Number(product.limit);
  const used = product.principal == null ? null : Number(product.principal);
  const known = Number.isFinite(total) && total > 0 && used != null && Number.isFinite(used) && used >= 0;
  return <div className="funding-utilization">
    <div className="funding-utilization-label"><span>Использовано</span><strong>{known ? formatMoneyPrecise(String(used)) : "Уточняется"}</strong></div>
    {known && <div className="funding-utilization-track" role="meter" aria-label="Использовано из лимита" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used!} aria-valuetext={`${formatMoneyPrecise(String(used))} из ${formatMoneyPrecise(String(total))}`}><span style={{width: `${Math.min(100, used! / total * 100)}%`}}/></div>}
  </div>;
}

export function PortfolioProductCard({ product, onManage }: { product: PortfolioProduct; onManage?: (product: PortfolioProduct, action: ManageAction, trigger?: HTMLButtonElement) => void }) {
  const closed = closedProduct(product);
  const line = product.productId === "revolving_credit_line";
  const overdraft = product.productId === "overdraft";
  const refinancing = product.productId === "refinancing";
  const manageable = Boolean(product.applicationId && product.status !== "refinanced" && (overdraft || line || product.kind === "loan"));
  const Icon = line ? Repeat2 : product.kind === "limit" ? Wallet : CreditCard;
  return <article className={`funding-card ${product.kind === "limit" ? "funding-card-limit" : ""} ${closed ? "funding-card-closed" : ""}`} aria-labelledby={`funding-${product.id}`}>
    <div className="funding-card-heading"><span className="funding-card-icon"><Icon size={19} /></span><span className="funding-card-status">{closed ? <Check size={13} /> : <i />}{statuses[product.status] || (product.kind === "limit" ? "Лимит открыт" : "Действует")}</span><span className="funding-card-number">{product.applicationId ? `№ ${product.applicationId.slice(0, 6)}` : "Данные банка"}</span></div>
    <div className="funding-card-summary"><h3 id={`funding-${product.id}`}>{product.title}</h3>
    {product.pendingPayment && <p className="funding-card-order">Запланирован платёж на {dateLabel(product.pendingPayment.date)} · {formatMoneyPrecise(product.pendingPayment.amount)}</p>}
    <div className="funding-card-balance"><div><p>{product.kind === "limit" ? "Можно использовать" : "Остаток основного долга"}</p><strong>{product.kind === "limit" ? product.available == null ? "Уточняется" : formatMoney(product.available) : product.principal == null ? "Уточняется" : formatMoney(product.principal)}</strong><small>{product.kind === "limit" ? `из ${formatMoney(product.limit || "0")} открытого лимита` : product.originalPrincipal ? refinancing ? `из ${formatMoney(product.originalPrincipal)} на рефинансирование` : `из ${formatMoney(product.originalPrincipal)} полученных` : "Первоначальная сумма не передана банком"}</small></div></div>
    <LimitUtilization product={product}/>
    {refinancing && product.applicationId && <p className="funding-refinancing-note"><Repeat2 size={16} aria-hidden="true"/><span>Сумма направлена на погашение прежних кредитов. На расчётный счёт зачислено 0 ₽.</span></p>}
    {product.kind === "limit" && <p className="funding-limit-explainer">{line ? "Погашайте основной долг — и берите деньги снова без новой заявки." : "Овердрафт покрывает нехватку денег на счёте; поступления уменьшают долг."}</p>}
    <UpcomingPayments product={product}/>
    </div>
    <dl className="funding-card-facts"><div><dt>Ставка</dt><dd>{product.annualRate == null ? "Не передана" : `${Number(product.annualRate).toLocaleString("ru-RU")}% годовых`}</dd></div><div><dt>Проценты на сегодня</dt><dd>{product.accruedInterest == null ? "Нет данных" : formatMoneyPrecise(product.accruedInterest)}</dd></div><div><dt>Ближайший платёж</dt><dd><span className="funding-payment-amount">{product.nextPayment ? formatMoneyPrecise(product.nextPayment.amount) : closed ? "Будущих платежей нет" : product.kind === "limit" ? "После использования" : "Нет данных о графике"}</span></dd></div><div><dt>Дата платежа</dt><dd>{product.nextPayment ? dateLabel(product.nextPayment.date) : "—"}</dd></div><div><dt>Окончание договора</dt><dd>{product.maturity ? dateLabel(product.maturity) : "Нет данных"}</dd></div></dl>
    <div className="funding-card-actions">{manageable && onManage && <Button variant={line || overdraft ? "default" : "outline"} onClick={event => onManage(product, line || overdraft ? "draw" : "repay", event.currentTarget)}>{line ? <Plus size={16} /> : <ArrowDownLeft size={16} />}{closed ? "История операций" : overdraft ? "Оплатить со счёта" : line ? "Получить деньги" : "Внести платёж"}</Button>}{(line || overdraft) && !closed && onManage && <Button variant="outline" onClick={event => onManage(product, "repay", event.currentTarget)}>{overdraft ? "Зачислить поступление" : "Внести платёж"}</Button>}{closed ? product.applicationId && <Link to={`/cabinet?mode=applications&application=${encodeURIComponent(product.applicationId)}`}>Условия и история<ArrowRight size={15}/></Link> : <Link to={`/cabinet?mode=calendar&product=${encodeURIComponent(product.id)}${product.nextPayment ? `&date=${product.nextPayment.date}` : ""}`}>График<CalendarDays size={15}/></Link>}</div>
  </article>;
}

/** One grid across product types: a short category never leaves an empty column. */
export function PortfolioProductGrid({products,onManage,label="Продукты"}: {
  products: PortfolioProduct[];
  onManage?: (product: PortfolioProduct, action: ManageAction, trigger?: HTMLButtonElement) => void;
  label?: string;
}) {
  if (!products.length) return null;
  return <section className="funding-grid" aria-label={label}>{products.map(product=><PortfolioProductCard key={product.id} product={product} onManage={onManage}/>)}</section>;
}

export function FinancingPortfolio() {
  const [search, setSearch] = useSearchParams();
  const calendar = useQuery(calendarQuery);
  const profile = useQuery(applicationQueries.profile());
  const [filter, setFilter] = useState<"all" | "loan" | "limit" | "closed">("all");
  const selected: { id: string; action: ManageAction } | null = search.get("manage") ? { id: `app:${search.get("manage")}`, action: search.get("action") === "draw" ? "draw" : "repay" } : null;
  const returnFocus = useRef<HTMLElement | null>(null);
  const loading = calendar.isPending || profile.isPending;
  const products = calendar.data && profile.data ? portfolioProducts(profile.data.financials, calendar.data) : [];
  const active = products.filter(product => !closedProduct(product));
  const closed = products.filter(closedProduct);
  const shown = filter === "closed" ? closed : active.filter(product => filter === "all" || product.kind === filter);
  const focused = products.find(product => product.id === selected?.id);
  const knownDebt = active.every(product => product.principal != null);
  const debt = sumDisplayAmounts(active.map(product => ({ amount: product.principal || "0" })));
  const available = sumDisplayAmounts(active.filter(product => product.kind === "limit").map(product => ({ amount: product.available || "0" })));
  const nextDate = active.map(product => product.nextPayment?.date).filter((value): value is string => Boolean(value)).sort()[0];
  const nextAmount = sumDisplayAmounts(active.filter(product => product.nextPayment?.date === nextDate).map(product => ({ amount: product.nextPayment!.amount })));
  const tabs = [
    { id: "all", label: "Все активные", count: active.length },
    { id: "loan", label: "Кредиты", count: active.filter(product => product.kind === "loan").length },
    { id: "limit", label: "Лимиты и линии", count: active.filter(product => product.kind === "limit").length },
    { id: "closed", label: "Закрытые", count: closed.length },
  ] as const;
  function manage(product: PortfolioProduct, action: ManageAction, trigger?: HTMLButtonElement) { returnFocus.current = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null); setSearch(current => { const next = new URLSearchParams(current); next.set("manage", product.applicationId!); next.set("action", action); return next; }, { replace: true }); }
  function closeManagement() {
    if (search.has("manage")) setSearch(current => { const next = new URLSearchParams(current); next.delete("manage"); next.delete("action"); return next; }, { replace: true });
  }

  let interrupted: string[] = [];
  try { interrupted = Object.keys(localStorage).filter(key => key.startsWith("delo-pending-operation:")).map(key => key.slice(key.lastIndexOf(":") + 1)).filter(id => products.some(product => product.applicationId === id)); } catch { /* Optional recovery list. */ }
  return <div className="financing-portfolio funding-workspace">
    <div className="funding-intro"><div><h2>Продукты и обязательства</h2></div><Button asChild variant="outline"><Link to="/cabinet?mode=calendar">Платёжный календарь<CalendarDays size={16} /></Link></Button></div>
    <div className="funding-summary" aria-label="Сводка финансирования"><div><Wallet size={17} /><span>На счёте</span><strong>{loading ? "…" : profile.data?.financials.cash_balance == null ? "Уточняется" : formatMoney(profile.data.financials.cash_balance)}</strong><small>Доступные деньги бизнеса</small></div><div><Landmark size={17} /><span>Основной долг</span><strong>{loading ? "…" : !knownDebt || calendar.error || profile.error ? "Уточняется" : formatMoney(debt)}</strong><small>По всем активным продуктам</small></div><div className="funding-summary-available"><Repeat2 size={17} /><span>Свободные лимиты</span><strong>{loading ? "…" : calendar.error || profile.error ? "Уточняется" : formatMoney(available)}</strong><small>Ещё не зачислены на счёт</small></div><div><CalendarDays size={17} /><span>Ближайшая дата платежей</span><strong>{loading ? "…" : calendar.error || profile.error ? "Уточняется" : nextDate ? formatMoneyPrecise(nextAmount) : "Нет платежей"}</strong><small>{nextDate ? dateLabel(nextDate) : "По доступным графикам"}</small></div></div>
    {profile.data && <div className="funding-balance-details"><CashBalanceBreakdown profile={profile.data} /></div>}
    {interrupted.length > 0 && <section className="scheduled-payments" aria-label="Незавершённые подтверждения"><h2>Проверьте результат операции</h2><p className="text-sm text-muted-foreground">Последнее подтверждение осталось без ответа. Сначала уточним статус.</p>{interrupted.map(id => <Button key={id} variant="outline" onClick={() => { const product = products.find(item => item.applicationId === id); if (product) manage(product, "repay"); }}>Проверить операцию · № {id.slice(0,6)}</Button>)}</section>}
    <ScheduledPayments orders={calendar.data?.payment_orders || []} />
    <div className="funding-filter" role="group" aria-label="Фильтр продуктов">{tabs.map(tab => <button key={tab.id} type="button" aria-pressed={filter === tab.id} onClick={() => setFilter(tab.id)}>{tab.label}<span>{tab.count}</span></button>)}</div>
    {loading && <p role="status">Загружаем продукты…</p>}
    {(calendar.error || profile.error) && <div role="alert" className="text-destructive"><p>{getErrorMessage(calendar.error || profile.error)}</p><Button variant="outline" onClick={() => { void calendar.refetch(); void profile.refetch(); }}>Повторить загрузку</Button></div>}
    <PortfolioProductGrid products={shown} onManage={manage} label={filter === "closed" ? "Закрытые продукты" : "Активные продукты"} />
    {!loading && !calendar.error && !profile.error && !shown.length && <div className="funding-empty"><CreditCard size={30} /><h2>{filter === "closed" ? "Погашенные продукты появятся здесь" : products.length ? "В этой категории пока нет продуктов" : "Дайте вашему делу новый импульс"}</h2><p>{filter === "closed" ? "Закрытые кредиты и линии останутся в истории." : "Выберите финансирование под текущие задачи бизнеса."}</p>{filter !== "closed" && <Button asChild variant="outline"><Link to="/cabinet?mode=manual">Подобрать продукт<ArrowRight size={16} /></Link></Button>}</div>}
    <Dialog.Root open={Boolean(focused)} onOpenChange={open => { if (!open) closeManagement(); }}>
      <Dialog.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}><Dialog.Overlay className="funding-dialog-overlay" /><Dialog.Content className="funding-dialog" onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('.funding-filter button[aria-pressed="true"]'); target?.focus({ preventScroll: true }); }}><header><div><p className="section-kicker">{focused?.productId === "overdraft" ? "ОПЕРАЦИИ ПО СЧЁТУ" : focused?.kind === "loan" ? "ПОГАШЕНИЕ КРЕДИТА" : "УПРАВЛЕНИЕ ПРОДУКТОМ"}</p><Dialog.Title>{focused?.productId === "overdraft" ? selected?.action === "draw" ? "Оплата поставщику" : "Поступление на счёт" : focused?.title}</Dialog.Title><Dialog.Description className={focused?.productId === "overdraft" ? "mt-2 text-sm text-muted-foreground" : "sr-only"}>{focused?.productId === "overdraft" ? `Подключён овердрафт · № ${focused.applicationId?.slice(0,6)}` : "Платежи, доступный лимит и график продукта"}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Закрыть управление продуктом"><X size={20} /></Button></Dialog.Close></header><div className="funding-dialog-body">{focused?.applicationId && (focused.productId === "overdraft" ? <OverdraftPanel key={`${focused.id}:${selected?.action}`} applicationId={focused.applicationId} initialKind={selected?.action === "repay" ? "receipt" : "expense"} onDone={closeManagement} /> : focused.productId === "revolving_credit_line" ? <CreditLinePanel key={`${focused.id}:${selected?.action}`} applicationId={focused.applicationId} initialAction={selected?.action} onDone={closeManagement} /> : <LoanPaymentPanel key={focused.id} applicationId={focused.applicationId} onDone={closeManagement} />)}{focused?.applicationId && (focused.productId === "overdraft" || focused.productId === "revolving_credit_line") && <Link className="funding-contract-link" to={`/cabinet?mode=applications&application=${focused.applicationId}`}>Условия и исходная заявка<ArrowUpRight size={15} /></Link>}</div></Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
