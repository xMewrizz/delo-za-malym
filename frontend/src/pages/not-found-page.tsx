import { Link } from 'react-router'

export function NotFoundPage() {
  return <div className="space-y-4"><h1 className="text-3xl font-semibold">Страница не найдена</h1><Link to="/" className="text-primary underline underline-offset-4">Вернуться к продуктам</Link></div>
}
