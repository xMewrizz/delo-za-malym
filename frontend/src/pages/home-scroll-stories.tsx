import { ArrowDown, ArrowRight, ArrowUpRight, Check, CircleCheck, Clock3, CreditCard, Repeat2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LumaAvatar, LumaMark } from "@/shared/ui/luma-mark";

gsap.registerPlugin(ScrollTrigger);
const pinQuery = "(min-width: 900px) and (min-height: 560px) and (pointer: fine)";
const subscribePinned = (listener: () => void) => { const query = window.matchMedia(pinQuery); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); };
const usePinned = (motion: boolean) => useSyncExternalStore(subscribePinned, () => motion && window.matchMedia(pinQuery).matches, () => false);
const payment = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(400000 * .02 / (1 - Math.pow(1.02, -12))) + " ₽";
const chapters = [
  { short: "Задача", label: "Начните со своей задачи", text: "Лума уточнит детали. Запрос собирается рядом с разговором.", user: "Хочу закупить новую партию товара.", reply: "Добавила закупку в запрос. Какая сумма нужна?" },
  { short: "Сумма", label: "Сумма из разговора — уже в форме", text: "Не нужно заполнять одно и то же дважды.", user: "Нужно 400 тысяч рублей.", reply: "400 000 ₽ на закупку. На какой срок нужны деньги?" },
  { short: "Срок", label: "Условия складываются в запрос", text: "Данные можно проверить и изменить перед подбором.", user: "Верну за 12 месяцев.", reply: "Собрала запрос: 400 000 ₽ на 12 месяцев. Посмотрим, какой продукт подойдёт задаче." },
  { short: "Варианты", label: "У каждого продукта своя задача", text: "Лума объясняет различия, а кабинет показывает условия.", user: "А что лучше для такой закупки?", reply: "Для разовой закупки на год — оборотный кредит. Линия пригодится для повторных закупок, овердрафт — до выручки." },
  { short: "Выбор", label: "Последнее слово — за вами", text: "В примере выбран оборотный кредит. Отправка заявки — отдельный шаг.", user: "Выбираю оборотный кредит.", reply: "Выбранный вариант сохранён. Проверьте условия — заявку отправите, когда будете готовы." },
];

// Each chapter reserves most of its scroll distance for reading the settled content.
const lumaStep = 8;
const lumaDuration = chapters.length * lumaStep;

