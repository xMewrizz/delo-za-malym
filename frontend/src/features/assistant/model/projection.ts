import type { ApplicationView } from "@/features/applications";
import type { ChatView, Proposal } from "../api/chat";

export function pendingProposal(view?: ChatView): Proposal | undefined {
  return (
    view?.chat.messages
      .toReversed()
      .find((message) => message.proposal?.status === "pending")?.proposal ??
    undefined
  );
}

export function projectApplication(
  record: ApplicationView,
  proposal?: Proposal,
): ApplicationView {
  const projected = structuredClone(record);
  for (const [path, value] of Object.entries(proposal?.changes || {})) {
    const [section, field, extra] = path.split(".");
    if (
      !extra &&
      field &&
      ["need", "financials", "product_details"].includes(section) &&
      !["__proto__", "constructor", "prototype"].includes(field)
    ) {
      const target = projected.application[section];
      if (typeof target === "object" && target !== null)
        Object.assign(target, { [field]: structuredClone(value) });
      else if (section === "product_details")
        projected.application.product_details = {
          [field]: structuredClone(value),
        };
    }
  }
  const need = projected.application.need;
  if (need.preferred_product === "investment_loan" || need.purpose === "investment") {
    const amount = Math.round(Number(need.project_cost) * 100) - Math.round(Number(need.own_funds) * 100);
    need.requested_amount = need.project_cost && need.own_funds != null && Number.isSafeInteger(amount) && amount > 0 ? (amount / 100).toFixed(2) : null;
  }
  return projected;
}
