import { makeDecision, DECISION_STATES, DISPATCH_THRESHOLD, VERIFY_THRESHOLD } from "../../shared/decisionLayer";

describe("Decision Layer — Thresholds", () => {
  test("High confidence + high urgency → DISPATCH", () => {
    expect(makeDecision({ compositeConfidence: 0.92, urgency: "HIGH", conflicts: 0 }).state).toBe(DECISION_STATES.DISPATCH);
  });
  test("High urgency + conflicting signals → VERIFY", () => {
    expect(makeDecision({ compositeConfidence: 0.75, urgency: "HIGH", conflicts: 2 }).state).toBe(DECISION_STATES.VERIFY);
  });
  test("Low urgency + low confidence → HOLD", () => {
    expect(makeDecision({ compositeConfidence: 0.2, urgency: "LOW", conflicts: 0 }).state).toBe(DECISION_STATES.HOLD);
  });
  test("Suspected misinformation → HOLD regardless of urgency", () => {
    expect(makeDecision({ compositeConfidence: 0.85, urgency: "HIGH", conflicts: 5, botScore: 0.95 }).state).toBe(DECISION_STATES.HOLD);
  });
  test("DISPATCH threshold constant is >= 0.8", () => { expect(DISPATCH_THRESHOLD).toBeGreaterThanOrEqual(0.8); });
  test("VERIFY threshold between HOLD and DISPATCH", () => {
    expect(VERIFY_THRESHOLD).toBeGreaterThan(0);
    expect(VERIFY_THRESHOLD).toBeLessThan(DISPATCH_THRESHOLD);
  });
  test("Decision includes explainability audit fields", () => {
    const r = makeDecision({ compositeConfidence: 0.85, urgency: "HIGH", conflicts: 0 });
    expect(r).toHaveProperty("reasoningFactors");
    expect(r).toHaveProperty("confidenceBreakdown");
  });
  test("Borderline confidence at DISPATCH_THRESHOLD routes to DISPATCH", () => {
    expect(makeDecision({ compositeConfidence: DISPATCH_THRESHOLD, urgency: "HIGH", conflicts: 0 }).state).toBe(DECISION_STATES.DISPATCH);
  });
  test("Just below DISPATCH_THRESHOLD routes to VERIFY", () => {
    expect(makeDecision({ compositeConfidence: DISPATCH_THRESHOLD - 0.01, urgency: "HIGH", conflicts: 0 }).state).toBe(DECISION_STATES.VERIFY);
  });
  test("State transition HOLD → VERIFY on new corroboration", () => {
    expect(makeDecision({ compositeConfidence: 0.2, urgency: "LOW", conflicts: 0 }).state).toBe(DECISION_STATES.HOLD);
    expect(makeDecision({ compositeConfidence: 0.65, urgency: "MEDIUM", conflicts: 0 }).state).toBe(DECISION_STATES.VERIFY);
  });
});
