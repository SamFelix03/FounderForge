export const LIST_PRICE_USD = 0.99;
export const SLA_MINUTES = 5;

export function estimateCostUsd(_input: unknown): number {
  return LIST_PRICE_USD * 0.35;
}
