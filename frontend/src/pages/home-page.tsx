import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, FileText, Layers3, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { ProductsCatalog } from '@/features/products'
import { Button } from '@/shared/ui/button'
import { Link } from 'react-router'
import './home-page.css'
import './home-sections.css'

const selectionSteps = [
  { title: 'Начните с задачи', text: 'Закупить товар, оплатить расходы или дождаться выручки — определите, для чего нужны деньги.' },
  { title: 'Определите сумму и срок', text: 'Оцените, сколько нужно бизнесу и когда вы сможете вернуть деньги.' },
  { title: 'Сравните условия', text: 'Посмотрите на ставку, порядок возврата и срок. Выберите механику, подходящую вашему бизнесу.' },
]

const questions = [
  { title: 'Чем кредит отличается от овердрафта?', text: 'Кредит — это одна сумма для задачи бизнеса с возвратом по графику. Овердрафт помогает покрыть короткий кассовый разрыв: вы используете деньги в пределах лимита, а поступления на счёт погашают задолженность.' },
  { title: 'Как понять, какой продукт мне подходит?', text: 'Если планируете закупку и постепенный возврат денег из выручки, присмотритесь к кредиту на оборотные цели. Если деньги нужны до ближайшего поступления на счёт — к овердрафту. Сравните срок, сумму и порядок погашения.' },
  { title: 'Где посмотреть условия для моего бизнеса?', text: 'Откройте кабинет и расскажите о задаче. Сервис учтёт данные бизнеса и покажет доступные варианты с суммой, сроком и платежами. Итоговое предложение появится после рассмотрения заявки.' },
  { title: 'Можно ли оформить заявку в этом кабинете?', text: 'Да. В разделе «Кабинет» можно создать заявку, получить предварительный расчёт и пройти демонстрационное оформление.' },
]

export function HomePage() {
  return (
    <>
      <section className="finance-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-eyebrow"><span aria-hidden="true" />ФИНАНСИРОВАНИЕ ДЛЯ БИЗНЕСА</p>
          <h1 id="hero-title">Большие планы.<br /><span>Дело за малым.</span></h1>
          <p className="hero-description">Финансирование, которое движет бизнес вперёд.<br className="desktop-break" /> На новые закупки, текущие задачи и следующий шаг.</p>
          <div className="hero-actions">
            <Button asChild size="lg"><Link to="/cabinet">Войти в кабинет<ArrowUpRight aria-hidden="true" /></Link></Button>
            <a href="#selection-guide" className="hero-secondary">Как это работает<ArrowDown size={17} aria-hidden="true" /></a>
          </div>
          <p className="hero-note"><Check size={14} aria-hidden="true" />От первой идеи до финансирования — в одном месте.</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-art-halo" />
          <div className="hero-art-glow" />
          <img className="hero-hand" src="/images/finance-hero-hand.png" alt="" width="1122" height="1402" fetchPriority="high" decoding="async" />
          <div className="hero-float hero-float-top">
            <span className="hero-float-icon">↗</span>
            <span>Финансирование<strong>Под вашу задачу</strong></span>
          </div>
          <div className="hero-float hero-float-bottom">
            <span className="hero-float-caption">Ваш следующий шаг</span>
            <span className="hero-float-graphic"><i /><i /><i /></span>
            <strong>Новые возможности</strong>
          </div>
        </div>
      </section>

      <div className="benefits-strip" aria-label="О финансировании">
        <div><span className="benefit-icon"><Wallet aria-hidden="true" /></span><p><b>Деньги на задачи бизнеса</b><span>От закупок до текущих расходов</span></p></div>
        <div><span className="benefit-icon"><Layers3 aria-hidden="true" /></span><p><b>Разные механики возврата</b><span>По графику или из поступлений</span></p></div>
        <div><span className="benefit-icon"><ShieldCheck aria-hidden="true" /></span><p><b>Условия перед глазами</b><span>Сумма, ставка и срок в одном месте</span></p></div>
      </div>

      <section id="capabilities" className="home-capabilities" aria-labelledby="capabilities-title"><div className="section-heading"><div><p className="section-kicker">Меньше рутины. Больше дела.</p><h2 className="section-title" id="capabilities-title">Ваш бизнес — в центре.</h2></div><p>Всё, что нужно для следующего шага.<br />Без переключения между сервисами.</p></div><div className="capability-grid"><article><span className="capability-icon"><Sparkles /></span><span className="capability-number">01</span><h3>Сначала задача.<br />Потом продукт.</h3><p>Расскажите о закупке или кассовом разрыве. Ассистент соберёт параметры, а форма и денежный план обновятся рядом.</p><Link to="/cabinet?mode=assistant">Обсудить свою задачу<ArrowUpRight size={17} /></Link></article><article><span className="capability-icon"><FileText /></span><span className="capability-number">02</span><h3>Каждая заявка.<br />Понятный следующий шаг.</h3><p>Данные уже подставлены. Сравните условия, подтвердите выбор и следите за рассмотрением — весь контекст сохраняется.</p><Link to="/cabinet?mode=applications">Заглянуть в кабинет<ArrowUpRight size={17} /></Link></article><article><span className="capability-icon"><CalendarDays /></span><span className="capability-number">03</span><h3>Платежи.<br />Без неожиданностей.</h3><p>Все кредиты и лимиты в одном месте. Общий календарь или график конкретного продукта — выбирайте удобный вид.</p><Link to="/cabinet?mode=calendar">Посмотреть календарь<ArrowUpRight size={17} /></Link></article></div></section>

      <section id="products" className="products-section" aria-labelledby="products-heading">
        <div className="section-heading">
          <div><p className="section-kicker">Финансирование</p><h2 id="products-heading" className="section-title">Деньги под вашу задачу</h2></div>
          <p>На развитие и на каждый день.<br />{' '}Выберите подходящий формат.</p>
        </div>
        <ProductsCatalog />
        <p className="catalog-disclaimer">Сумму, срок и условия подберём в кабинете с учётом данных вашего бизнеса.</p>
      </section>

      <section id="selection-guide" className="selection-section" aria-labelledby="guide-heading">
        <div className="selection-intro"><p className="section-kicker">Всё начинается с вашей идеи</p><h2 id="guide-heading" className="section-title">Ваше дело.<br />{' '}Ваше решение.</h2><p>Три шага, чтобы разобраться<br className="desktop-break" /> в финансировании.</p><a href="#products" className="text-link">Сравнить продукты<ArrowRight size={18} aria-hidden="true" /></a></div>
        <ol className="selection-steps">
          {selectionSteps.map((step, index) => <li key={step.title}><span className="step-number">0{index + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}
        </ol>
      </section>

      <section id="questions" className="questions-section" aria-labelledby="questions-heading">
        <div><p className="section-kicker">Разберёмся вместе</p><h2 id="questions-heading" className="section-title">Есть вопросы?<br />{' '}Есть ответы.</h2></div>
        <div className="question-list">{questions.map((question) => <details key={question.title} className="question"><summary>{question.title}<ChevronDown size={21} aria-hidden="true" /></summary><p>{question.text}</p></details>)}</div>
      </section>
      <section className="home-final-cta"><div><p>Для вашего следующего шага</p><h2>Осталось только начать.</h2><span>Ваш бизнес уже умеет больше, чем кажется.</span></div><Button asChild size="lg"><Link to="/cabinet">Войти в кабинет<ArrowUpRight /></Link></Button></section>
    </>
  )
}
