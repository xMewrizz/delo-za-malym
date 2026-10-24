import { ArrowUpRight, Building2, CalendarDays, CreditCard, FileText, FolderOpen, LayoutDashboard, Plus, TrendingUp, Wallet } from "lucide-react";
import { Link } from "react-router";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BrandLogo } from "@/shared/ui/brand-logo";
import { LumaAvatar } from "@/shared/ui/luma-mark";
import "./home-cabinet-preview.css";
import {overviewChapterAt} from "./home-cabinet-chapters";

gsap.registerPlugin(ScrollTrigger);

const sections = [
  { name: "Обзор", mode: "overview", icon: LayoutDashboard },
  { name: "Данные бизнеса", mode: "business", icon: Building2 },
  { name: "Получить финансирование", mode: "manual", icon: Plus },
  { name: "Заявки", mode: "applications", icon: FolderOpen },
  { name: "Моё финансирование", mode: "portfolio", icon: CreditCard },
  { name: "Платёжный календарь", mode: "calendar", icon: CalendarDays },
];

const overviewChapters = [
  {name:"Деньги",title:"Видеть главное.",accent:"Действовать вовремя.",text:"Остаток и движение денег показывают, с чем бизнес входит в следующий месяц.",value:"420 000 ₽",label:"на расчётном счёте"},
  {name:"Платежи",title:"Знать заранее,",accent:"когда платить.",text:"Ближайшие обязательства рядом с остатком. Полный график и проценты — в календаре.",value:"18 ноября",label:"следующий платёж — 38 240 ₽"},
  {name:"Заявки",title:"Продолжить",accent:"с нужного шага.",text:"Заявки, доступные условия и действующие продукты остаются в одном кабинете.",value:"1 заявка",label:"ждёт вашего решения"},
];

export function HomeCabinetShowcase() {
  const [active,setActive]=useState(0);
  const host=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const media=gsap.matchMedia();
    const context=gsap.context(()=>{
      gsap.from(".ep-overview-copy",{y:16,opacity:0,duration:.55,ease:"power2.out",clearProps:"all",scrollTrigger:{trigger:host.current,start:"top 75%",once:true}});
      media.add("(min-width:1101px) and (min-height:760px)",()=>{
        const trigger=ScrollTrigger.create({trigger:host.current,start:"top 112px",end:()=>`+=${Math.round(window.innerHeight*.95)}`,invalidateOnRefresh:true,onUpdate:self=>setActive(current=>overviewChapterAt(self.progress,current))});
        return()=>{trigger.kill();setActive(0);};
      });
    },host);
    return()=>{media.revert();context.revert();};
  },[]);
  return <section className="ep-overview-showcase" ref={host} data-focus={active} aria-labelledby="overview-demo-title"><div className="ep-overview-stage">
    <div className="ep-overview-copy" data-depth="4"><p className="ep-eyebrow">КАБИНЕТ ПРЕДПРИНИМАТЕЛЯ</p><ol className="ep-overview-tabs" aria-label="Этапы показа кабинета">{overviewChapters.map((item,index)=><li key={item.name} aria-current={active===index ? "step" : undefined}>{item.name}</li>)}</ol><div className="ep-overview-chapters">{overviewChapters.map((chapter,index)=><div className="ep-overview-chapter" key={chapter.name} data-active={active===index} aria-hidden={active!==index}><h2 id={active===index?"overview-demo-title":undefined}>{chapter.title}<br/><em>{chapter.accent}</em></h2><p>{chapter.text}</p><div className="ep-overview-fact"><strong>{chapter.value}</strong><span>{chapter.label}</span></div></div>)}</div><Link className="ep-overview-open" to="/cabinet?mode=overview">Посмотреть кабинет<ArrowUpRight size={16}/></Link></div>
    <div className="ep-overview-window" data-depth="3"><div className="ep-overview-window-caption"><span><i/>Обзор бизнеса</span><span>Демо · ООО «Север»</span></div><HomeCabinetPreview/></div>
  </div></section>;
}

