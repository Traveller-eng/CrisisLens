/**
 * Decision Layer — DISPATCH / VERIFY / HOLD thresholds with explainability.
 */

export const DECISION_STATES = { DISPATCH: "DISPATCH", VERIFY: "VERIFY", HOLD: "HOLD" } as const;
export const DISPATCH_THRESHOLD = 0.8;
export const VERIFY_THRESHOLD = 0.5;

export function makeDecision(input: {
  compositeConfidence: number;
  urgency: string;
  conflicts: number;
  botScore?: number;
}): { state: string; reasoningFactors: string[]; confidenceBreakdown: Record<string, number> } {
  const factors: string[] = [];
  const breakdown: Record<string, number> = {
    rawConfidence: input.compositeConfidence,
    conflictPenalty: input.conflicts * 0.1,
    botPenalty: 0
  };

  if (input.botScore && input.botScore > 0.8) {
    factors.push("High bot probability detected — routing to HOLD");
    breakdown.botPenalty = input.botScore;
    return { state: DECISION_STATES.HOLD, reasoningFactors: factors, confidenceBreakdown: breakdown };
  }

  const effective = input.compositeConfidence - input.conflicts * 0.1;
  breakdown.effectiveConfidence = effective;

  if (effective >= DISPATCH_THRESHOLD && input.urgency !== "LOW") {
    factors.push(`Effective confidence ${effective.toFixed(2)} >= ${DISPATCH_THRESHOLD} with urgency ${input.urgency}`);
    return { state: DECISION_STATES.DISPATCH, reasoningFactors: factors, confidenceBreakdown: breakdown };
  }
  if (effective >= VERIFY_THRESHOLD || input.urgency === "HIGH") {
    factors.push(`Effective confidence ${effective.toFixed(2)} in VERIFY range or urgency HIGH`);
    return { state: DECISION_STATES.VERIFY, reasoningFactors: factors, confidenceBreakdown: breakdown };
  }
  factors.push(`Low confidence ${effective.toFixed(2)} and urgency ${input.urgency} — HOLD`);
  return { state: DECISION_STATES.HOLD, reasoningFactors: factors, confidenceBreakdown: breakdown };
}
