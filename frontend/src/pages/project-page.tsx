import {ArrowRight,ArrowUpRight,CalendarDays,Check,CreditCard,FileText,GitBranch,Package,Repeat2,ShieldCheck,Wallet} from "lucide-react";
import {useEffect,useLayoutEffect,useRef} from "react";
import {Link,useLocation,useNavigate} from "react-router";
import {gsap} from "gsap";
import {ScrollTrigger} from "gsap/ScrollTrigger";
import {Button} from "@/shared/ui/button";
import {LumaMark} from "@/shared/ui/luma-mark";
import "./project-page.css";
gsap.registerPlugin(ScrollTrigger);
const journey=[
 {title:"Начать с планов бизнеса",text:"Закупить товар, дождаться выручки, купить оборудование или изменить действующие кредиты. Известные банку сведения уже в профиле."},
 {title:"Увидеть подходящие условия",text:"Сумма, срок, платёж и полная стоимость — рядом. Если исходный запрос не проходит, кабинет ищет допустимые варианты с учётом ограничений предпринимателя."},
 {title:"Пройти оформление",text:"Собранные данные переходят в заявку. Этапы проверки, запросы сведений и дополнительные условия видны в одном месте."},
 {title:"Управлять после выдачи",text:"Проверять долг и проценты, погашать кредит, использовать лимиты, оплачивать поставщикам и планировать платежи."},
];
const products=[
 {icon:Package,title:"Оборотный кредит",task:"Закупка одной партией",text:"Получить сумму и возвращать по графику."},
 {icon:Wallet,title:"Овердрафт",task:"Расходы раньше выручки",text:"Покрыть нехватку в платеже до поступления денег."},
 {icon:Repeat2,title:"Кредитная линия",task:"Регулярные закупки",text:"Брать частями и снова использовать погашенный лимит."},
 {icon:GitBranch,title:"Рефинансирование",task:"Новый график для долгов",text:"Сравнить нагрузку и стоимость замены выбранных кредитов."},
 {icon:CreditCard,title:"Инвестиционный кредит",task:"Оборудование и развитие",text:"Учесть стоимость проекта, свой взнос и отсрочку долга."},
];
export function ProjectPage(){
 const root=useRef<HTMLElement>(null),location=useLocation(),navigate=useNavigate();
 useEffect(()=>{if(location.hash==="#documentation")navigate("/documentation",{replace:true});},[location.hash,navigate]);
 useEffect(()=>{const previous=document.title;document.title="О проекте — Дело за малым";return()=>{document.title=previous;};},[]);
 useLayoutEffect(()=>{const context=gsap.context(()=>{
  gsap.from(".about-hero-copy>*",{y:20,opacity:0,stagger:.18,duration:1.1,ease:"power2.out",clearProps:"all"});
  gsap.from(".about-case",{y:30,opacity:0,duration:1.25,delay:.3,ease:"power2.out",clearProps:"all"});
  gsap.utils.toArray<HTMLElement>("[data-about-reveal]").forEach(node=>gsap.from(node,{y:24,opacity:0,duration:1.1,ease:"power2.out",clearProps:"all",scrollTrigger:{trigger:node,start:"top 64%",once:true}}));
  gsap.from(".about-live-field",{y:12,opacity:0,stagger:.36,duration:1.05,delay:.25,ease:"power2.out",clearProps:"all",scrollTrigger:{trigger:".about-live-form",start:"top 58%",once:true}});
 },root);return()=>context.revert();},[]);
 return <article className="project-page" ref={root}>
  <div className="about-backdrop" data-depth="0" aria-hidden="true"/>
  <section className="about-hero"><div className="about-hero-copy" data-depth="4"><p className="about-eyebrow">О ПРОЕКТЕ · ДЕЛО ЗА МАЛЫМ</p><h1>Финансирование<br/>начинается<br/><em>с задачи бизнеса.</em></h1><p className="about-lead">Предпринимателю нужно вовремя закупить товар, открыть новую точку или дождаться оплаты клиента. Кабинет помогает подобрать деньги под эти планы — и управлять обязательствами после выдачи.</p><Button asChild><Link to="/cabinet?mode=overview">Посмотреть решение<ArrowUpRight size={17}/></Link></Button></div>
  <div className="about-case" data-depth="3"><div className="about-case-heading"><span><FileText size={18}/>Задача предпринимателя</span><small>Пример</small></div><p>Закупить новую партию товара</p><strong>450 000 ₽</strong><span className="about-case-date"><CalendarDays size={14}/>Оплатить через 12 дней</span><dl><div><dt>Собственные деньги</dt><dd>130 000 ₽</dd></div><div><dt>Нужно покрыть</dt><dd>320 000 ₽</dd></div></dl><div className="about-case-result"><Check size={19}/><p>Сравнить способы финансирования<span>С учётом срока, остатка и действующих кредитов</span></p></div></div></section>
  <section className="about-purpose" data-about-reveal><p className="about-eyebrow">ОТ ПЛАНА ДО ПЛАТЕЖА</p><h2>Одна задача.<br/><em>Цельный путь к результату.</em></h2><p>Суммы и даты сохраняют смысл на каждом шаге: в подборе, заявке, решении и платёжном календаре. Предприниматель видит, что доступно сейчас и какие обязательства появятся дальше.</p></section>
  <ol className="about-journey">{journey.map((item,index)=><li key={item.title} data-about-reveal><span>0{index+1}</span><div><h3>{item.title}</h3><p>{item.text}</p></div></li>)}</ol>
  <section className="about-luma" data-about-reveal><div data-depth="4"><p className="about-eyebrow"><LumaMark size={20}/>ЛУМА РЯДОМ С ЗАДАЧЕЙ</p><h2>Разговор становится<br/><em>видимым запросом.</em></h2><p>Пока предприниматель обсуждает планы с Лумой, форма рядом заполняется и подсвечивает изменения. Можно уточнить сумму, пересмотреть срок и сразу увидеть, что изменилось.</p><p>Те же данные можно ввести самостоятельно. Оба способа используют общий финансовый расчёт.</p><Link to="/cabinet?mode=assistant">Попробовать разговор<ArrowUpRight size={16}/></Link></div><div className="about-live-form" data-depth="3"><p><LumaMark size={18}/>«Нужно 330 тысяч на закупку. Верну за два года»</p>{[["Задача","Закупить товар"],["Сумма","330 000 ₽"],["Срок","24 месяца"]].map(([label,value])=><div className="about-live-field" key={label}><span>{label}</span><strong>{value}</strong><Check size={15}/></div>)}<small>Пример заполнения из разговора</small></div></section>
  <section className="about-products"><header data-about-reveal><p className="about-eyebrow">ПЯТЬ ПРОДУКТОВ</p><h2>Разные планы.<br/><em>Своя логика финансирования.</em></h2></header><div>{products.map(({icon:Icon,...product})=><article key={product.title} data-about-reveal><span className="about-product-icon"><Icon size={21}/></span><span>{product.task}</span><h3>{product.title}</h3><p>{product.text}</p></article>)}</div></section>
  <section className="about-decision" data-about-reveal><div><p className="about-eyebrow">РЕШЕНИЕ, КОТОРОЕ МОЖНО ПОНЯТЬ</p><h2>Условия учитывают<br/><em>возможности бизнеса.</em></h2><p>Движок проверяет поступления, расходы, налоги и действующие обязательства. Отрицательные месяцы сохраняются в расчёте. Для кредита, овердрафта и линии применяются разные правила.</p></div><ol>{["Данные и банковские проверки","Оценка риска и допустимой нагрузки","Расчёт условий каждого варианта","Предложения и причины решения"].map((step,index)=><li key={step}><span>{index+1}</span>{step}</li>)}</ol></section>
  <section className="about-trust">{[{icon:ShieldCheck,title:"Финансовые правила можно проверить",text:"Ставки, проценты и графики считает отдельный движок. Лума помогает собрать сведения и объяснить полученный результат."},{icon:Check,title:"Решение остаётся за предпринимателем",text:"Уменьшенная сумма требует согласия. Отправка заявки, условия договора и операции с деньгами подтверждаются отдельно."},{icon:CalendarDays,title:"Кабинет полезен после оформления",text:"Текущий долг, начисленные проценты, досрочное погашение, календарь и сценарий пеней помогают планировать следующие шаги."}].map(({icon:Icon,title,text})=><article key={title} data-about-reveal><Icon size={23}/><h3>{title}</h3><p>{text}</p></article>)}</section>
  <footer className="about-finish" data-about-reveal><div><p className="about-eyebrow">ПОСМОТРЕТЬ СВОИМИ ГЛАЗАМИ</p><h2>Проект можно пройти<br/><em>от начала до результата.</em></h2><p>В кабинете подготовлены связанные примеры продуктов, заявок и операций. Компания и банковские действия демонстрационные.</p></div><div><Button asChild><Link to="/cabinet?mode=overview">Открыть кабинет<ArrowUpRight size={17}/></Link></Button><Link to="/documentation">Как всё устроено — в документации<ArrowRight size={16}/></Link></div></footer>
 </article>;
}
