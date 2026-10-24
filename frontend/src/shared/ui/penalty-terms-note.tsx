import { penaltyRateLabel, penaltySourceLabel, penaltyTermsSchema } from "@/shared/lib/penalty-terms";
import { Disclosure } from "./disclosure";
export function PenaltyTermsNote({ value }: { value: unknown }) {
  const parsed = penaltyTermsSchema.safeParse(value);
  if (!parsed.success) return null;
  const terms = parsed.data;
  return <Disclosure className="penalty-terms mt-4" title={`Пени: ${penaltyRateLabel(terms.daily_rate_percent)}`} description={penaltySourceLabel(terms.source)}><p className="text-xs leading-relaxed text-muted-foreground">От суммы просроченного платежа, со следующего дня после срока оплаты. Календарные дни, без капитализации. В обычные платежи без просрочки не входят.</p></Disclosure>;
}
