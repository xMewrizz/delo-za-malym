import { ArrowRight, ArrowUpRight, BookOpen, Boxes, CheckCheck, Code2, FileText, GitBranch, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/shared/ui/button";
import "./project-page.css";

const documents = [
  { title: "Начало работы", text: "Запуск, окружение и проверка сквозного сценария", href: "/project-docs/start.md", icon: BookOpen },
  { title: "Продукт и сценарии", text: "Границы MVP, задачи бизнеса и путь клиента", href: "/project-docs/product.md", icon: FileText },
  { title: "Архитектура", text: "Компоненты, состояния и хранение данных", href: "/project-docs/architecture.md", icon: Boxes },
  { title: "Описание API", text: "Методы и контракты кредитного процесса", href: "/project-docs/api.md", icon: Code2 },
  { title: "Тестовые сценарии", text: "Подготовленные кейсы и ожидаемые результаты", href: "/project-docs/scenarios.md", icon: CheckCheck },
  { title: "Рефинансирование", text: "Замена долгов, сравнение стоимости и новый график", href: "/project-docs/refinancing.md", icon: GitBranch },
  { title: "Инвестиционный кредит", text: "Стоимость проекта, свой взнос, отсрочка и график", href: "/project-docs/investment.md", icon: GitBranch },
  { title: "Кредитная линия", text: "Возобновляемый лимит, выборки, погашения и проценты", href: "/project-docs/credit-line.md", icon: GitBranch },
];

export function ProjectPage() {
  return <article className="project-page">
    <p className="section-kicker">О проекте / Alfa Hack 2026</p>
    <h1>Меньше банковской сложности.<br /><span>Больше вашего дела.</span></h1>
    <p className="project-lead">«Дело за малым» объединяет подбор финансирования, оформление заявки и планирование платежей. От первой задачи до понятного результата — в одном кабинете.</p>
    <Button asChild><Link to="/cabinet">Посмотреть, как работает<ArrowRight /></Link></Button>
    <section className="project-section"><p className="section-kicker">Сквозной путь</p><h2>Контекст сохраняется на каждом шаге</h2>
      <ol className="project-journey">{["Задача бизнеса", "Сравнение условий", "Подтверждение заявки", "Рассмотрение", "Финансирование"].map((step, i) => <li key={step}><span>0{i + 1}</span><strong>{step}</strong>{i < 4 && <ArrowRight aria-hidden="true" />}</li>)}</ol>
    </section>
    <section className="project-principles">
      <div><ShieldCheck /><h2>Решение можно проверить</h2><p>Деньги считает кредитный движок. Ассистент помогает собрать сведения и объяснить результат. Изменения заявки требуют подтверждения.</p></div>
      <div><GitBranch /><h2>Обсуждать — без обязательств</h2><p>Сравнивайте суммы, сроки и перенос поступлений на копии заявки. Выбранный вариант сохраняется отдельно от обсуждения.</p></div>
      <div><Boxes /><h2>Один работающий продукт</h2><p>React и TypeScript, Vite, TanStack Query, FastAPI, SQLite и отдельный финансовый модуль. Docker собирает интерфейс и API в одном окружении.</p></div>
    </section>
    <section className="project-section" id="documentation"><p className="section-kicker">Для команды и экспертов</p><h2>Документация без поиска по чатам</h2><p className="project-section-note">Материалы из репозитория проекта. Markdown-файлы можно открыть или сохранить, а API — проверить интерактивно.</p>
      <div className="project-documents">{documents.map(({ title, text, href, icon: Icon }) => <a key={href} href={href} target="_blank" rel="noreferrer"><Icon /><div><h3>{title}</h3><p>{text}</p></div><ArrowUpRight /></a>)}<a href="/docs" target="_blank" rel="noreferrer"><Code2 /><div><h3>Интерактивный API</h3><p>Актуальная OpenAPI-схема работающего сервера</p></div><ArrowUpRight /></a></div>
    </section>
    <aside className="project-scope"><ShieldCheck /><div><h2>Честно о границах демоверсии</h2><p>Работают оборотный кредит, овердрафт, рефинансирование, возобновляемая кредитная линия и инвестиционный кредит. Профиль компании синтетический; банковские проверки, подписание и выдача смоделированы. Настоящая авторизация, OCR сканов и промышленные банковские интеграции — следующие этапы развития.</p></div></aside>
  </article>;
}
