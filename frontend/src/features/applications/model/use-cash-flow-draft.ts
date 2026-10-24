import { useEffect, useMemo } from "react";
import { readSaved, useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { draftFromPlan, type PlanDraft } from "./overdraft-plan";

export function mergeCashFlowDraft(current: PlanDraft, previous: unknown): PlanDraft {
  if (!previous || typeof previous !== "object" || !("base" in previous) || !("draft" in previous)) return current;
  const {base, draft} = previous as {base:PlanDraft;draft:PlanDraft};
  if (!base || !draft || !Array.isArray(base.rows) || !Array.isArray(draft.rows)) return current;
  const result = {...current};
  for (const key of ["start","end","reserve","debtConfirmed","automaticPeriod"] as const) {
    if (current[key] === base[key]) Object.assign(result,{[key]:draft[key]});
  }
  result.rows = current.rows.flatMap(row => {
    const old = base.rows.find(item=>item.id===row.id), saved = draft.rows.find(item=>item.id===row.id);
    if (!old) return [row];
    if (!saved && JSON.stringify(old)===JSON.stringify(row)) return [];
    return [{...row,...Object.fromEntries(Object.entries(saved||{}).filter(([key])=>row[key as keyof typeof row]===old[key as keyof typeof row]))}];
  });
  result.rows.push(...draft.rows.filter(row=>!current.rows.some(item=>item.id===row.id)&&!base.rows.some(item=>item.id===row.id)&&(row.amount || !current.rows.length)));
  return result;
}

export function useCashFlowDraft(view: ApplicationView, seedRows = false) {
  const initial = useMemo(()=>draftFromPlan(view.application.product_details),[view.application.product_details]);
  const periodModeKey = `delo-plan-period-mode:${view.application.application_id}`;
  const bankCash =
    view.client_data.bank_financials?.cash_balance ??
    view.application.financials.cash_balance;
  const snapshotKey = `delo-plan-source:${view.application.application_id}`;
  const merged = mergeCashFlowDraft(initial, readSaved(snapshotKey, null));
  const [draft, setDraft] = useSavedDraft<PlanDraft>(
    `delo-plan:${view.application.application_id}:${view.application.application_version}`,
    {
      ...merged,
      automaticPeriod: readSaved(periodModeKey, merged.automaticPeriod),
      rows: merged.rows.length || !seedRows ? merged.rows : [
        { id: crypto.randomUUID(), date: initial.start, direction: "outflow" as const, amount: "", loanId: "" },
        { id: crypto.randomUUID(), date: initial.end, direction: "inflow" as const, amount: "", loanId: "" },
      ],
      openingCash: bankCash || "0.00",
    },
  );
  useEffect(()=>{ try { localStorage.setItem(snapshotKey,JSON.stringify({base:initial,draft})); } catch { /* Optional persistence. */ } },[snapshotKey,initial,draft]);
  useEffect(() => {
    try {
      localStorage.setItem(periodModeKey, JSON.stringify(draft.automaticPeriod));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [periodModeKey, draft.automaticPeriod]);
  return { draft, setDraft, bankCash };
}
