export const LIST_PRICE_USD = 1.49;
export const SLA_MINUTES = 30;

export function estimateCostUsd(_input: unknown): number {
  return LIST_PRICE_USD * 0.35;
}
