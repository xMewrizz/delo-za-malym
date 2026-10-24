import { ArrowUpRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
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
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = header.current;
    if (isCabinet || !element) return;
    element.dataset.hidden = 'false';
    let previous = window.scrollY, origin = previous, direction = 0, frame = 0;
    function updateHeader() {
      frame = 0;
      const current = Math.max(0, Math.min(window.scrollY, document.documentElement.scrollHeight - window.innerHeight));
      const delta = current - previous;
      if (current <= 20) {
        element!.dataset.hidden = 'false';
        origin = current;
        direction = 0;
      } else if (delta !== 0) {
        const nextDirection = Math.sign(delta);
        if (nextDirection !== direction) { origin = previous; direction = nextDirection; }
        if (Math.abs(current - origin) >= 10) element!.dataset.hidden = String(direction > 0);
      }
      previous = current;
    }
    function onScroll() { if (!frame) frame = requestAnimationFrame(updateHeader); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [pathname, isCabinet]);
  useEffect(() => {
    if (!hash) { window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash, isCabinet]);
  if (isCabinet) return <div className="cabinet-shell"><a href="#main-content" className="skip-link">Перейти к содержимому</a><main id="main-content" tabIndex={-1}><Outlet /></main></div>;
  return (
    <div className={["/", "/project", "/documentation"].includes(pathname) ? "app-shell landing-shell" : "app-shell"}>
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <header ref={header} className="app-header">
        <div className="app-container app-header-inner">
          <Link to="/" className="app-brand" aria-label="Дело за малым — главная">
            <BrandLogo />
          </Link>
          <nav className="app-navigation" aria-label="О проекте и возможностях">
            <Link to="/project" aria-current={pathname === "/project" ? "page" : undefined}>О проекте</Link>
            <Link to="/documentation" aria-current={pathname === "/documentation" ? "page" : undefined}>Документация</Link>
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