/** Native CSS sticky owns the layout. GSAP only scrubs content, so leaving a scene never removes a pin spacer. */
export function LumaScrollStory({ motion }: { motion: boolean }) {
  const host = useRef<HTMLDivElement>(null), pin = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const [phase, setPhase] = useState(0), [filled, setFilled] = useState(0);
  const scrub = usePinned(motion);
  const known = scrub ? filled : Math.min(3, phase + 1);
  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    if (motion) media.add(pinQuery, () => {
      if (!host.current || !pin.current) return;
      const select = gsap.utils.selector(host.current);
      let lastPhase = -1, lastFilled = -1;
      const tl = gsap.timeline({ defaults: { ease: "power2.inOut" }, scrollTrigger: { id: "landing-luma", trigger: host.current, start: "top top", end: "bottom bottom", scrub: .4, invalidateOnRefresh: true }, onUpdate: () => {
        const time = tl.time();
        const nextPhase = Math.min(4, Math.floor(time / lumaStep));
        const nextFilled = Math.min(3, Math.max(0, Math.floor((time + lumaStep - 1.9) / lumaStep)));
        // React owns semantic state only. GSAP updates the visual playhead without rerendering every frame.
        if (nextPhase !== lastPhase) { lastPhase = nextPhase; setPhase(nextPhase); }
        if (nextFilled !== lastFilled) { lastFilled = nextFilled; setFilled(nextFilled); }
      } });
      timeline.current = tl;
      gsap.set(select(".ep-story-message"), { autoAlpha: 0, y: 0 });
      gsap.set(select(".ep-story-message:first-child"), { autoAlpha: 1, y: 0 });
      gsap.set(select(".ep-demo-user,.ep-demo-reply"), { autoAlpha: 0, y: 6 });
      gsap.set(select('[data-story-message="0"] .ep-demo-user'), { autoAlpha: 1, y: 0 });
      gsap.set(select(".ep-story-field-value"), { opacity: 0, y: 6 });
      gsap.set(select(".ep-story-offers,.ep-story-selected"), { autoAlpha: 0, y: 6 });
      gsap.set(select(".ep-story-field-glow"), { opacity: 0 });
      gsap.set(select(".ep-story-sync"), { opacity: .3, scale: .85 });
      tl.fromTo(select(".ep-story-progress>i"), { scaleX: 0 }, { scaleX: 1, duration: lumaDuration, ease: "none" }, 0);
      for (let index = 0; index < 5; index++) {
        const start = index * lumaStep;
        tl.addLabel(chapters[index].short, start + 4);
        if (index) {
          tl.to(select(`[data-story-message="${index - 1}"]`), { autoAlpha: 0, y: 0, duration: .5 }, start);
          tl.to(select(`[data-story-message="${index}"]`), { autoAlpha: 1, y: 0, duration: .7, ease:"sine.inOut" }, start + .45);
          tl.to(select(`[data-story-message="${index}"] .ep-demo-user`), { autoAlpha: 1, y: 0, duration: 1.6, ease:"sine.inOut" }, start + .45);
        }
        tl.to(select(`[data-story-message="${index}"] .ep-demo-reply`), { autoAlpha: 1, y: 0, duration: 1.65, ease:"sine.inOut" }, start + .95);
        if (index < 3) {
          const at = start + 1.4;
          tl.to(select(`[data-story-field="${index}"] .ep-story-field-value`), { opacity: 1, y: 0, duration: 1.05, ease: "power2.out" }, at);
          tl.to(select(`[data-story-field="${index}"] .ep-story-field-dash`), { opacity: 0, duration: .4 }, at);
          tl.to(select(`[data-story-field="${index}"] .ep-story-field-glow`), { opacity: .7, duration: .9 }, at).to(select(`[data-story-field="${index}"] .ep-story-field-glow`), { opacity: .25, duration: .9 }, at + 1);
          tl.to(select(".ep-story-sync"), { opacity: 1, scale: 1, duration: .65 }, at - .2).to(select(".ep-story-sync"), { opacity: .3, scale: .9, duration: 1 }, at + .6);
        }
      }
      tl.to(select(".ep-story-request"), { autoAlpha: 0, y: -4, duration: .65 }, 3*lumaStep+.25);
      tl.to(select(".ep-story-offers"), { autoAlpha: 1, y: 0, duration: 1.5, ease:"sine.inOut" }, 3*lumaStep+.8);
      tl.fromTo(select(".ep-story-offer"), { y: 4, opacity: 0 }, { y: 0, opacity: 1, duration: 1.4, stagger: .18, ease:"sine.inOut" }, 3*lumaStep+.9);
      tl.to(select(".ep-story-offers"), { autoAlpha: 0, y: -4, duration: .65 }, 4*lumaStep+.25);
      tl.to(select(".ep-story-selected"), { autoAlpha: 1, y: 0, duration: 1.5, ease:"sine.inOut" }, 4*lumaStep+.8);
      tl.fromTo(select(".ep-story-selected-check"), { scale: .96, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.4, ease: "sine.inOut" }, 4*lumaStep+1.1);
      return () => { timeline.current = null; };
    }, host);
    return () => { media.revert(); timeline.current = null; };
  }, [motion]);
  const seek = (index: number) => {
    const trigger = timeline.current?.scrollTrigger;
    if (trigger) {
      window.scrollTo({top:trigger.start + (trigger.end-trigger.start) * ((index*lumaStep+4)/lumaDuration),behavior:"instant"});
      trigger.update(); trigger.getTween()?.progress(1); timeline.current?.time(index*lumaStep+4);
    }
    else { setPhase(index); setFilled(Math.min(3, index + 1)); }
  };
  return <div className="ep-live-scroll" ref={host} data-phase={phase} data-scrub={scrub ? "on" : "off"}>
    <div className="ep-live-experience ep-story-pinned" ref={pin}>
      <div className="ep-story-navigation"><div className="ep-demo-steps" aria-label="Этапы примера">{chapters.map((chapter, index) => <button key={chapter.short} type="button" aria-pressed={phase === index} onClick={() => seek(index)}>{chapter.short}</button>)}</div><span><ArrowDown size={13} />{scrub ? "Управляйте прокруткой" : "Выберите этап"}</span></div>
      <div className="ep-story-progress" aria-hidden="true"><i /></div>
      <div className="ep-live-stage ep-story-stage" data-depth="3">
        <div className="ep-demo-chrome"><span><span className="ep-online" />Как проходит подбор с Лумой</span><span>Пример · 400 000 ₽</span></div>
        <div className="ep-demo-columns ep-story-columns"><div className="ep-demo-chat"><div className="ep-demo-chat-title"><LumaAvatar size={38} /><div><strong>Лума</strong><small>Рядом с вашим бизнесом</small></div></div><div className="ep-story-chat-stack">{chapters.map((chapter, index) => <div className="ep-story-message" data-story-message={index} key={chapter.short} aria-hidden={phase !== index}><p className="ep-demo-user">{chapter.user}</p><p className="ep-demo-reply"><LumaMark size={20} />{chapter.reply}</p></div>)}</div><p className="ep-story-chat-foot"><CircleCheck size={14} />Можно уточнить, передумать и исправить</p></div>
          <div className="ep-story-workspace">
            <div className="ep-demo-form ep-story-request" aria-hidden={phase > 2}><div className="ep-demo-form-title"><h3>Ваш запрос</h3><span>{known} из 3</span></div>{["На что нужны деньги", "Сумма", "Срок возврата"].map((label, index) => <div className="ep-demo-field" key={label} data-story-field={index} data-known={index < known}><div className="ep-story-field-glow" aria-hidden="true" /><div><span>{label}</span><LumaMark size={14} /></div><strong className="ep-story-field-value" aria-hidden={index >= known}>{["Закупить товар", "400 000 ₽", "12 месяцев"][index]}</strong><strong className="ep-story-field-dash" aria-hidden={index < known}>—</strong></div>)}<div className="ep-demo-result"><span><LumaMark size={15} />Параметры появляются из разговора</span></div></div>
            <div className="ep-story-offers" aria-hidden={phase !== 3}><div className="ep-demo-form-title"><h3>Что подходит задаче</h3><span>3 продукта</span></div><article className="ep-story-offer ep-story-offer-primary"><div><CreditCard size={21} /><span>Для разовой закупки</span><Check size={15} /></div><h4>Оборотный кредит</h4><strong>{payment}<small>в месяц</small></strong><p>400 000 ₽ · 12 мес. · 24% годовых</p></article><article className="ep-story-offer"><Repeat2 size={21} /><div><h4>Кредитная линия</h4><p>Когда закупки повторяются</p></div></article><article className="ep-story-offer"><Clock3 size={21} /><div><h4>Овердрафт</h4><p>Когда расходы раньше выручки</p></div></article></div>
            <div className="ep-story-selected" aria-hidden={phase !== 4}><span className="ep-story-selected-check"><Check size={29} /></span><span className="ep-eyebrow">ВЫБРАННЫЙ ВАРИАНТ</span><h3>Кредит на<br />оборотные цели</h3><strong>400 000 ₽</strong><dl><div><dt>Срок</dt><dd>12 месяцев</dd></div><div><dt>Ставка</dt><dd>24% годовых</dd></div><div><dt>Платёж в месяц</dt><dd>{payment}</dd></div></dl><p><CircleCheck size={14} />До отправки можно изменить условия</p></div>
          </div>
        </div><span className="ep-story-sync" aria-hidden="true"><LumaMark size={17} /></span>
      </div><div className="ep-demo-caption" aria-live="polite"><div key={phase}><span>{chapters[phase].label}</span><p>{chapters[phase].text}</p></div></div>
    </div>
  </div>;
}

