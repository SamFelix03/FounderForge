export const LIST_PRICE_USD = 4.99;
export const SLA_MINUTES = 30;

export function estimateCostUsd(_input: unknown): number {
  return LIST_PRICE_USD * 0.35;
}
