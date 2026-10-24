import { SupplierPaymentDetails } from "@/features/supplier-payments/supplier-payment";
import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Building2, CalendarDays, Check, CreditCard, Landmark, RefreshCw, Repeat2 } from "lucide-react";
import { Link } from "react-router";
import { syncDemoProfile } from "@/features/applications/api/applications";
import { applicationKeys } from "@/features/applications/model/queries";
import { getErrorMessage } from "@/shared/api/client";
import { ElapsedStatus } from "@/shared/ui/elapsed-status";
import type { Profile } from "@/features/applications";
import { calendarQuery } from "@/features/calendar/api";
import { formatMoney, formatMoneyPrecise } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { CashBalanceBreakdown } from "./cash-balance-breakdown";
import { businessSnapshot, monthTotals, type BusinessMonth } from "./business-dashboard-model";
import "./business-accounts.css";

export function CompanyProfileCard({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const sync = useMutation({ mutationFn: syncDemoProfile, onSuccess: data => { client.setQueryData(applicationKeys.profile, data); void client.invalidateQueries({queryKey: calendarQuery.queryKey}); } });
  const checkedAt = profile.checked_at ? new Date(profile.checked_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const legalForm = ({ ooo: "ООО", ip: "ИП" } as Record<string, string>)[profile.business.legal_form || ""] || "Не указана";
  return <section className="company-profile-card" aria-labelledby="company-profile-title">
    <header className="company-profile-header">
      <span className="company-profile-icon"><Building2 size={25} aria-hidden="true" /></span>
      <div className="company-profile-identity"><h2 id="company-profile-title">{profile.company_name}</h2><p>{profile.business.activity}</p></div>
      <Button variant="outline" size="icon-lg" title="Обновить данные" aria-label="Обновить данные" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw size={16} aria-hidden="true" /></Button>
    </header>
    <dl className="company-profile-requisites">
      <div><dt>ИНН</dt><dd>{profile.business.inn}</dd></div>
      <div><dt>Форма бизнеса</dt><dd>{legalForm}</dd></div>
      <div><dt>Дата регистрации</dt><dd>{new Date(profile.business.registered_at + "T12:00:00").toLocaleDateString("ru-RU")}</dd></div>
    </dl>
    <footer className="company-profile-footer">
      <span className="company-profile-source">Демо-банк</span>
      <div className="company-profile-update">
        {sync.isPending ? <ElapsedStatus title="Обновляем данные" compact /> : sync.error ? <span role="alert" className="company-profile-error">{getErrorMessage(sync.error)}</span> : <span role="status">{sync.isSuccess && <Check size={14} aria-hidden="true" />}{checkedAt ? `${sync.isSuccess ? "Обновлено" : "Данные на"} ${checkedAt}` : "Данные компании и счёта"}</span>}
      </div>
    </footer>
  </section>;
}

type Snapshot = ReturnType<typeof businessSnapshot>;
const display = (value: number | string | null) => value == null ? "Нет данных" : formatMoney(String(value));
const monthLabel = (value: string, long = false) => new Date(`${value}-15T12:00:00`).toLocaleDateString("ru-RU", { month: long ? "long" : "short", ...(long ? { year: "numeric" } : {}) });
const dayLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

function BusinessActivity({ months }: { months: BusinessMonth[] }) {
  const [range, setRange] = useState(6);
  const [selected, setSelected] = useState<string | null>(null);
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const shown = sorted.slice(-range);
  const active = shown.find(item => item.month === selected) || shown.at(-1);
  const totals = monthTotals(active);
  const max = Math.max(1, ...shown.flatMap(row => { const values = monthTotals(row); return [Math.abs(values.inflow || 0), Math.abs(values.outflow || 0)]; }));
  return <section className="business-panel business-activity" aria-labelledby="business-activity-title">
    <header className="business-panel-heading"><div><span className="business-overline">ОБОРОТЫ КОМПАНИИ</span><h2 id="business-activity-title">Движение денег</h2></div><div className="business-range" role="group" aria-label="Период истории">{[3, 6].map(value => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value} мес.</button>)}</div></header>
    {!shown.length ? <div className="business-empty">История операций пока недоступна</div> : <>
      <div className="business-month-summary" aria-live="polite"><p>{active && monthLabel(active.month, true)}</p><dl><div><dt><i className="business-dot-in" />Поступило</dt><dd>{display(totals.inflow)}</dd></div><div><dt><i className="business-dot-out" />Ушло с налогами</dt><dd>{display(totals.outflow)}</dd></div><div><dt>Денежный поток</dt><dd data-negative={totals.net != null && totals.net < 0}>{totals.net != null && totals.net > 0 ? "+" : ""}{display(totals.net)}</dd></div></dl></div>
      <div className="business-bars" role="group" aria-label="Поступления и расходы по месяцам">{shown.map(row => { const values = monthTotals(row); return <button type="button" className="business-month" data-negative={values.net != null && values.net < 0} title={`Денежный поток: ${display(values.net)}`} aria-pressed={row.month === active?.month} aria-label={`${monthLabel(row.month, true)}: поступления ${display(values.inflow)}, расходы с налогами ${display(values.outflow)}, денежный поток ${display(values.net)}`} key={row.month} onClick={() => setSelected(row.month)}><span className="business-bar-pair" aria-hidden="true">{[values.inflow, values.outflow].map((value, index) => <i key={index} className={index === 0 ? "business-bar-in" : "business-bar-out"} data-missing={value == null} style={{ "--business-bar-height": value == null ? "0%" : `${Math.max(value === 0 ? 0 : 2, Math.abs(value) / max * 100)}%` } as CSSProperties} />)}</span><span>{monthLabel(row.month)}{values.net != null && values.net < 0 && <b aria-hidden="true"> −</b>}</span></button>; })}</div>
      <details className="business-history-table"><summary>Все суммы по месяцам</summary><div><table><caption className="sr-only">История движения денег компании</caption><thead><tr><th scope="col">Месяц</th><th scope="col">Поступления</th><th scope="col">Расходы</th><th scope="col">Налоги</th><th scope="col">Поток</th></tr></thead><tbody>{sorted.map(row => <tr key={row.month}><th scope="row">{monthLabel(row.month, true)}</th><td>{display(monthTotals(row).inflow)}</td><td>{display(monthTotals(row).expenses)}</td><td>{display(monthTotals(row).taxes)}</td><td>{display(monthTotals(row).net)}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

function BusinessNextPayment({ snapshot, ready, failed }: { snapshot: Snapshot; ready: boolean; failed: boolean }) {
  const { due, overdue, nextTotal, afterPayment, cash, nextPayments } = snapshot;
  const enough = afterPayment != null && afterPayment >= 0;
  const paymentShare = cash != null && cash > 0 && nextTotal != null ? Math.min(100, Math.max(0, Number(nextTotal) / cash * 100)) : 100;
  return <section className="business-panel business-next-payment" aria-labelledby="business-payment-title">
    <header className="business-panel-heading"><div><span className="business-overline">ПО ГРАФИКУ</span><h2 id="business-payment-title">{overdue ? "Платёж просрочен" : "Ближайший платёж"}</h2></div><CalendarDays size={20} aria-hidden="true" /></header>
    {!ready || !due ? <div className="business-empty">{failed ? "График временно недоступен" : !ready ? "Загружаем график…" : "Предстоящих платежей нет"}</div> : <>
      <p className="business-due-date" data-overdue={overdue}>{dayLabel(due)}</p><strong className="business-due-amount">{formatMoneyPrecise(nextTotal!)}</strong>
      <ul className="business-due-products">{nextPayments.slice(0, 2).map(event => <li key={event.event_id}><span>{snapshot.products.find(item => item.applicationId ? item.applicationId === event.application_id : item.id === `loan:${event.loan_id}`)?.title || event.title}</span><b>{display(event.amount)}</b></li>)}{nextPayments.length > 2 && <li>Ещё платежей: {nextPayments.length - 2}</li>}</ul>
      <div className="business-payment-cover" data-shortfall={afterPayment != null && afterPayment < 0}><p>{afterPayment == null ? "Остаток счёта неизвестен" : enough ? "На счёте хватает" : "На счёте не хватает"}{enough && <Check size={15} aria-hidden="true" />}</p><div className="business-cover-track" aria-hidden="true"><span style={{ width: `${paymentShare}%` }} /></div><div><span>{afterPayment == null ? "" : enough ? "После платежа" : "Нужно добавить"}</span><strong>{afterPayment == null ? "" : display(Math.abs(afterPayment))}</strong></div><small>По текущему остатку, без будущих операций</small></div>
      <Link className="business-text-link" to={`/cabinet?mode=calendar&date=${due}`}>Открыть календарь<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </>}
  </section>;
}

function BusinessFinancing({ snapshot, ready, failed }: { snapshot: Snapshot; ready: boolean; failed: boolean }) {
  const { debt, unused, capacity, products } = snapshot;
  const free = capacity != null && Number(capacity) > 0 && unused != null ? Math.min(100, Math.max(0, Number(unused) / Number(capacity) * 100)) : null;
  return <section className="business-panel business-funding" aria-labelledby="business-funding-title">
    <header className="business-panel-heading"><div><span className="business-overline">КРЕДИТЫ И ЛИМИТЫ</span><h2 id="business-funding-title">Финансирование</h2></div><CreditCard size={20} aria-hidden="true" /></header>
    {!ready ? <div className="business-empty">{failed ? "Данные временно недоступны" : "Загружаем продукты…"}</div> : <>
      <div className="business-debt-number"><span>Остаток основного долга</span><strong>{display(debt)}</strong><small>Действующих продуктов: {products.length}</small></div>
      <div className="business-limit-summary"><div><span><Repeat2 size={15} aria-hidden="true" />Свободно в лимитах</span><strong>{display(unused)}</strong></div>{free != null && <div className="business-limit-track" role="meter" aria-label="Свободная доля кредитных лимитов" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(free)} aria-valuetext={`${display(unused)} из ${display(capacity)}`}><span style={{ width: `${free}%` }} /></div>}<p>{capacity != null && Number(capacity) > 0 ? `Из ${display(capacity)} открытого лимита · ещё не на счёте` : capacity == null ? "Данные о лимитах не переданы" : "Открытых кредитных лимитов нет"}</p></div>
      <Link className="business-text-link" to="/cabinet?mode=portfolio">Управлять продуктами<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </>}
  </section>;
}

function BusinessOperations({ profile, snapshot, ready, failed }: { profile: Profile; snapshot: Snapshot; ready: boolean; failed: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? snapshot.operations : snapshot.operations.slice(0, 4);
  return <section className="business-panel business-operations" aria-labelledby="business-operations-title">
    <header className="business-panel-heading"><div><span className="business-overline">ДВИЖЕНИЕ ПО СЧЁТУ</span><h2 id="business-operations-title">Последние операции</h2></div>{snapshot.operations.length > 4 && <button className="business-text-link" type="button" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? "Свернуть" : `Все · ${snapshot.operations.length}`}</button>}</header>
    {!ready || !shown.length ? <div className="business-empty">{failed ? "Не удалось загрузить операции" : !ready ? "Загружаем операции…" : "Здесь появятся оплаты счетов, выдачи и погашения"}</div> : <ul className="business-operation-list">{shown.map(event => <li key={event.event_id}><span className="business-operation-icon" data-inflow={event.direction === "inflow"}>{event.direction === "inflow" ? <ArrowDownLeft size={19} aria-hidden="true" /> : <ArrowUpRight size={19} aria-hidden="true" />}</span><div><strong>{event.title}</strong><span>{dayLabel(event.date)} · {event.productTitle}</span>{event.supplier_payment && <SupplierPaymentDetails receipt={event.supplier_payment} />}</div><b data-inflow={event.direction === "inflow"}>{event.direction === "inflow" ? "+" : "−"}{formatMoneyPrecise(event.amount)}</b></li>)}</ul>}
    <CashBalanceBreakdown profile={profile} />
  </section>;
}

export function BusinessDashboard({ profile }: { profile: Profile }) {
  const calendar = useQuery(calendarQuery);
  const snapshot = businessSnapshot(profile, calendar.data);
  return <div className="business-board">
    <article className="business-account-hero" aria-labelledby="business-account-title"><header><span><Landmark size={20} aria-hidden="true" /><h2 id="business-account-title">{snapshot.account?.title || "Расчётный счёт"}</h2></span><span className="business-currency">RUB</span></header><div className="business-account-balance"><p>Деньги на счёте</p><strong>{snapshot.cash == null ? "Нет данных" : formatMoneyPrecise(String(snapshot.cash))}</strong>{snapshot.account?.number && <span>{snapshot.account.number}</span>}</div>{Number(snapshot.account?.overdraft_available || "0") > 0 && <div className="business-account-overdraft"><span>Дополнительно для оплаты<strong>{formatMoneyPrecise(snapshot.account!.overdraft_available!)}</strong></span><Link to="/cabinet?mode=business&pay=supplier">Оплатить счёт<ArrowUpRight size={16} aria-hidden="true" /></Link></div>}<footer><span>Включая зачисленные кредиты</span><a href="#business-operations-title" aria-label="Перейти к операциям по счёту"><ArrowDownLeft size={21} aria-hidden="true" /></a></footer></article>
    <CompanyProfileCard profile={profile} />
    {calendar.error && <div className="business-load-error" role="alert"><span>Не удалось обновить продукты и операции.{calendar.data && " Показаны последние загруженные данные."}</span><Button variant="outline" size="sm" onClick={() => void calendar.refetch()}>Повторить</Button></div>}
    <BusinessActivity months={profile.financials.monthly || []} />
    <BusinessNextPayment snapshot={snapshot} ready={Boolean(calendar.data)} failed={Boolean(calendar.error)} />
    <BusinessOperations profile={profile} snapshot={snapshot} ready={Boolean(calendar.data)} failed={Boolean(calendar.error)} />
    <BusinessFinancing snapshot={snapshot} ready={Boolean(calendar.data)} failed={Boolean(calendar.error)} />
  </div>;
}