const products = [
  { id: "purchase", name: "Оборотный кредит", eyebrow: "РАЗОВАЯ ЗАКУПКА", title: <>Новая партия.<br />Новый оборот.</>, description: "Получите нужную сумму на закупку товара или текущие расходы. Возвращайте по понятному графику.", detail: "Одна сумма · Платёж по графику", value: "400 000 ₽", secondary: "12 месяцев", label: "На следующую закупку" },
  { id: "overdraft", name: "Овердрафт", eyebrow: "ДО ПОСТУПЛЕНИЯ ВЫРУЧКИ", title: <>Расходы сегодня.<br />Выручка — в пути.</>, description: "Когда денег на счёте временно не хватает, подключённый лимит покроет недостающую часть платежа.", detail: "Проценты — на использованный долг", value: "190 000 ₽", secondary: "Лимит к счёту", label: "Свободно в овердрафте" },
  { id: "line", name: "Кредитная линия", eyebrow: "РЕГУЛЯРНЫЕ ЗАКУПКИ", title: <>Взять часть.<br />Вернуть. Повторить.</>, description: "Используйте деньги частями. Погашенная сумма снова становится доступна в пределах лимита.", detail: "Один лимит · Несколько выборок", value: "500 000 ₽", secondary: "Возобновляемый лимит", label: "Лимит для вашего бизнеса" },
  { id: "refinancing", name: "Рефинансирование", eyebrow: "ДЕЙСТВУЮЩИЕ КРЕДИТЫ", title: <>Несколько долгов.<br />Один новый график.</>, description: "Объедините выбранные кредиты. Сравните платёж, срок и полную стоимость до оформления.", detail: "Меньше платёж не всегда значит дешевле", value: "820 000 ₽", secondary: "2 кредита → 1", label: "На погашение выбранных кредитов" },
  { id: "investment", name: "Инвестиционный кредит", eyebrow: "ОБОРУДОВАНИЕ И РАЗВИТИЕ", title: <>Ваше дело<br />может больше.</>, description: "Оборудование, новая точка или дополнительные мощности. Посмотрите, как вложения повлияют на финансы бизнеса.", detail: "Собственный взнос · Возможная отсрочка долга", value: "800 000 ₽", secondary: "Проект на 1 млн ₽", label: "Финансирование проекта" },
];

