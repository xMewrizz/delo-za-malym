import { formatMoney } from "@/shared/lib/format";

export type FlowDay = {
  date: string;
  closing_cash: string;
  cash_without_financing?: string;
};

export function CashFlowChart({ days }: { days: FlowDay[] }) {
  if (!days.length) return null;
  const values = days.flatMap((day) => [
    Number(day.closing_cash),
    Number(day.cash_without_financing ?? day.closing_cash),
  ]);
  if (!values.every(Number.isFinite)) return null;
  const low = Math.min(0, ...values),
    high = Math.max(1, ...values),
    range = high - low;
  const x = (index: number) =>
    64 + (index * 600) / Math.max(1, days.length - 1);
  const y = (value: number) => 160 - ((value - low) * 130) / range;
  const line = (baseline: boolean) =>
    days
      .map(
        (day, index) =>
          `${x(index)},${y(Number(baseline ? (day.cash_without_financing ?? day.closing_cash) : day.closing_cash))}`,
      )
      .join(" ");
  const date = (value: string) =>
    new Date(value + "T12:00:00").toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  return (
    <figure className="cash-flow-chart">
      <figcaption className="text-sm font-bold">
        Остаток денег по датам
      </figcaption>
      <svg
        viewBox="0 0 700 195"
        role="img"
        aria-label={`Остаток денег с финансированием и без него, с ${date(days[0].date)} по ${date(days.at(-1)!.date)}`}
      >
        <line x1="64" x2="664" y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x="0" y="33">
          {formatMoney(String(high))}
        </text>
        <text x="0" y="165">
          {formatMoney(String(low))}
        </text>
        <polyline
          points={line(true)}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <polyline
          points={line(false)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
        />
        <text x="64" y="190">
          {date(days[0].date)}
        </text>
        <text x="664" y="190" textAnchor="end">
          {date(days.at(-1)!.date)}
        </text>
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>● С финансированием</span>
        <span>┄ Без финансирования</span>
      </div>
    </figure>
  );
}
