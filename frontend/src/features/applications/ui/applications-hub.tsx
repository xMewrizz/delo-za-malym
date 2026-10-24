import { needsApplicationAction } from "../model/application-status";
import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CopyPlus, FileText, MoreHorizontal, Plus, Search } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { formatMoney } from "@/shared/lib/format";
import { getErrorMessage } from "@/shared/api/client";
import type { ApplicationSummary } from "../api/applications";
import { productName, stateName } from "../model/presentation";
import { completionLifecycle } from "../model/completion-lifecycle";
import "./applications-hub.css";

const finishedApplications = new Set(["declined", "out_of_policy", "cancelled", "disbursed", "limit_opened"]);

function applicationPrimaryAction(status: string) {
  return ({ draft: "Проверить и отправить", offers_ready: "Выбрать предложение", ready_to_sign: "Перейти к подписанию", conditions_pending: "Выполнить условия", waiting_for_data: "Дополнить сведения", offer_expired: "Обновить предложения", check_retry_pending: "Повторить проверку" } as Record<string, string>)[status] || (finishedApplications.has(status) ? "Посмотреть результат" : "Открыть заявку");
}
export function ApplicationsHub({ applications, loading, error, refresh, open, create, creating = false }: {
  applications: ApplicationSummary[]; loading: boolean; error?: unknown; refresh: () => void;
  open: (id: string) => void; create: () => void; creating?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const filter = ["action", "review", "done"].includes(params.get("status") || "") ? params.get("status")! : "all";
  const search = params.get("q") || "";
  const limit = Math.max(12, Math.min(1000, Number(params.get("shown")) || 12));
  function change(key: string, value: string) { setParams(current => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); if (key !== "shown") next.delete("shown"); return next; }, { replace: true }); }
  useEffect(() => {
    if (loading) return;
    let position: string | null = null;
    try { position = sessionStorage.getItem("delo-applications-scroll"); sessionStorage.removeItem("delo-applications-scroll"); } catch { /* Optional scroll restoration. */ }
    if (!position) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: Number(position), behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [loading]);
  function openApplication(id: string) { try { sessionStorage.setItem("delo-applications-scroll", String(window.scrollY)); } catch { /* Optional scroll restoration. */ } open(id); }
  const categories = [
    { id: "all", title: "Все заявки", test: () => true },
    { id: "action", title: "Нужно ваше действие", test: (item: ApplicationSummary) => needsApplicationAction.has(item.state.status) },
    { id: "review", title: "На рассмотрении", test: (item: ApplicationSummary) => !finishedApplications.has(item.state.status) && !needsApplicationAction.has(item.state.status) },
    { id: "done", title: "Завершённые", test: (item: ApplicationSummary) => finishedApplications.has(item.state.status) },
  ] as const;
  const shown = applications.filter(item => categories.find(category => category.id === filter)!.test(item)
    && `${productName(item.need.preferred_product)} ${item.application_id} ${completionLifecycle(item.completion).replacementId ? "Погашен рефинансированием" : completionLifecycle(item.completion).closed ? "Погашен" : stateName(item.state.status)}`.toLocaleLowerCase("ru-RU").includes(search.trim().toLocaleLowerCase("ru-RU")));
  return <section className="applications-hub" aria-label="Список заявок">
    <div className="applications-toolbar"><div><h2>От запроса — к решению</h2><p>Открывайте предложения, дополняйте сведения и подписывайте готовые условия.</p></div><Button onClick={create} disabled={creating}><Plus size={16} />{creating ? "Создаём…" : "Новая заявка"}</Button></div>
    <div className="applications-filters" role="group" aria-label="Статус заявок">{categories.map(category => <button type="button" key={category.id} aria-pressed={filter === category.id} onClick={() => { change("status", category.id === "all" ? "" : category.id); }}>{category.title}<span>{applications.filter(category.test).length}</span></button>)}</div>
    <label className="applications-search"><Search size={17} /><span className="sr-only">Найти заявку по продукту, номеру или статусу</span><Input value={search} onChange={event => { change("q", event.target.value); }} placeholder="Продукт, номер или статус заявки" /></label>
    {loading && <p role="status">Загружаем заявки…</p>}
    {Boolean(error) && <div role="alert"><p>{getErrorMessage(error)}</p><Button variant="outline" onClick={refresh}>Повторить загрузку</Button></div>}
    {!loading && !error && !shown.length && <div className="applications-empty"><FileText size={30} /><h3>{applications.length ? "По этим условиям заявок нет" : "Ваша первая заявка начнётся с задачи"}</h3><p>{applications.length ? "Выберите другой статус или измените поиск." : "Подберите финансирование вручную или вместе с Лумой. Здесь появятся выбранные условия и решение."}</p>{!applications.length && <Button variant="outline" onClick={create} disabled={creating}>Подобрать финансирование<ArrowRight size={16} /></Button>}</div>}
    <div className="applications-cards">{shown.slice(0, limit).map(item => {
      const status = item.state.status, done = finishedApplications.has(status), issued = Boolean(item.completion);
      const { replacementId, closed } = completionLifecycle(item.completion);
      const updated = typeof item.state.updated_at === "string" ? new Date(item.state.updated_at).toLocaleDateString("ru-RU") : null;
      return <article className="application-record" key={item.application_id} aria-labelledby={`application-${item.application_id}`}>
        <header><span className={`application-record-status ${needsApplicationAction.has(status) ? "application-status-action" : done ? "application-status-done" : ""}`}><i />{replacementId ? "Погашен рефинансированием" : closed ? "Погашен" : stateName(status)}</span><small>№ {item.application_id.slice(0, 6)}</small></header>
        <h3 id={`application-${item.application_id}`}>{productName(item.need.preferred_product)}</h3>
        <p className="application-record-amount">{item.need.requested_amount ? formatMoney(item.need.requested_amount) : "По вашей задаче"}<span>{item.need.term_months ? `на ${item.need.term_months} мес.` : "Срок по условиям продукта"}</span></p>
        <p className="application-record-next">{replacementId ? "Этот кредит погашен. Дальнейшие платежи — по новому договору рефинансирования." : closed ? "Долг погашен полностью. Условия и история заявки сохранены." : done ? status === "declined" ? "Решение принято. Причины доступны в результате." : status === "cancelled" ? "Заявка закрыта по вашему запросу." : issued ? "Оформление завершено. Управляйте продуктом в разделе финансирования." : "Рассмотрение завершено. Условия доступны для просмотра." : item.state.next_action.label}</p>
        <footer><Button variant={needsApplicationAction.has(status) ? "default" : "outline"} onClick={() => openApplication(item.application_id)}>{closed ? "Условия и история" : status === "draft" && !item.ready_for_application ? "Продолжить подбор" : applicationPrimaryAction(status)}<ArrowRight size={15} /></Button>{issued && <Link to={replacementId ? `/cabinet?mode=applications&application=${encodeURIComponent(replacementId)}` : "/cabinet?mode=portfolio"}>{replacementId ? "Новый кредит" : "Моё финансирование"}</Link>}{updated && <small>Обновлена {updated}</small>}</footer>
      </article>;
    })}</div>
    {shown.length > limit && <Button className="applications-load-more" variant="outline" onClick={() => change("shown", String(limit + 12))}>Показать ещё · осталось {shown.length - limit}</Button>}
  </section>;
}

export function ApplicationBack({ back, actions }: { back: () => void; actions?: ReactNode }) {
  return <div className="application-back"><Button variant="ghost" onClick={back}><ArrowLeft size={16} />Все заявки</Button><span>Условия и решение по выбранной заявке</span>{actions && <div className="application-back-actions">{actions}</div>}</div>;
}

export function ApplicationMoreActions({ onRepeat, busy }: { onRepeat: () => void; busy: boolean }) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon" disabled={busy} aria-label="Действия с заявкой"><MoreHorizontal size={20}/></Button></DropdownMenu.Trigger><DropdownMenu.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}><DropdownMenu.Content className="application-actions-menu" align="end" sideOffset={6} collisionPadding={12}><DropdownMenu.Item asChild onSelect={onRepeat}><button type="button"><CopyPlus size={16}/>Создать похожую заявку</button></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
