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
  projectCost?: string;
  graceMonths?: string;
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
    projectCost: need.project_cost || "",
    graceMonths: need.principal_grace_months?.toString() || "0",
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

export class NeedValidationError extends Error {
  field: keyof NeedDraft;
  constructor(field: keyof NeedDraft, message: string) {
    super(message);
    this.field = field;
  }
}

export function buildNeedChanges(draft: NeedDraft): Record<string, unknown> {
  const term = draft.termMonths.trim();
  if (term && (!/^\d+$/.test(term) || Number(term) < 1 || Number(term) > 120)) {
    throw new NeedValidationError("termMonths", "Срок должен быть целым числом от 1 до 120 месяцев.");
  }
  const money = (field: "requestedAmount" | "minimumAmount" | "ownFunds", allowZero = false) => {
    try { return normalizeMoneyInput(draft[field], allowZero); }
    catch (cause) { throw new NeedValidationError(field, (cause as Error).message); }
  };
  const investment = draft.preferredProduct === "investment_loan" || draft.purpose === "investment";
  let projectCost: string | null = null;
  if (investment) {
    try { projectCost = normalizeMoneyInput(draft.projectCost || ""); }
    catch (cause) { throw new NeedValidationError("projectCost", (cause as Error).message); }
    if (!projectCost) throw new NeedValidationError("projectCost", "Укажите стоимость проекта.");
    if (!draft.ownFunds.trim()) throw new NeedValidationError("ownFunds", "Укажите собственный взнос.");
    if (Number(money("ownFunds", true)) >= Number(projectCost)) throw new NeedValidationError("ownFunds", "Собственный взнос должен быть меньше стоимости проекта.");
  }
  return {
    ...(investment ? { "need.project_cost": projectCost, "need.principal_grace_months": Number(draft.graceMonths || "0"), "need.preferred_product": "investment_loan" } : {}),
    "need.purpose": draft.purpose || null,
    "need.preferred_product": investment ? "investment_loan" : draft.preferredProduct || null,
    "need.requested_amount": investment ? null : money("requestedAmount"),
    "need.term_months": term ? Number(term) : null,
    "need.financing_pattern": draft.financingPattern || null,
    "need.minimum_acceptable_amount": investment ? null : money("minimumAmount"),
    "need.own_funds": money("ownFunds", true),
    "need.needed_by": draft.neededBy || null,
    "need.recurring":
      draft.recurring === "" ? null : draft.recurring === "true",
  };
}