function ProductScene({ index }: { index: number }) {
  const product = products[index];
  return <div className={`ep-product-ui ep-product-ui-${product.id}`}>
    <div className="ep-product-ui-top"><LumaMark size={24} /><span>Пример использования</span><span className="ep-online" /></div><span className="ep-product-ui-label">{product.label}</span><strong className="ep-product-ui-value">{product.value}</strong><span className="ep-product-ui-sub">{product.secondary}</span>
    {index === 0 && <><div className="ep-product-ui-schedule">{[1, 2, 3, 4, 5, 6].map(month => <span key={month}><i />{month} мес.</span>)}</div><div className="ep-product-ui-row"><span>Платёж в месяц</span><strong>{payment}</strong></div><div className="ep-product-ui-row"><span>Ставка в примере</span><strong>24% годовых</strong></div></>}
    {index === 1 && <><div className="ep-product-ui-cashflow"><span>Платёж поставщику<strong>120 000 ₽</strong></span><ArrowRight size={20} /><span>Выручка через неделю<strong>180 000 ₽</strong></span></div><div className="ep-product-ui-row"><span>Из денег счёта</span><strong>50 000 ₽</strong></div><div className="ep-product-ui-row"><span>Из овердрафта</span><strong>70 000 ₽</strong></div><div className="ep-product-ui-foot">Проценты — только на 70 000 ₽ долга</div></>}
    {index === 2 && <><div className="ep-product-limit-bar"><span /><span /></div><div className="ep-product-ui-row"><span>Использовано</span><strong>180 000 ₽</strong></div><div className="ep-product-ui-row"><span>Ещё доступно</span><strong>320 000 ₽</strong></div><div className="ep-product-ui-foot"><Repeat2 size={15} />Погасили долг — лимит восстановился</div></>}
    {index === 3 && <><div className="ep-product-ui-merge"><span>320 000 ₽</span><span>500 000 ₽</span><ArrowDown size={19} /><strong>Один кредит · 820 000 ₽</strong></div><div className="ep-product-ui-foot">Покажем разницу в платежах и общей стоимости</div></>}
    {index === 4 && <><div className="ep-product-ui-project"><span /><span /></div><div className="ep-product-ui-row"><span>Собственный взнос</span><strong>200 000 ₽</strong></div><div className="ep-product-ui-row"><span>Финансирование</span><strong>800 000 ₽</strong></div><div className="ep-product-ui-foot">График учитывает условия вашего проекта</div></>}
  </div>;
}

