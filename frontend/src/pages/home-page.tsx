import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Layers3, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { ProductsCatalog } from "@/features/products";
import { upcomingProducts } from "@/shared/lib/product-directions";
import { Button } from "@/shared/ui/button";
import "./home-next.css";

const questions = [
  { title: "С чего начать, если не знаю, какой нужен продукт?", text: "Начните с задачи: закупить товар, оплатить расходы до поступления выручки или сравнить способы финансирования. В кабинете можно заполнить форму или обсудить всё с ассистентом." },
  { title: "Нужно ли заново заполнять данные компании?", text: "Сведения о компании, остаток и известные банку обязательства уже есть в профиле. Для подбора уточняются задача и недостающие данные." },
  { title: "Где посмотреть сумму, ставку и платежи?", text: "В кабинете после подбора под ваш бизнес. Предварительные варианты можно сравнить и изменить. Итоговое предложение появится после рассмотрения заявки." },
  { title: "Ассистент может отправить заявку за меня?", text: "Изменения можно проверить и исправить. Выбор условий, отправка заявки и подписание требуют отдельного подтверждения." },
];

export function HomePage() {
  return <div className="next-home">
    <section className="next-hero" aria-labelledby="hero-title">
      <div className="next-hero-copy">
        <p className="next-eyebrow"><span /> БОЛЬШОМУ ДЕЛУ — ВОЗМОЖНОСТИ</p>
        <h1 id="hero-title">Ваш бизнес.<br />Следующий<br /><span>масштаб<ArrowUpRight aria-hidden="true" /></span></h1>
        <p className="next-hero-lead">Деньги на то, что вы задумали.<br />С понятным планом и ИИ рядом.</p>
        <div className="next-hero-actions"><Button asChild size="lg"><Link to="/cabinet">Войти в кабинет<ArrowUpRight /></Link></Button><a href="#products">Найти своё решение<ArrowDown size={17} /></a></div>
        <div className="next-hero-proof"><span><Check size={14} />Данные бизнеса уже под рукой</span><span><Check size={14} />Решение за вами</span></div>
      </div>
      <div className="next-hero-scene">
        <div className="next-scene-orbit" aria-hidden="true" /><span className="next-scene-coordinate" aria-hidden="true">ОТ ИДЕИ К ДЕЙСТВИЮ / 01</span>
        <img src="/images/finance-sculpture.webp" width="1200" height="800" alt="" className="next-finance-object" fetchPriority="high" />
        <div className="next-object-tag"><span className="next-tag-star" aria-hidden="true">✳</span><div><span>Планы становятся ближе</span><strong>Дело за малым.</strong></div></div>
        <Link className="next-scene-assistant" to="/cabinet?mode=assistant"><Sparkles size={19} /><span>Сначала обсудим?<small>Разберём вашу задачу с ИИ</small></span><ArrowUpRight size={18} /></Link>
      </div>
    </section>
    <div className="next-principles" aria-label="Как устроен сервис"><span><i>01</i>Сначала ваша задача</span><span><i>02</i>Затем подходящие условия</span><span><i>03</i>Всё под вашим контролем</span><Layers3 aria-hidden="true" /></div>

    <section className="next-capabilities" id="capabilities" aria-labelledby="capabilities-title"><div className="next-section-heading"><p className="next-eyebrow">БОЛЬШЕ ЯСНОСТИ. МЕНЬШЕ РУТИНЫ.</p><h2 id="capabilities-title">Финансы, которые<br />работают <em>вместе с вами.</em></h2></div>
      <div className="next-bento"><Link to="/cabinet" className="next-bento-dashboard"><div><span className="next-card-label">01 / КОНТРОЛЬ</span><h3>Вся картина.<br />Один кабинет.</h3><p>Остаток, поступления, заявки и платежи — чтобы видеть следующий шаг.</p></div><div className="next-mini-visual" aria-hidden="true"><span>ПРОСТРАНСТВО ВАШЕГО БИЗНЕСА</span><div className="next-mini-metrics"><i /><i /><i /></div><div className="next-mini-bars">{[42, 65, 51, 82, 72, 100].map((height, index) => <i key={index} style={{ height: height + "%" }} />)}</div><small>Ваши данные. В понятном виде.</small></div><ArrowUpRight className="next-card-arrow" /></Link>
        <Link to="/cabinet?mode=assistant" className="next-bento-ai"><span className="next-card-label">02 / ДИАЛОГ</span><Sparkles className="next-ai-symbol" aria-hidden="true" /><h3>Можно просто<br />рассказать.</h3><p>Ассистент уточнит детали. Суммы, даты и варианты появятся рядом с разговором.</p><span className="next-link-text">Обсудить задачу<ArrowUpRight size={18} /></span></Link>
        <Link to="/cabinet?mode=calendar" className="next-bento-calendar"><span className="next-card-label">03 / ПЛАН</span><div className="next-calendar-symbol" aria-hidden="true">{Array.from({ length: 15 }, (_, index) => <i key={index} />)}</div><h3>Знать, что впереди.</h3><p>Общий платёжный календарь или график одного продукта. Ближайшие обязательства — перед глазами.</p><span className="next-link-text">Открыть календарь<ArrowUpRight size={18} /></span></Link>
      </div>
    </section>
    <section id="products" className="next-products" aria-labelledby="products-heading"><div className="next-section-heading next-heading-row"><div><p className="next-eyebrow">РАЗНЫЕ ЗАДАЧИ — РАЗНЫЕ РЕШЕНИЯ</p><h2 id="products-heading">Капитал для<br /><em>вашего движения.</em></h2></div><p>Выберите направление.<br />Условия подберём в кабинете<br />с учётом вашего бизнеса.</p></div><ProductsCatalog />
      <div className="next-horizons-heading"><span>Следующие возможности</span><span>В разработке</span></div><div className="next-horizons">{upcomingProducts.map(product => <article key={product.id}><span>{product.number}<ArrowUpRight size={17} /></span><h3>{product.name}</h3><p>{product.description}</p><small>Скоро</small></article>)}</div>
    </section>
    <section className="next-journey" id="selection-guide" aria-labelledby="guide-heading"><div className="next-section-heading"><p className="next-eyebrow">ОТ «НУЖНЫ ДЕНЬГИ» К ПОНЯТНОМУ ПЛАНУ</p><h2 id="guide-heading">Ваше дело.<br /><em>Ваш следующий шаг.</em></h2></div><ol>{[
      ["Расскажите о задаче", "В форме или в разговоре. Нужна закупка, запас оборотных средств или деньги до выручки?"],
      ["Посмотрите на варианты", "Сравните сумму, платёж и сроки. Обсудите с ассистентом, что изменится при другом сценарии."],
      ["Выберите и подтвердите", "Проверьте данные и отправьте заявку. Статус, документы и дальнейшие действия останутся в кабинете."],
    ].map(([title, text], index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowUpRight aria-hidden="true" /></li>)}</ol></section>
    <section className="next-faq" id="questions" aria-labelledby="questions-heading"><div className="next-section-heading"><p className="next-eyebrow">БЕЗ БАНКОВСКОГО СЛОВАРЯ</p><h2 id="questions-heading">Есть вопрос?<br /><em>Разберёмся.</em></h2></div><div>{questions.map(question => <details key={question.title}><summary>{question.title}<ChevronDown size={19} /></summary><p>{question.text}</p></details>)}</div></section>
    <section className="next-final"><span className="next-final-star" aria-hidden="true">✳</span><p>Большие планы начинаются с одного шага.</p><h2>Дальше —<br />дело за вами.</h2><Button asChild size="lg"><Link to="/cabinet">Открыть кабинет<ArrowRight /></Link></Button></section>
  </div>;
}
