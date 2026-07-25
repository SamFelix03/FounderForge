export const LIST_PRICE_USD = 1.99;
export const SLA_MINUTES = 15;

export function estimateCostUsd(_input: unknown): number {
  return LIST_PRICE_USD * 0.35;
}
