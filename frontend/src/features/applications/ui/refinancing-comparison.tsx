import { z } from "zod";
import { formatMoney } from "@/shared/lib/format";
import type { Offer } from "../api/applications";

const comparisonSchema = z.object({
  payoff_amount: z.string(), current_monthly_payment: z.string(), current_total_repayment: z.string(),
  current_remaining_cost: z.string(),
  loans: z.array(z.object({ loan_id: z.string(), schedule: z.array(z.object({ date: z.string(), total_payment: z.string() })) })),
});

export function RefinancingBaseline({ value }: { value: unknown }) {
  const parsed = comparisonSchema.safeParse(value);
  if (!parsed.success) return null;
  const data = parsed.data;
  const byDate = new Map<string, number>();
  for (const loan of data.loans) for (const row of loan.schedule) byDate.set(row.date, (byDate.get(row.date) || 0) + Number(row.total_payment));
  return <section className="rounded-2xl border border-primary/20 bg-primary/5 p-5" aria-label="Текущие кредиты для сравнения">
    <h3 className="font-bold">Если оставить выбранные кредиты</h3>
    <dl className="my-4 grid gap-4 text-sm sm:grid-cols-3">
      <div><dt>Остаток основного долга</dt><dd className="font-bold">{formatMoney(data.payoff_amount)}</dd></div>
      <div><dt>Платежи сейчас</dt><dd className="font-bold">{formatMoney(data.current_monthly_payment)} / мес.</dd></div>
      <div><dt>Все оставшиеся выплаты</dt><dd className="font-bold">{formatMoney(data.current_total_repayment)}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">Стоимость сверх основного долга — {formatMoney(data.current_remaining_cost)}. Сравниваем только будущие выплаты по выбранным кредитам; уже уплаченные проценты не учитываем. В демонстрационных условиях комиссия за досрочное погашение — 0 ₽.</p>
    <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Текущий график выбранных кредитов</summary><ol className="mt-3 max-h-64 space-y-2 overflow-y-auto" aria-label="Текущий график выбранных кредитов">{[...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => <li key={date} className="flex justify-between gap-3 text-sm"><time dateTime={date}>{new Date(date + "T12:00:00").toLocaleDateString("ru-RU")}</time><strong>{formatMoney(String(amount))}</strong></li>)}</ol></details>
  </section>;
}

export function RefinancingEffect({ offer }: { offer: Offer }) {
  const parsed = z.object({ monthly_payment_reduction: z.string(), total_cost_change: z.string() }).safeParse(offer.refinancing);
  if (!parsed.success) return null;
  const monthly = Number(parsed.data.monthly_payment_reduction), total = Number(parsed.data.total_cost_change);
  return <div className="mt-3 space-y-2 rounded-xl bg-secondary p-3 text-sm" aria-label="Разница с текущими кредитами">
    <p>Платёж {monthly >= 0 ? "ниже" : "выше"} на <strong>{formatMoney(String(Math.abs(monthly)))}</strong> в месяц.</p>
    <p>Оставшиеся выплаты {total <= 0 ? "меньше" : "больше"} на <strong>{formatMoney(String(Math.abs(total)))}</strong>.</p>
    {monthly > 0 && total > 0 && <p className="font-semibold">Платёж меньше, но общая стоимость выше.</p>}
    {monthly <= 0 && total >= 0 && <p className="font-semibold">Не снижает ни платёж, ни общую стоимость.</p>}
    {offer.schedule && <details><summary className="cursor-pointer font-semibold">Новый график платежей</summary><ol className="mt-3 max-h-64 space-y-2 overflow-y-auto" aria-label="Новый график рефинансирования">{offer.schedule.map((row, index) => <li key={index} className="flex justify-between gap-3 text-xs"><span>{typeof row.date === "string" ? new Date(row.date + "T12:00:00").toLocaleDateString("ru-RU") : ""}</span><strong>{typeof row.total_payment === "string" ? formatMoney(row.total_payment) : ""}</strong></li>)}</ol></details>}
  </div>;
}
