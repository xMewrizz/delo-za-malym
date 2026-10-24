import { ArrowDown, ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { LumaScrollStory, ProductScrollShowcase } from "./home-scroll-stories";
import { HomeCalendarPreview } from "./home-calendar-preview";
import { HomeCabinetShowcase } from "./home-cabinet-preview";
import { useLandingWheel } from "./use-landing-wheel";
import { Button } from "@/shared/ui/button";
import { LumaMark } from "@/shared/ui/luma-mark";
import "./home-epic.css";
import "./home-scroll-stories.css";
import "./home-art-direction.css";

gsap.registerPlugin(ScrollTrigger);

const questions = [
  { title: "Я не знаю, какой продукт нужен. С чего начать?", text: "Расскажите, что планируете: закупку, новый проект или расходы до выручки. Лума уточнит сумму и сроки, а кабинет покажет подходящие варианты. Можно заполнить запрос самостоятельно." },
  { title: "Откуда берутся данные о моём бизнесе?", text: "Сведения о компании, остаток на счёте и известные банку обязательства уже есть в профиле. Для подбора нужно уточнить вашу задачу и недостающие данные." },
  { title: "Где посмотреть проценты и будущие платежи?", text: "Ставка, проценты и состав платежей видны в условиях и графике продукта. Календарь объединяет обязательства, а сценарий задержки помогает оценить пени на выбранную дату." },
  { title: "Лума может сама отправить заявку или списать деньги?", text: "Нет. Заполненные данные можно исправить. Отправку заявки, выбранные условия и операции с деньгами вы подтверждаете отдельно." },
];

/** Masked typography, perspective assembly, inter-section parallax and staggered reveals.
 * All timelines belong to this route; matchMedia reverts them when the layout changes. */
function useLandingMotion(root: RefObject<HTMLDivElement | null>, motion: boolean) {
  useLayoutEffect(() => {
    if (!root.current || !motion) return;
    const media = gsap.matchMedia();
    const context = gsap.context(() => {
      media.add("all", () => {
        gsap.from(".ep-title-word", { yPercent: 115, rotate: 4, duration: 1.05, stagger: .1, ease: "power4.out", clearProps: "transform" });
        gsap.from(".ep-hero-intro", { y: 24, opacity: 0, duration: .8, delay: .3, clearProps: "all" });
        gsap.from(".ep-sculpture-arrive", { y: 28, rotate: -4, opacity: 0, duration: 1.6, delay: .15, ease: "power3.out", clearProps: "all" });
        gsap.utils.toArray<HTMLElement>("[data-ep-reveal]").forEach(element => {
          gsap.from(element, { y: 38, opacity: 0, duration: .85, ease: "power3.out", clearProps: "all", scrollTrigger: { trigger: element, start: "top 82%", once: true } });
        });
      });
      media.add("(min-width: 900px) and (pointer: fine)", () => {
        gsap.to(".ep-sculpture-scroll", { y: -55, rotate: 4, scale: .96, ease: "none", scrollTrigger: { trigger: ".ep-hero-main", start: "top top", end: "bottom top", scrub: 1.4 } });
        gsap.to(".ep-hero-orbit", { rotate: 40, y: -90, ease: "none", scrollTrigger: { trigger: ".ep-hero", start: "top top", end: "bottom top", scrub: 1 } });
        gsap.utils.toArray<HTMLElement>(".ep-journey li").forEach(element => {
          gsap.fromTo(element, { x: 24, opacity: .4 }, { x: 0, opacity: 1, duration: .75, ease: "power2.out", clearProps: "all", scrollTrigger: { trigger: element, start: "top 75%", once: true } });
        });
        gsap.fromTo(".ep-journey .ep-section-heading", { y: 30 }, { y: -40, ease: "none", scrollTrigger: { trigger: ".ep-journey", start: "top bottom", end: "bottom top", scrub: 1 } });
        gsap.fromTo(".ep-final h2", { xPercent: -8, opacity: .2 }, { xPercent: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: ".ep-final", start: "top 90%", end: "top 25%", scrub: .8 } });
      });
    }, root);
    let mounted = true;
    void document.fonts.ready.then(() => { if (mounted) ScrollTrigger.refresh(); });
    return () => { mounted = false; media.revert(); context.revert(); };
  }, [root, motion]);
}

function SceneLayers() {
  return <><div className="ep-scene-base depth-0" data-depth="0" aria-hidden="true" /><div className="ep-scene-light depth-1" data-depth="1" aria-hidden="true" /></>;
}

