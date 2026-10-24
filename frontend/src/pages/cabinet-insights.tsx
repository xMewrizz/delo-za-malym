import { useState } from "react";
import { CashflowChart } from "./cashflow-chart";
import { monthlyValue } from "@/shared/lib/business-cashflow";
import { financingName, upcomingProducts } from "@/shared/lib/product-directions";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CalendarDays, CreditCard, FileText, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router";
import { applicationQueries, stateName, type ApplicationSummary, type Profile } from "@/features/applications";
import { calendarQuery, isDebtObligation } from "@/features/calendar/api";
import { formatMoney } from "@/shared/lib/format";
import { getErrorMessage } from "@/shared/api/client";
import { LumaAvatar } from "@/shared/ui/luma-mark";
import { Button } from "@/shared/ui/button";
import { needsApplicationAction } from "@/features/applications/model/application-status";
import { ScheduledPayments } from "./scheduled-payments";
import { BusinessDashboard } from "./business-accounts";

const dateLabel = (value: string) => new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const amount = (value?: string | null) => value == null ? "Уточняется" : formatMoney(value);

export function CabinetOverview({ applications, loading, error }: { applications: ApplicationSummary[]; loading: boolean; error?: unknown }) {
  const profile = useQuery(applicationQueries.profile());
  const calendar = useQuery(calendarQuery);
  const [listMode, setListMode] = useState<"active" | "all">("active");
  const nextDate = calendar.data?.events.find(event => event.date >= calendar.data!.today && isDebtObligation(event))?.date;
  const nextAmount = calendar.data?.events.filter(event => event.date === nextDate && isDebtObligation(event)).reduce((sum, event) => sum + Math.round(Number(event.amount) * 100), 0);
  const next = nextDate ? { date: nextDate, amount: ((nextAmount || 0) / 100).toFixed(2) } : null;
  const actionCount = applications.filter(item => needsApplicationAction.has(item.state.status)).length;
  const active = applications.filter(item => !["draft", "cancelled", "disbursed", "limit_opened", "declined", "out_of_policy"].includes(item.state.status));
  const latest = [...(profile.data?.financials.monthly || [])].sort((a, b) => a.month.localeCompare(b.month)).at(-1);
  const net = monthlyValue(latest, "net");
  const stages = [
    { name: "Черновики", count: applications.filter(item => item.state.status === "draft").length, color: "var(--input)" },
    { name: "В работе", count: active.length, color: "var(--chart-1)" },
    { name: "Оформлено", count: applications.filter(item => ["disbursed", "limit_opened"].includes(item.state.status)).length, color: "var(--growth)" },
    { name: "Закрыто", count: applications.filter(item => ["cancelled", "declined", "out_of_policy"].includes(item.state.status)).length, color: "var(--muted-foreground)" },
  ];
  const shown = (listMode === "active" ? active : applications).slice(0, 3);
  return <div className="pulse-dashboard">
    <ScheduledPayments orders={calendar.data?.payment_orders || []} compact />
    <div className="pulse-upper">
      <div className="pulse-metrics">
        <Link to="/cabinet?mode=business" className="pulse-metric pulse-metric-lime"><div><span>На счёте</span><Wallet size={17} /></div><strong>{profile.isPending ? "…" : amount(profile.data?.financials.cash_balance)}</strong><p>Остаток из банковского профиля<ArrowUpRight size={14} /></p></Link>
        <Link to="/cabinet?mode=business" className="pulse-metric pulse-metric-flow"><div><span>Денежный поток</span><TrendingUp size={17} /></div><strong>{profile.isPending ? "…" : net == null ? "Нет данных" : formatMoney(String(net))}</strong><p>{latest?.month || "Последний месяц"} · после расходов и налогов</p></Link>
        <Link to={next ? `/cabinet?mode=calendar&date=${next.date}` : "/cabinet?mode=calendar"} className="pulse-metric"><div><span>Ближайшие платежи</span><CalendarDays size={17} /></div><strong>{calendar.isPending ? "…" : calendar.error ? "Нет данных" : next ? formatMoney(next.amount) : "Нет платежей"}</strong><p>{next ? dateLabel(next.date) : "По доступным графикам"}<ArrowUpRight size={14} /></p></Link>
        <Link to="/cabinet?mode=applications&status=action" className="pulse-metric pulse-metric-applications"><div><span>Нужно ваше действие</span><FileText size={17} /></div><strong>{loading ? "…" : error ? "—" : actionCount}</strong><p>Открыть заявки<ArrowUpRight size={14} /></p></Link>
      </div>
      <CashflowChart profile={profile.data} loading={profile.isPending} error={profile.error} />
    </div>
    <div className="pulse-lower">
      <section className="dashboard-card pulse-applications" aria-labelledby="pulse-applications-title">
        <div className="dashboard-card-heading"><div><span className="dashboard-kicker">ОТ ЗАДАЧИ ДО РЕЗУЛЬТАТА</span><h2 id="pulse-applications-title">Заявки и оформление</h2></div><Link to="/cabinet?mode=applications" aria-label="Все заявки"><ArrowUpRight size={19} /></Link></div>
        {error ? <p role="alert">{getErrorMessage(error)}</p> : loading ? <p role="status">Загружаем заявки…</p> : <>
          <div className="pipeline-stages">{stages.map(stage => <div key={stage.name}><strong>{stage.count}</strong><span><i style={{ background: stage.color }} />{stage.name}</span></div>)}</div>
          {applications.length > 0 && <div className="pipeline-track" aria-hidden="true">{stages.filter(stage => stage.count > 0).map(stage => <span key={stage.name} style={{ flex: stage.count, background: stage.color }} />)}</div>}
          <div className="pipeline-list-heading"><span>Последние заявки</span><div role="group" aria-label="Фильтр заявок на обзоре"><button type="button" aria-pressed={listMode === "active"} onClick={() => setListMode("active")}>В работе</button><button type="button" aria-pressed={listMode === "all"} onClick={() => setListMode("all")}>Все</button></div></div>
          {shown.length ? <div className="pulse-application-list">{shown.map(item => <Link key={item.application_id} to={"/cabinet?mode=applications&application=" + item.application_id}><span className="pulse-application-icon"><CreditCard size={17} /></span><div><strong>{financingName(item.need.preferred_product)}</strong><span>{stateName(item.state.status)}</span></div><b>{amount(item.need.requested_amount)}</b><ArrowUpRight size={16} /></Link>)}</div> : <div className="pulse-no-applications"><FileText size={24} /><p>{listMode === "active" && applications.length ? "Сейчас нет заявок в работе" : "Ваша следующая идея начинается здесь"}</p><Link to="/cabinet?mode=manual">Подобрать финансирование<ArrowRight size={15} /></Link></div>}
        </>}
      </section>
      <section className="dashboard-card pulse-assistant"><div className="dashboard-card-heading"><span className="dashboard-kicker">ЛУМА / ИИ-АССИСТЕНТ</span><ArrowUpRight size={17} /></div><div className="luma-dashboard-portrait"><LumaAvatar size={80} /></div><h2>Яснее с деньгами.<br />Ближе к планам.</h2><p>Разберём задачу, соберём данные<br />и посмотрим на варианты.</p><div className="pulse-prompt-chips"><Link to="/cabinet?mode=assistant">Нужны деньги на закупку</Link><Link to="/cabinet?mode=assistant">Выручка придёт позже</Link></div><Link to="/cabinet?mode=assistant" className="pulse-assistant-action"><span>Обсудить с Лумой</span><ArrowUpRight size={17} /></Link></section>
    </div>
    <section className="dashboard-next-step"><div><span className="dashboard-kicker">ИДЕЯ ЕСТЬ. ОСТАЛОСЬ НАЧАТЬ.</span><h2>Деньги под вашу задачу.</h2><p>Известные сведения уже в профиле. Уточним только необходимое.</p></div><Button asChild><Link to="/cabinet?mode=manual">Получить финансирование<ArrowUpRight size={17} /></Link></Button></section>
    {upcomingProducts.length > 0 && <div className="dashboard-future"><span>На следующем этапе</span>{upcomingProducts.map(product => <span key={product.id}>{product.name}<small>Скоро</small></span>)}</div>}
    {(calendar.error || profile.error) && <p role="alert" className="text-sm text-destructive">{getErrorMessage(calendar.error || profile.error)}</p>}
  </div>;
}

export function BusinessProfile({ profile, loading }: { profile?: Profile; loading: boolean }) {
  if (loading) return <p role="status">Загружаем данные бизнеса…</p>;
  if (!profile) return <p>Профиль пока недоступен. Обновите страницу или повторите загрузку ниже.</p>;
  return <BusinessDashboard profile={profile} />;
}

export { FinancingPortfolio } from "./financing-portfolio";
