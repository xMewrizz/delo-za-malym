import { ArrowUpRight } from 'lucide-react'
import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { Button } from '@/shared/ui/button'
import { BrandLogo } from '@/shared/ui/brand-logo'
import { ThemeToggle } from '@/shared/ui/theme-toggle'
import './layout.css'
import './neon-design.css'

const copyrightYear = new Date().getFullYear()

export function AppLayout() {
  const { pathname, hash } = useLocation();
  const isCabinet = pathname === '/cabinet';
  useEffect(() => {
    if (!hash) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, isCabinet]);
  if (isCabinet) return <div className="cabinet-shell"><a href="#main-content" className="skip-link">Перейти к содержимому</a><main id="main-content" tabIndex={-1}><Outlet /></main></div>;
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <header className="app-header">
        <div className="app-container app-header-inner">
          <Link to="/" className="app-brand" aria-label="Дело за малым — главная">
            <BrandLogo />
          </Link>
          <nav className="app-navigation" aria-label="О проекте и возможностях">
            <a href="/#capabilities">Возможности</a>
            <a href="/#selection-guide">Как это работает</a>
            <Link to="/project">О проекте</Link>
            <Link to="/project#documentation">Документация</Link>
          </nav>
          <div className="header-actions"><ThemeToggle /><Button asChild variant="secondary" className="app-header-action"><Link to="/cabinet">Войти в кабинет<ArrowUpRight aria-hidden="true" /></Link></Button></div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="app-container app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <div className="app-container">
          <div className="app-footer-top">
            <Link to="/" className="app-brand"><BrandLogo /></Link>
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
  )
}
