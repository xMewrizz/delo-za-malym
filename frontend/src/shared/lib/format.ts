const rubles = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});
const rublesWithKopecks = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Display only. Monetary values stay decimal strings in API payloads. */
export function formatMoney(value: string): string {
  return rubles.format(Number(value));
}

export function formatMoneyPrecise(value: string): string {
  return rublesWithKopecks.format(Number(value));
}
