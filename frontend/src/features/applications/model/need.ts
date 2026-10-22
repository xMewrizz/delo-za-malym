import type { ApplicationView } from "../api/applications";

export type NeedDraft = {
  purpose: string;
  preferredProduct: string;
  requestedAmount: string;
  termMonths: string;
  financingPattern: string;
  minimumAmount: string;
  ownFunds: string;
  neededBy: string;
  recurring: string;
};

export function mergeNeedDraft(
  current: NeedDraft,
  previous: unknown,
): NeedDraft {
  const result = { ...current };
  if (
    !previous ||
    typeof previous !== "object" ||
    !("base" in previous) ||
    !("draft" in previous)
  )
    return result;
  const { base, draft } = previous;
  if (!base || typeof base !== "object" || !draft || typeof draft !== "object")
    return result;
  for (const key of Object.keys(result) as (keyof NeedDraft)[]) {
    const saved = (draft as Record<string, unknown>)[key];
    if (
      typeof saved === "string" &&
      current[key] === (base as Record<string, unknown>)[key]
    )
      result[key] = saved;
  }
  return result;
}

export function draftFromApplication(view: ApplicationView): NeedDraft {
  const need = view.application.need;
  return {
    purpose: need.purpose || "",
    preferredProduct: need.preferred_product || "",
    requestedAmount: need.requested_amount || "",
    termMonths: need.term_months?.toString() || "",
    financingPattern: need.financing_pattern || "",
    minimumAmount: need.minimum_acceptable_amount || "",
    ownFunds: need.own_funds || "",
    neededBy: need.needed_by || "",
    recurring: need.recurring == null ? "" : String(need.recurring),
  };
}

export function normalizeMoneyInput(
  value: string,
  allowZero = false,
): string | null {
  const cleaned = value.trim().replaceAll(" ", "").replace(",", ".");
  if (!cleaned) return null;
  if (
    !/^\d{1,12}(\.\d{1,2})?$/.test(cleaned) ||
    (!allowZero && !/[1-9]/.test(cleaned))
  ) {
    throw new Error(
      "Укажите положительную сумму в рублях, не более двух знаков после запятой.",
    );
  }
  const [rubles, kopecks = ""] = cleaned.split(".");
  return rubles.replace(/^0+(?=\d)/, "") + "." + kopecks.padEnd(2, "0");
}

export function buildNeedChanges(draft: NeedDraft): Record<string, unknown> {
  const term = draft.termMonths.trim();
  if (term && (!/^\d+$/.test(term) || Number(term) < 1 || Number(term) > 120)) {
    throw new Error("Срок должен быть целым числом от 1 до 120 месяцев.");
  }
  return {
    "need.purpose": draft.purpose || null,
    "need.preferred_product": draft.preferredProduct || null,
    "need.requested_amount": normalizeMoneyInput(draft.requestedAmount),
    "need.term_months": term ? Number(term) : null,
    "need.financing_pattern": draft.financingPattern || null,
    "need.minimum_acceptable_amount": normalizeMoneyInput(draft.minimumAmount),
    "need.own_funds": normalizeMoneyInput(draft.ownFunds, true),
    "need.needed_by": draft.neededBy || null,
    "need.recurring":
      draft.recurring === "" ? null : draft.recurring === "true",
  };
}
