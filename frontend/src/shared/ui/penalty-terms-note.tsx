import { penaltyRateLabel, penaltySourceLabel, penaltyTermsSchema } from "@/shared/lib/penalty-terms";
import { Disclosure } from "./disclosure";
export function PenaltyTermsNote({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const parsed = penaltyTermsSchema.safeParse(value);
  if (!parsed.success) return null;
  const terms = parsed.data;
  return <Disclosure className={compact ? "penalty-terms penalty-terms-compact" : "penalty-terms mt-4"} title={`${compact ? "При просрочке" : "Пени"}: ${penaltyRateLabel(terms.daily_rate_percent)}`} description={compact ? undefined : penaltySourceLabel(terms.source)}>{compact && <p className="text-xs text-muted-foreground">{penaltySourceLabel(terms.source)}</p>}<p className="text-xs leading-relaxed text-muted-foreground">От суммы просроченного платежа, со следующего дня после срока оплаты. Календарные дни, без капитализации. В обычные платежи без просрочки не входят.</p></Disclosure>;
}