export function ProductScrollShowcase({ motion }: { motion: boolean }) {
  const host = useRef<HTMLDivElement>(null), pin = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const navigation = useRef<gsap.core.Tween | null>(null);
  const [active, setActive] = useState(0);
  const scrub = usePinned(motion);
  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    if (motion) media.add(pinQuery, () => {
      if (!host.current || !pin.current) return;
      let lastActive = -1;
      const tl = gsap.timeline({ scrollTrigger: { id: "landing-products", trigger: host.current, start: "top top", end: () => `bottom top+=${pin.current?.offsetHeight || window.innerHeight}`, scrub: .9, invalidateOnRefresh: true }, onUpdate: () => {
        const next = Math.min(4, Math.floor(tl.time() / 5));
        if (next !== lastActive) { lastActive = next; setActive(next); }
      } });
      timeline.current = tl;
      const panels = Array.from(host.current.querySelectorAll<HTMLElement>(".ep-product-panel"));
      gsap.set(panels, {autoAlpha:0,y:22});
      gsap.set(panels[0], {autoAlpha:1,y:0});
      // Each product gets a long reading hold; only a small local transition moves.
      // The CSS runway and bounded wheel input provide a reading hold without horizontal travel.
      for (let index = 1; index < products.length; index++) {
        tl.to(panels[index - 1], {autoAlpha:0,y:-16,duration:.7,ease:"power1.in"}, index * 5 - .7);
        tl.to(panels[index], {autoAlpha:1,y:0,duration:.95,ease:"power2.out"}, index * 5 - .25);
      }
      tl.fromTo(host.current.querySelector('.ep-product-scroll-progress>i'), { scaleX: 0 }, { scaleX: 1, duration: 25, ease: "none" }, 0);
      return () => { navigation.current?.kill(); navigation.current = null; timeline.current = null; };
    }, host);
    return () => { media.revert(); timeline.current = null; };
  }, [motion]);
  const choose = (index: number) => {
    if (index === active) return;
    const tl = timeline.current, trigger = tl?.scrollTrigger;
    navigation.current?.kill();
    if (trigger && tl) {
      // Tabs select the destination directly, without rushing through other products.
      const targetTime = index * 5 + 2;
      window.scrollTo({top:trigger.start + (trigger.end-trigger.start) * targetTime/25,behavior:"instant"});
      trigger.update();
      trigger.getTween()?.progress(1);
      tl.time(targetTime);
      const panel = host.current?.querySelectorAll<HTMLElement>(".ep-product-panel")[index];
      if (panel) navigation.current = gsap.fromTo(panel, {autoAlpha:0,y:18}, {
        autoAlpha:1,y:0,duration:.65,ease:"power2.out",onComplete:()=>{navigation.current=null;},
      });
    }
    setActive(index);
  };
  return <div className="ep-product-scroll" ref={host} data-scrub={scrub ? 'on' : 'off'} data-product={active}>
    <div className="ep-product-showcase-pin" ref={pin}>
      <div className="ep-product-switch" aria-label="Продукты для разных задач">{products.map((product, index) => <button key={product.id} type="button" aria-pressed={active === index} onClick={() => choose(index)}>{product.name}</button>)}</div>
      <div className="ep-product-scroll-progress" aria-hidden="true"><i /></div>
      <div className="ep-product-window"><div className="ep-product-track">{products.map((product, index) => <article className={`ep-product-panel ep-product-panel-${product.id}`} key={product.id} aria-hidden={active !== index} inert={active !== index}><div className="ep-product-panel-copy"><p className="ep-eyebrow">{product.eyebrow}</p><h3>{product.title}</h3><p>{product.description}</p><span>{product.detail}</span><Link to="/cabinet?mode=manual">Подобрать условия<ArrowUpRight size={17} /></Link></div><div className="ep-product-panel-visual" data-depth="3"><ProductScene index={index} /></div><span className="ep-product-panel-number" aria-hidden="true">0{index + 1}</span></article>)}</div></div>
      <div className="ep-product-showcase-foot"><span>{scrub ? 'Прокрутите, чтобы перейти к следующему продукту' : 'Выберите задачу, чтобы посмотреть пример'}</span><span>{active + 1} / 5</span></div>
    </div>
  </div>;
}

