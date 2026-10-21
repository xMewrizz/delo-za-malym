import { ArrowUpRight } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { Button } from '@/shared/ui/button'
import './layout.css'

const copyrightYear = new Date().getFullYear()

export function AppLayout() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <div className="app-frame">
      <div className="app-utility">
        <div className="app-container app-utility-inner">
          <span>Для малого бизнеса и предпринимателей</span>
          <span className="app-environment"><span aria-hidden="true" />Демонстрационный кабинет</span>
        </div>
      </div>
      <header className="app-header">
        <div className="app-container app-header-inner">
          <Link to="/" className="app-brand" aria-label="Дело за малым — главная">
            <span>Дело за малым<span className="app-brand-dot">.</span><span className="app-brand-caption">Больше возможностей для бизнеса</span></span>
          </Link>
          <nav className="app-navigation" aria-label="Разделы кабинета">
            <NavLink to="/" end>Финансирование</NavLink>
            <NavLink to="/cabinet">Кабинет</NavLink>
            <a href="/#selection-guide">Как выбрать</a>
            <a href="/#questions">Вопросы и ответы</a>
          </nav>
          <Button asChild variant="secondary" className="app-header-action"><Link to="/cabinet">Открыть кабинет<ArrowUpRight aria-hidden="true" /></Link></Button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="app-container app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div className="app-container">
          <div className="app-footer-top">
            <Link to="/" className="app-brand"><span>Дело за малым<span className="app-brand-dot">.</span></span></Link>
            <p>Вы занимаетесь делом.<br /><span>Мы помогаем с возможностями.</span></p>
            <a href="/#products" className="app-footer-link">Выбрать финансирование<ArrowUpRight size={18} aria-hidden="true" /></a>
          </div>
          <div className="app-footer-bottom">
            <p>Демонстрационный кредитный кабинет. Условия продуктов приведены для ознакомления и не являются публичной офертой.</p>
            <span>© {copyrightYear} Дело за малым</span>
          </div>
        </div>
      </footer>
      </div>
    </div>
  )
}
