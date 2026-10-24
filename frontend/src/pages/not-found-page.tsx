import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export function NotFoundPage() {
  return <section className="not-found-page"><p className="section-kicker">404 / Страница не найдена</p><h1 className="text-3xl font-semibold tracking-tight">Здесь пока ничего нет.</h1><p>Перейдите на главную, чтобы посмотреть возможности сервиса и открыть кабинет.</p><Button asChild variant="outline"><Link to="/"><ArrowLeft aria-hidden="true" />На главную</Link></Button></section>
}
