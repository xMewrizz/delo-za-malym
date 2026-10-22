import { useState } from "react";
import { CashflowChart } from "./cashflow-chart";
import { monthlyValue } from "@/shared/lib/business-cashflow";
import { financingName, upcomingProducts } from "@/shared/lib/product-directions";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, ChevronRight, CreditCard, FileText, ShieldCheck, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router";
import { applicationQueries, stateName, type ApplicationSummary, type Profile } from "@/features/applications";
import { calendarQuery } from "@/features/calendar/api";
import { formatMoney } from "@/shared/lib/format";
import { getErrorMessage } from "@/shared/api/client";
import { LumaAvatar } from "@/shared/ui/luma-mark";
import { Button } from "@/shared/ui/button";

const dateLabel = (value: string) => new Date(value.slice(0, 10) + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const amount = (value?: string | null) => value == null ? "Уточняется" : formatMoney(value);

export function CabinetOverview({ applications, loading, error }: { applications: ApplicationSummary[]; loading: boolean; error?: unknown }) {
  const profile = useQuery(applicationQueries.profile());
  const calendar = useQuery(calendarQuery);
  const [listMode, setListMode] = useState<"active" | "all">("active");
  const next = calendar.data?.events.find(event => event.date >= calendar.data!.today && event.direction === "outflow");
  const active = applications.filter(item => !["draft", "cancelled", "disbursed", "limit_opened", "declined", "out_of_policy"].includes(item.state.status));
  const latest = [...(profile.data?.financials.monthly || [])].sort((a, b) => a.month.localeCompare(b.month)).at(-1);
  const net = monthlyValue(latest, "net");
  const stages = [
    { name: "Черновики", count: applications.filter(item => item.state.status === "draft").length, color: "var(--periwinkle)" },
    { name: "В работе", count: active.length, color: "var(--violet)" },
    { name: "Получено", count: applications.filter(item => ["disbursed", "limit_opened"].includes(item.state.status)).length, color: "var(--lime)" },
    { name: "Закрыто", count: applications.filter(item => ["cancelled", "declined", "out_of_policy"].includes(item.state.status)).length, color: "var(--muted-foreground)" },
  ];
  const shown = (listMode === "active" ? active : applications).slice(0, 3);
  return <div className="pulse-dashboard">
    <div className="pulse-upper">
      <div className="pulse-metrics">
        <Link to="/cabinet?mode=business" className="pulse-metric pulse-metric-lime"><div><span>На счёте</span><Wallet size={17} /></div><strong>{profile.isPending ? "…" : amount(profile.data?.financials.cash_balance)}</strong><p>Остаток из банковского профиля<ArrowUpRight size={14} /></p></Link>
        <Link to="/cabinet?mode=business" className="pulse-metric"><div><span>Денежный поток</span><TrendingUp size={17} /></div><strong>{profile.isPending ? "…" : net == null ? "Нет данных" : formatMoney(String(net))}</strong><p>{latest?.month || "Последний месяц"} · после расходов и налогов</p></Link>
        <Link to="/cabinet?mode=calendar" className="pulse-metric"><div><span>Ближайший платёж</span><CalendarDays size={17} /></div><strong>{calendar.isPending ? "…" : calendar.error ? "Нет данных" : next ? formatMoney(next.amount) : "Нет платежей"}</strong><p>{next ? dateLabel(next.date) : "По доступным графикам"}<ArrowUpRight size={14} /></p></Link>
        <Link to="/cabinet?mode=applications" className="pulse-metric"><div><span>Заявки в работе</span><FileText size={17} /></div><strong>{loading ? "…" : error ? "—" : active.length}</strong><p>Требуют следующего шага<ArrowUpRight size={14} /></p></Link>
      </div>
      <CashflowChart profile={profile.data} loading={profile.isPending} error={profile.error} />
    </div>
    <div className="pulse-lower">
      <section className="dashboard-card pulse-applications" aria-labelledby="pulse-applications-title">
        <div className="dashboard-card-heading"><div><span className="dashboard-kicker">ОТ ЗАДАЧИ ДО РЕЗУЛЬТАТА</span><h2 id="pulse-applications-title">Ваше финансирование</h2></div><Link to="/cabinet?mode=applications" aria-label="Все заявки"><ArrowUpRight size={19} /></Link></div>
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
    <div className="dashboard-future"><span>На следующем этапе</span>{upcomingProducts.map(product => <span key={product.id}>{product.name}<small>Скоро</small></span>)}</div>
    {(calendar.error || profile.error) && <p role="alert" className="text-sm text-destructive">{getErrorMessage(calendar.error || profile.error)}</p>}
  </div>;
}

export function BusinessProfile({ profile, loading }: { profile?: Profile; loading: boolean }) {
  if (loading) return <p role="status">Загружаем данные бизнеса…</p>;
  if (!profile) return <p>Профиль пока недоступен. Обновите страницу или повторите загрузку ниже.</p>;
  const months = profile.financials.monthly || [];
  const max = Math.max(1, ...months.map(row => Number(row.operating_inflow || 0)));
  const latest = months.at(-1);
  return <div className="business-profile">
    <section className="business-company workspace-white-card"><span className="business-avatar"><Building2 size={32} /></span><div><p className="section-kicker">Профиль компании</p><h2>{profile.company_name}</h2><p>{profile.business.activity}</p><span>ИНН {profile.business.inn} · Зарегистрирована {new Date(profile.business.registered_at).toLocaleDateString("ru-RU")}</span></div><span className="source-pill"><ShieldCheck size={14} />Данные банка</span></section>
    <div className="overview-metrics"><div className="metric-card"><span className="metric-icon"><Wallet /></span><p>Остаток на счёте</p><strong>{amount(profile.financials.cash_balance)}</strong><span>Учтём при подборе финансирования</span></div><div className="metric-card"><span className="metric-icon mint"><TrendingUp /></span><p>Поступления за {latest?.month || "месяц"}</p><strong>{amount(latest?.operating_inflow)}</strong><span>Из банковской истории</span></div><Link to="/cabinet?mode=portfolio" className="metric-card"><span className="metric-icon"><CreditCard /></span><p>Действующие кредиты</p><strong>{profile.financials.existing_loans?.length || 0}</strong><span>Уже учитываем в нагрузке<ChevronRight size={15} /></span></Link></div>
    <section className="workspace-white-card"><div className="insight-heading"><div><p className="section-kicker">Ваш финансовый контекст</p><h2>Поступления по месяцам</h2></div><span className="source-pill">{months.length} мес. истории</span></div>{months.length ? <><div className="business-chart" role="img" aria-label={months.map(row => `${row.month}: ${amount(row.operating_inflow)}`).join("; ")}>{months.map((row, i) => <div key={row.month}><span>{amount(row.operating_inflow)}</span><i style={{ height: `${Math.max(8, Number(row.operating_inflow || 0) / max * 140)}px`, background: i === months.length - 1 ? "var(--primary)" : undefined }} /><small>{new Date(row.month + "-15T12:00:00").toLocaleDateString("ru-RU", { month: "short" })}</small></div>)}</div><details className="business-table"><summary>Точные суммы, расходы и налоги</summary><div className="overflow-x-auto"><table><caption className="sr-only">Финансовая история компании</caption><thead><tr><th>Месяц</th><th>Поступления</th><th>Расходы</th><th>Налоги</th></tr></thead><tbody>{months.map(row => <tr key={row.month}><td>{row.month}</td><td>{amount(row.operating_inflow)}</td><td>{amount(row.operating_outflow)}</td><td>{amount(row.taxes)}</td></tr>)}</tbody></table></div></details></> : <p>История пока недоступна. При подборе мы попросим недостающие сведения.</p>}</section>
    <aside className="overview-bank-note"><ShieldCheck /><p><strong>Повторная анкета не нужна.</strong> Эти сведения доступны для просмотра. Дополнить отсутствующие данные и приложить счёт поставщика можно при подборе финансирования.</p><Link to="/cabinet?mode=manual">Перейти к подбору<ArrowRight size={16} /></Link></aside>
  </div>;
}

export function FinancingPortfolio() {
  const calendar = useQuery(calendarQuery);
  const profile = useQuery(applicationQueries.profile());
  const existing = profile.data?.financials.existing_loans?.filter(loan => !loan.application_id) || [];
  const accounts = calendar.data?.accounts || [];
  const loading = calendar.isPending || profile.isPending;
  return <div className="financing-portfolio"><div className="portfolio-intro"><div><span className="mint-pill"><CreditCard size={14} />Всё финансирование в одном месте</span><h2>Работает на ваше дело.</h2><p>Полученные кредиты и открытые лимиты. Условия, обязательства и ближайшие платежи — рядом.</p></div><Button asChild variant="outline"><Link to="/cabinet?mode=calendar">Общий календарь<CalendarDays size={17} /></Link></Button></div>
    {loading && <p role="status">Загружаем продукты…</p>}
    {(calendar.error || profile.error) && <p role="alert" className="text-destructive">{getErrorMessage(calendar.error || profile.error)}</p>}
    <div className="portfolio-grid">{existing.map((loan, i) => { const next = loan.schedule?.find(row => row.date >= (calendar.data?.today || new Date().toISOString().slice(0, 10))); return <article key={loan.loan_id} className="portfolio-product"><div className="portfolio-product-top"><span className="portfolio-product-icon"><CreditCard /></span><span className="source-pill">Действует</span></div><p className="section-kicker">Из банковского профиля</p><h2>Действующий кредит {i + 1}</h2><p>Основной долг</p><strong className="portfolio-amount">{amount(loan.outstanding_principal)}</strong><dl><div><dt>Ежемесячный платёж</dt><dd>{amount(loan.monthly_payment)}</dd></div><div><dt>Ближайшая дата</dt><dd>{next ? dateLabel(next.date) : "Нет данных"}</dd></div></dl><Link to={`/cabinet?mode=calendar&product=${encodeURIComponent(`loan:${loan.loan_id}`)}`}>Посмотреть график<ArrowRight size={17} /></Link></article>; })}{accounts.map(account => { const next = calendar.data?.events.find(event => event.application_id === account.application_id && event.direction === "outflow" && event.date >= calendar.data.today); return <article key={account.application_id} className={`portfolio-product ${account.product_id === "overdraft" ? "portfolio-overdraft" : ""}`}><div className="portfolio-product-top"><span className="portfolio-product-icon"><Wallet /></span><span className="source-pill">{account.status === "refinanced" ? "Погашен рефинансированием" : account.product_id === "overdraft" ? "Лимит открыт" : account.product_id === "refinancing" ? "Рефинансирование выполнено" : "Кредит получен"}</span></div><p className="section-kicker">Оформлено {dateLabel(account.opened_at)}</p><h2>{financingName(account.product_id)}</h2><p>{account.product_id === "overdraft" ? "Открытый лимит" : "Сумма финансирования"}</p><strong className="portfolio-amount">{formatMoney(account.amount)}</strong><dl><div><dt>Основной долг</dt><dd>{formatMoney(account.outstanding_principal)}</dd></div><div><dt>Ближайший платёж</dt><dd>{next ? `${formatMoney(next.amount)} · ${dateLabel(next.date)}` : account.status === "refinanced" ? "Прежний график закрыт" : "По плану использования"}</dd></div></dl><div className="portfolio-product-links"><Link to={`/cabinet?mode=calendar&product=app:${account.application_id}`}>График платежей<ArrowRight size={17} /></Link><Link to={`/cabinet?mode=applications&application=${account.application_id}`}>Заявка<ArrowUpRight size={15} /></Link></div></article>; })}</div>
    {!loading && !calendar.error && !profile.error && !existing.length && !accounts.length && <div className="workspace-white-card overview-empty"><CreditCard size={32} /><h2>Здесь будут ваши продукты</h2><p>После завершения оформления кредит или лимит появится здесь вместе с графиком.</p><Button asChild><Link to="/cabinet?mode=manual">Подобрать финансирование<ArrowRight /></Link></Button></div>}
    <p className="portfolio-note"><ShieldCheck size={17} />Новые кредиты уже учитываются при следующем подборе. Платежи показаны по графику; проведение денежных операций в демоверсии смоделировано.</p>
  </div>;
}
