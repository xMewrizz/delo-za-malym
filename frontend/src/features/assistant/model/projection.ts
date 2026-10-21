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
  return projected;
}
