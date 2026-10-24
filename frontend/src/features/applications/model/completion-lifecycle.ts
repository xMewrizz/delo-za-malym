/** Issuance is historical; servicing and refinancing describe the current product. */
export function completionLifecycle(completion: Record<string, unknown> | null | undefined) {
  const replacementId = typeof completion?.refinanced_by === "string" && completion.refinanced_by.trim()
    ? completion.refinanced_by : undefined;
  const servicing = completion?.servicing;
  const repaid = servicing && typeof servicing === "object" && "closed_at" in servicing
    && typeof servicing.closed_at === "string" && Boolean(servicing.closed_at);
  return { replacementId, closed: Boolean(replacementId || repaid) };
}
