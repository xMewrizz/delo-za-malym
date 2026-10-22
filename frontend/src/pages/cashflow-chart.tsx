import { useState, type CSSProperties } from "react";
import { ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
import { Link } from "react-router";
import type { Profile } from "@/features/applications";
import { formatMoney } from "@/shared/lib/format";
import { monthlyValue, type CashflowMetric } from "@/shared/lib/business-cashflow";

const monthName = (month: string, long = false) => new Date(month + "-15T12:00:00").toLocaleDateString("ru-RU", { month: long ? "long" : "short", ...(long ? { year: "numeric" } : {}) });

export function CashflowChart({ profile, loading, error }: { profile?: Profile; loading: boolean; error?: unknown }) {
  const [metric, setMetric] = useState<CashflowMetric>("inflow");
  const [range, setRange] = useState(6);
  const [selected, setSelected] = useState<string | null>(null);
  const months = [...(profile?.financials.monthly || [])].sort((a, b) => a.month.localeCompare(b.month)).slice(-range);
  const active = months.find(row => row.month === selected) || months.at(-1);
  const values = months.map(row => monthlyValue(row, metric));
  const max = Math.max(1, ...values.map(value => Math.abs(value || 0)));
  const negative = values.some(value => value != null && value < 0);
  const activeValue = monthlyValue(active, metric);
  return <section className="cashflow-card dashboard-card" aria-labelledby="cashflow-title">
    <div className="dashboard-card-heading"><div><span className="dashboard-kicker">БАНКОВСКАЯ ИСТОРИЯ</span><h2 id="cashflow-title">Движение денег</h2></div><div className="chart-range" role="group" aria-label="Период графика">{[3, 6].map(count => <button key={count} type="button" aria-pressed={range === count} onClick={() => setRange(count)}>{count} мес.</button>)}</div></div>
    <div className="chart-metric-tabs" role="group" aria-label="Показатель графика"><button type="button" aria-pressed={metric === "inflow"} onClick={() => setMetric("inflow")}>Поступления</button><button type="button" aria-pressed={metric === "net"} onClick={() => setMetric("net")}>Денежный поток</button></div>
    {loading ? <div className="chart-empty" role="status">Загружаем историю…</div> : error ? <div className="chart-empty" role="alert">История временно недоступна</div> : !months.length ? <div className="chart-empty"><ChartNoAxesCombined /><p>Здесь появится история движения денег</p><Link to="/cabinet?mode=business">Проверить данные бизнеса<ArrowUpRight size={15} /></Link></div> : <>
      <div className="chart-current" aria-live="polite"><strong>{activeValue == null ? "Нет данных" : formatMoney(String(activeValue))}</strong><span>{active ? monthName(active.month, true) : ""}</span></div>
      <div className="cashflow-plot" data-negative={negative} role="group" aria-label={metric === "inflow" ? "Поступления по месяцам" : "Денежный поток по месяцам"}>
        {months.map((row, index) => { const value = values[index]; return <button type="button" key={row.month} className="cashflow-column" data-missing={value == null} data-below-zero={value != null && value < 0} aria-pressed={active?.month === row.month} aria-label={`${monthName(row.month, true)}: ${value == null ? "нет данных" : formatMoney(String(value))}`} onClick={() => setSelected(row.month)} style={{ "--bar-height": value == null ? "0px" : `${Math.max(value === 0 ? 2 : 6, Math.abs(value) / max * (negative ? 60 : 110))}px` } as CSSProperties}><span className="cashflow-bar" /><span className="cashflow-month">{monthName(row.month)}</span>{value == null && <span className="cashflow-missing">—</span>}</button>; })}
      </div>
      <div className="chart-footnote"><span><i />{metric === "inflow" ? "Фактические поступления" : "Поступления − расходы − налоги"}</span><Link to="/cabinet?mode=business">Все данные<ArrowUpRight size={13} /></Link></div>
    </>}
  </section>;
}


