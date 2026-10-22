import type { ApplicationView } from "../api/applications";

export function refinancingIds(view: ApplicationView): string[] {
  const selection = view.application.product_details?.refinancing;
  return selection && typeof selection === "object" && "loan_ids" in selection && Array.isArray(selection.loan_ids)
    ? selection.loan_ids.filter((id): id is string => typeof id === "string") : [];
}
