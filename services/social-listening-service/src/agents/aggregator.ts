import type { ProductConfig, SignalScores } from "../types.js";

export function aggregateScores(
  scores: SignalScores,
  product: ProductConfig,
): { pass: boolean; aggregate: number; reason?: string } {
  if (scores.community_risk < product.risk_veto_threshold) {
    return {
      pass: false,
      aggregate: 0,
      reason: `risk_veto_${scores.community_risk.toFixed(2)}`,
    };
  }

  if (scores.need < product.need_veto_threshold) {
    return {
      pass: false,
      aggregate: scores.need,
      reason: `need_veto_${scores.need.toFixed(2)}`,
    };
  }

  if (scores.relevance < 0.35) {
    return {
      pass: false,
      aggregate: scores.relevance,
      reason: `relevance_veto_${scores.relevance.toFixed(2)}`,
    };
  }

  const w = product.scoring_weights;
  const aggregate =
    scores.relevance * w.relevance +
    scores.need * w.need +
    scores.community_risk * w.community_risk +
    scores.competitor * w.competitor;

  if (aggregate < 0.42) {
    return { pass: false, aggregate, reason: "aggregate_below_0.42" };
  }
  return { pass: true, aggregate };
}
