export const LIST_PRICE_USD = 4.99;
export const SLA_MINUTES = 20;

/** Rough COGS estimate used for margin dashboards (not on-chain). */
export function estimateCostUsd(input: { product_name: string }): number {
  const base = 1.25;
  const nameFactor = Math.min(input.product_name.length / 100, 0.5);
  return Number((base + nameFactor).toFixed(4));
}
