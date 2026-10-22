import { useEffect } from "react";
import { readSaved, useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { draftFromPlan, type PlanDraft } from "./overdraft-plan";

export function useCashFlowDraft(view: ApplicationView, seedRows = false) {
  const initial = draftFromPlan(view.application.product_details);
  const periodModeKey = `delo-plan-period-mode:${view.application.application_id}`;
  const bankCash =
    view.client_data.bank_financials?.cash_balance ??
    view.application.financials.cash_balance;
  const [draft, setDraft] = useSavedDraft<PlanDraft>(
    `delo-plan:${view.application.application_id}:${view.application.application_version}`,
    {
      ...initial,
      automaticPeriod: readSaved(periodModeKey, initial.automaticPeriod),
      rows: initial.rows.length || !seedRows ? initial.rows : [
        { id: crypto.randomUUID(), date: initial.start, direction: "outflow" as const, amount: "", loanId: "" },
        { id: crypto.randomUUID(), date: initial.end, direction: "inflow" as const, amount: "", loanId: "" },
      ],
      openingCash: bankCash || "0.00",
    },
  );
  useEffect(() => {
    try {
      localStorage.setItem(periodModeKey, JSON.stringify(draft.automaticPeriod));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [periodModeKey, draft.automaticPeriod]);
  return { draft, setDraft, bankCash };
}
