import { useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Building2, CalendarDays, CircleHelp, CreditCard, FolderOpen, LayoutDashboard, Menu, Plus, Sparkles, X } from "lucide-react";
import { Link } from "react-router";
import { BrandLogo } from "@/shared/ui/brand-logo";

export type CabinetMode = "overview" | "business" | "manual" | "assistant" | "applications" | "portfolio" | "calendar";
const sections = [
  { mode: "overview", name: "Обзор", icon: LayoutDashboard },
  { mode: "business", name: "Данные бизнеса", icon: Building2 },
  { mode: "manual", name: "Получить финансирование", icon: Plus },
  { mode: "applications", name: "Заявки", icon: FolderOpen },
  { mode: "portfolio", name: "Моё финансирование", icon: CreditCard },
  { mode: "calendar", name: "Платёжный календарь", icon: CalendarDays },
] as const;

export function CabinetNavigation({ mode, company, applications, navigate }: { mode: CabinetMode; company?: string; applications: number; navigate: (mode: CabinetMode) => void }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  function go(next: CabinetMode) {
    navigate(next);
    setOpen(false);
    if (open && next === mode) requestAnimationFrame(() => document.getElementById("cabinet-title")?.focus());
  }
  return <aside className="workspace-navigation" data-menu-open={open} onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); menuButton.current?.focus(); } }}>
    <div className="workspace-brand-row"><Link to="/" aria-label="Дело за малым — главная"><BrandLogo width={210} /></Link><button ref={menuButton} type="button" className="workspace-menu-toggle" aria-label={open ? "Закрыть меню" : "Открыть меню"} aria-expanded={open} aria-controls="workspace-sections" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></div>
    <div className="workspace-nav-body" id="workspace-sections">
      <div className="workspace-company"><span className="company-avatar">С</span><div><strong>{company || "Ваш бизнес"}</strong><span>Бизнес-кабинет</span></div></div>
      <p className="workspace-nav-caption">ВАШЕ ДЕЛО</p>
      <nav aria-label="Разделы личного кабинета">{sections.map(({ mode: next, name, icon: Icon }) => <button key={next} type="button" aria-current={(mode === next || next === "manual" && mode === "assistant") ? "page" : undefined} onClick={() => go(next)}><Icon size={19} aria-hidden="true" /><span>{name}</span>{next === "applications" && applications > 0 && <small>{applications}</small>}</button>)}</nav>
      <div className="workspace-assistant-invite"><span className="workspace-spark"><Sparkles size={21} /></span><h2>Большие планы?<br />Давайте обсудим.</h2><p>Ассистент поможет подобрать деньги под вашу задачу.</p><button type="button" onClick={() => go("assistant")}>Поговорить с ИИ<ArrowUpRight size={16} /></button></div>
      <div className="workspace-nav-footer"><Link to="/project#documentation"><CircleHelp size={17} />Помощь и документация</Link><Link to="/"><ArrowLeft size={17} />На сайт проекта</Link><span className="workspace-demo-label"><i />Демонстрационный кабинет</span></div>
    </div>
  </aside>;
}