export function HomePage() {
  const root = useRef<HTMLDivElement>(null);
  useLandingWheel(root);
  const motion = true;
  useLandingMotion(root, motion);
  useEffect(() => {
    const element = root.current, hero = element?.querySelector('.ep-hero');
    if (!element || !hero) return;
    let intersecting = false;
    const update = () => { element.dataset.heroActive = String(intersecting && !document.hidden); };
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    observer.observe(hero); document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div className="ep-home" ref={root} data-motion={motion ? "on" : "off"} data-motion-engine="gsap">
    <section className="scene ep-hero" aria-labelledby="hero-title" data-scene="hero">
      <SceneLayers />
      <div className="ep-hero-orbit depth-2" data-depth="2" aria-hidden="true"><LumaMark size={420} /></div>
      <div className="ep-hero-main">
        <div className="ep-hero-copy depth-4" data-depth="4"><p className="ep-eyebrow ep-hero-intro"><span className="ep-online" />ФИНАНСИРОВАНИЕ ДЛЯ ВАШЕГО БИЗНЕСА</p><h1 id="hero-title" aria-label="Большие планы. Дело за малым."><span className="ep-title-mask" aria-hidden="true"><span className="ep-title-word">Большие планы.</span></span><span className="ep-title-mask ep-title-accent" aria-hidden="true"><span className="ep-title-word">Дело за малым.</span></span></h1><div className="ep-hero-intro ep-hero-bottom"><p>Финансирование и платежи бизнеса — в одном кабинете.</p><div className="ep-hero-actions"><Button asChild size="lg"><Link to="/cabinet?mode=manual">Подобрать финансирование<ArrowUpRight /></Link></Button><a href="#products">Посмотреть продукты<ArrowDown size={16} /></a></div></div></div>
        <div className="ep-hero-sculpture depth-3" data-depth="3" aria-hidden="true"><div className="ep-sculpture-scroll"><div className="ep-sculpture-arrive"><div className="ep-sculpture-float"><img src="/images/finance-sculpture.webp" alt="" width="1200" height="800" fetchPriority="high" /><div className="ep-sculpture-caption"><LumaMark size={23} /><span>Большие планы<br /><strong>начинаются с вашего дела</strong></span></div></div></div></div><span className="ep-sculpture-shadow" /></div>
      </div>
      <HomeCabinetShowcase />
    </section>

    <section className="scene ep-live-section" id="capabilities" aria-labelledby="luma-title" data-scene="live-form"><SceneLayers /><div className="ep-section-heading depth-4" data-depth="4" data-ep-reveal><p className="ep-eyebrow"><LumaMark size={20} />ЗНАКОМЬТЕСЬ, ЛУМА</p><h2 id="luma-title">Из ваших слов —<br /><em>в понятный план.</em></h2><p>Обсуждайте задачу и смотрите, как заполняется запрос.<br className="ep-desktop-break" /> Суммы, сроки и изменения — перед глазами.</p></div><div className="depth-3" data-depth="3"><LumaScrollStory motion={motion} /></div><div className="ep-live-links depth-4" data-depth="4"><Link to="/cabinet?mode=assistant">Обсудить свою задачу<LumaMark size={21} /><ArrowUpRight size={16} /></Link><Link to="/cabinet?mode=manual">Или заполнить самостоятельно<ArrowRight size={15} /></Link></div></section>

    <section className="scene ep-control-section" aria-labelledby="control-title" data-scene="control"><SceneLayers /><div className="ep-section-heading ep-heading-row depth-4" data-depth="4" data-ep-reveal><div><p className="ep-eyebrow">ДЕНЬГИ И ПЛАТЕЖИ</p><h2 id="control-title">Что поступит.<br className="ep-mobile-break" /> <em>Что нужно заплатить.</em></h2></div><p>Поступления, расходы и кредиты.<br />С остатком на каждую дату.</p></div><div className="ep-control-board depth-3" data-depth="3" data-ep-reveal><HomeCalendarPreview /></div></section>

    <section className="scene ep-products-section" id="products" aria-labelledby="products-heading" data-scene="products"><SceneLayers /><div className="ep-section-heading ep-heading-row depth-4" data-depth="4" data-ep-reveal><div><p className="ep-eyebrow">НА КАЖДЫЙ СЛЕДУЮЩИЙ ШАГ</p><h2 id="products-heading">Разные задачи.<br /><em>Свои решения.</em></h2></div><p>Закупка, расходы до выручки,<br />оборудование или новый график.<br />Начните с того, что нужно делу.</p></div><div className="depth-3" data-depth="3"><ProductScrollShowcase motion={motion} /></div></section>

    <section className="scene ep-journey" id="selection-guide" aria-labelledby="guide-title" data-scene="journey"><SceneLayers /><div className="ep-section-heading depth-4" data-depth="4" data-ep-reveal><p className="ep-eyebrow">ВАША ЗАДАЧА. ВАШЕ РЕШЕНИЕ.</p><h2 id="guide-title">От первого слова —<br /><em>до следующего шага.</em></h2></div><ol className="depth-3" data-depth="3">{[["Расскажите о планах", "В разговоре с Лумой или в короткой форме. Данные бизнеса уже под рукой."], ["Сравните предложения", "Посмотрите суммы, сроки и платежи. Проверьте, что изменится в другом сценарии."], ["Выберите и подтвердите", "Вы решаете, когда отправить заявку. Дальше — её статус, продукты и платежи в кабинете."]].map(([title, text], index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowUpRight size={22} aria-hidden="true" /></li>)}</ol></section>

    <section className="scene ep-faq" id="questions" aria-labelledby="questions-title" data-scene="questions"><SceneLayers /><div className="ep-section-heading depth-4" data-depth="4" data-ep-reveal><h2 id="questions-title">Разберёмся<br /> <em>по делу.</em></h2></div><div className="ep-faq-list depth-3" data-depth="3" data-ep-reveal>{questions.map(question => <details key={question.title}><summary>{question.title}<ChevronDown size={19} aria-hidden="true" /></summary><p>{question.text}</p></details>)}</div></section>

    <section className="scene ep-final" aria-labelledby="final-title" data-scene="next-step"><SceneLayers /><div className="depth-4 ep-final-copy" data-depth="4"><p className="ep-eyebrow">СЛЕДУЮЩИЙ ШАГ — ВАШ</p><h2 id="final-title">Планы есть.<br /><em>Дело за малым.</em></h2><div><Button asChild size="lg"><Link to="/cabinet?mode=manual">Подобрать финансирование<ArrowUpRight /></Link></Button><Link className="ep-final-manual" to="/cabinet?mode=assistant">Обсудить с Лумой<ArrowRight size={16} /></Link></div></div></section>
  </div>;
}
