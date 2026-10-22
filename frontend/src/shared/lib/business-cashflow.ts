type Month = { month: string; operating_inflow?: string | null; operating_outflow?: string | null; taxes?: string | null };
export type CashflowMetric = "inflow" | "net";
export function monthlyValue(row: Month | undefined, metric: CashflowMetric): number | null {
  if (!row) return null;
  const fields = metric === "inflow" ? [row.operating_inflow] : [row.operating_inflow, row.operating_outflow, row.taxes];
  if (fields.some(value => value == null || value.trim() === "" || !Number.isFinite(Number(value)))) return null;
  return metric === "inflow" ? Number(row.operating_inflow) : Number(row.operating_inflow) - Number(row.operating_outflow) - Number(row.taxes);
}
