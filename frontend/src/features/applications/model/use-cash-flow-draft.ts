import { useSavedDraft } from "@/shared/lib/saved-draft";
import type { ApplicationView } from "../api/applications";
import { draftFromPlan } from "./overdraft-plan";

export function useCashFlowDraft(view: ApplicationView, seedRows = false) {
  const initial = draftFromPlan(view.application.product_details);
  const bankCash =
    view.client_data.bank_financials?.cash_balance ??
    view.application.financials.cash_balance;
  const [draft, setDraft] = useSavedDraft(
    `delo-plan:${view.application.application_id}:${view.application.application_version}`,
    {
      ...initial,
      rows: initial.rows.length || !seedRows ? initial.rows : [
        { id: crypto.randomUUID(), date: initial.start, direction: "outflow" as const, amount: "", loanId: "" },
        { id: crypto.randomUUID(), date: initial.end, direction: "inflow" as const, amount: "", loanId: "" },
      ],
      openingCash: bankCash || "0.00",
    },
  );
  return { draft, setDraft, bankCash };
}