/** Demo values, with the same navigation, metric grid and panels as CabinetOverview. */
export function HomeCabinetPreview() {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const context = gsap.context(() => {
      const story = gsap.timeline({scrollTrigger: {trigger: host.current, start: "top 72%", once:true}});
      story.from(".ep-cabinet-metric", {y:12,opacity:.65,stagger:.06,duration:.45,ease:"power2.out",clearProps:"transform,opacity"},0);
      story.from(".ep-cabinet-bars i", {scaleY:.15,transformOrigin:"center bottom",stagger:.05,duration:.65,ease:"power2.out",clearProps:"transform"},.1);
    }, host);
    return () => context.revert();
  }, []);
  return <div className="ep-cabinet" ref={host} aria-label="Пример обзора личного кабинета">
    <aside className="ep-cabinet-sidebar">
      <Link to="/" aria-label="Дело за малым — главная"><BrandLogo width={145} /></Link>
      <div className="ep-cabinet-company"><span>С</span><div><strong>ООО «Север»</strong><small>Бизнес-кабинет</small></div></div>
      <span className="ep-cabinet-kicker">ВАШЕ ДЕЛО</span>
      <nav aria-label="Разделы примера кабинета">{sections.map(({name,mode,icon:Icon}) => <Link key={mode} to={`/cabinet?mode=${mode}`} data-current={mode === "overview"}><Icon size={13} aria-hidden="true" />{name}</Link>)}</nav>
      <Link className="ep-cabinet-luma-shortcut" to="/cabinet?mode=assistant"><LumaAvatar size={27} /><span><strong>Лума</strong><small>Обсудим ваши планы</small></span></Link>
      <small className="ep-cabinet-demo-note">Пример интерфейса · демо-данные</small>
    </aside>
    <div className="ep-cabinet-content">
      <div className="ep-cabinet-topbar"><span>Личный кабинет <i>/</i> Обзор</span><Link to="/cabinet?mode=business&pay=supplier">Оплатить счёт<ArrowUpRight size={11} /></Link><span className="ep-cabinet-avatar" aria-hidden="true">С</span></div>
      <div className="ep-cabinet-heading"><span>ООО «Север»</span><h2>Пульс вашего бизнеса</h2><p>Деньги, обязательства и следующий шаг. В одном пространстве.</p></div>
      <div className="ep-cabinet-upper">
        <div className="ep-cabinet-metrics">
          <Link to="/cabinet?mode=business" className="ep-cabinet-metric ep-cabinet-cash"><span>На счёте<Wallet size={12} /></span><strong>420 000 ₽</strong><small>Остаток из банковского профиля</small></Link>
          <Link to="/cabinet?mode=business" className="ep-cabinet-metric"><span>Денежный поток<TrendingUp size={12} /></span><strong>−26 000 ₽</strong><small>Октябрь · после расходов и налогов</small></Link>
          <Link to="/cabinet?mode=calendar&date=2026-11-18" className="ep-cabinet-metric"><span>Ближайшие платежи<CalendarDays size={12} /></span><strong>38 240 ₽</strong><small>18 ноября<ArrowUpRight size={10} /></small></Link>
          <Link to="/cabinet?mode=applications&status=action" className="ep-cabinet-metric"><span>Нужно ваше действие<FileText size={12} /></span><strong>1</strong><small>Открыть заявки<ArrowUpRight size={10} /></small></Link>
        </div>
        <div className="ep-cabinet-chart">
          <div className="ep-cabinet-panel-heading"><div><span className="ep-cabinet-kicker">БАНКОВСКАЯ ИСТОРИЯ</span><h3>Движение денег</h3></div><span>6 мес.</span></div>
          <div className="ep-cabinet-chart-tabs"><span>Поступления</span><span>Денежный поток</span></div>
          <div className="ep-cabinet-chart-value"><strong>284 000 ₽</strong><span>октябрь 2026</span></div>
          <div className="ep-cabinet-bars" aria-label="Поступления по месяцам: от 215 до 362 тысяч рублей">{[265,215,338,295,362,284].map((value,index) => <div key={index}><i style={{"--bar":`${value/362*100}%`} as CSSProperties}/><span>{["Май","Июн","Июл","Авг","Сен","Окт"][index]}</span></div>)}</div>
          <p>Фактические поступления</p>
        </div>
      </div>
      <div className="ep-cabinet-lower">
        <div className="ep-cabinet-applications"><div className="ep-cabinet-panel-heading"><div><span className="ep-cabinet-kicker">ОТ ЗАДАЧИ ДО РЕЗУЛЬТАТА</span><h3>Заявки и оформление</h3></div><ArrowUpRight size={14} aria-hidden="true" /></div><div className="ep-cabinet-pipeline">{[["Черновики","1"],["В работе","1"],["Оформлено","2"],["Закрыто","0"]].map(([label,count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div><Link to="/cabinet?mode=applications"><span><CreditCard size={15} aria-hidden="true" /></span><div><strong>Кредит на оборотные цели</strong><small>Выберите условия</small></div><b>400 000 ₽</b><ArrowUpRight size={12} aria-hidden="true" /></Link></div>
        <Link to="/cabinet?mode=assistant" className="ep-cabinet-assistant"><span className="ep-cabinet-kicker">ЛУМА / ИИ-АССИСТЕНТ</span><LumaAvatar size={42} /><h3>Яснее с деньгами.<br />Ближе к планам.</h3><span>Обсудить с Лумой<ArrowUpRight size={12} /></span></Link>
      </div>
    </div>
  </div>;
}
