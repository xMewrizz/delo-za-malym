import { z } from "zod";
import { formatMoneyPrecise as formatMoney } from "@/shared/lib/format";
import type { Offer } from "../api/applications";
import { Disclosure } from "@/shared/ui/disclosure";

const projectSchema = z.object({ project_cost: z.string(), own_funds: z.string(), principal_grace_months: z.number(), grace_monthly_payment: z.string() });
const scheduleSchema = z.array(z.object({ date: z.string(), principal_payment: z.string(), interest_payment: z.string(), total_payment: z.string() }));

export function InvestmentTerms({ offer }: { offer: Offer }) {
  const project = projectSchema.safeParse(offer.investment);
  const schedule = scheduleSchema.safeParse(offer.schedule);
  if (!project.success) return null;
  const data = project.data;
  return <section className="investment-terms my-4 space-y-3 rounded-xl bg-secondary p-4 text-sm" aria-label="Финансирование проекта">
    <dl className="grid grid-cols-2 gap-3">
      <div><dt className="text-muted-foreground">Стоимость проекта</dt><dd className="font-semibold">{formatMoney(data.project_cost)}</dd></div>
      <div><dt className="text-muted-foreground">Ваш взнос</dt><dd className="font-semibold">{formatMoney(data.own_funds)}</dd></div>
    </dl>
    {data.principal_grace_months > 0 ? <>
      <div className="investment-payment-phases"><div><span>Первые {data.principal_grace_months} мес.</span><strong>{formatMoney(data.grace_monthly_payment)} / мес.</strong><small>только проценты</small></div><div><span>С {data.principal_grace_months + 1}-го месяца</span><strong>до {formatMoney(offer.monthly_payment || "0")} / мес.</strong><small>Основной долг и проценты</small></div></div>
      <p className="investment-grace-note">Отсрочка входит в срок кредита и увеличивает переплату.</p>
    </> : <p className="investment-grace-note">Погашение долга и процентов начинается с первого месяца.</p>}
    {schedule.success && <Disclosure className="investment-schedule" title="График платежей"><div className="max-h-64 overflow-auto" tabIndex={0} role="region" aria-label="Платежи по инвестиционному кредиту"><table className="w-full text-xs"><caption className="sr-only">Расчётный график от даты оформления</caption><thead><tr><th className="p-2 text-left">Дата</th><th className="p-2 text-right">Долг</th><th className="p-2 text-right">Проценты</th><th className="p-2 text-right">Всего</th></tr></thead><tbody>{schedule.data.map(row => <tr key={row.date} className="border-t border-border"><td className="p-2">{new Date(row.date + "T00:00:00").toLocaleDateString("ru-RU")}</td><td className="p-2 text-right">{formatMoney(row.principal_payment)}</td><td className="p-2 text-right">{formatMoney(row.interest_payment)}</td><td className="p-2 text-right">{formatMoney(row.total_payment)}</td></tr>)}</tbody></table></div></Disclosure>}
  </section>;
}
