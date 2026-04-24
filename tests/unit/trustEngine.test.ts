import { calculateTrust, applyConflictPenalty, applyTemporalDecay, resolveConflict, SOURCE_WEIGHTS, detectSemanticContradiction, isolateAdversarialCluster } from "../../shared/trustEngine";

describe("Source Weighting", () => {
  test("Verified source scores highest base trust", () => {
    const trust = calculateTrust({ sourceType: "verified", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(trust).toBeGreaterThanOrEqual(SOURCE_WEIGHTS.verified);
  });
  test("NGO source scores below Verified", () => {
    const ngo = calculateTrust({ sourceType: "ngo", corroborations: 0, ageMs: 0, conflicts: 0 });
    const verified = calculateTrust({ sourceType: "verified", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(ngo).toBeLessThan(verified);
  });
  test("Citizen source scores below NGO", () => {
    const citizen = calculateTrust({ sourceType: "citizen", corroborations: 0, ageMs: 0, conflicts: 0 });
    const ngo = calculateTrust({ sourceType: "ngo", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(citizen).toBeLessThan(ngo);
  });
  test("Anonymous source scores lowest", () => {
    const anon = calculateTrust({ sourceType: "anonymous", corroborations: 0, ageMs: 0, conflicts: 0 });
    const citizen = calculateTrust({ sourceType: "citizen", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(anon).toBeLessThan(citizen);
  });
  test("Unknown source type returns minimum trust, not throws", () => {
    const result = calculateTrust({ sourceType: "unknown_type_xyz", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe("Corroboration Density", () => {
  test("More corroborations increase trust score", () => {
    const low = calculateTrust({ sourceType: "citizen", corroborations: 1, ageMs: 0, conflicts: 0 });
    const high = calculateTrust({ sourceType: "citizen", corroborations: 10, ageMs: 0, conflicts: 0 });
    expect(high).toBeGreaterThan(low);
  });
  test("Trust is capped at 1.0 regardless of corroboration count", () => {
    const trust = calculateTrust({ sourceType: "verified", corroborations: 9999, ageMs: 0, conflicts: 0 });
    expect(trust).toBeLessThanOrEqual(1.0);
  });
  test("Zero corroborations does not produce negative trust", () => {
    const trust = calculateTrust({ sourceType: "anonymous", corroborations: 0, ageMs: 0, conflicts: 0 });
    expect(trust).toBeGreaterThanOrEqual(0);
  });
});

describe("Temporal Decay", () => {
  test("Fresh signal (0ms) has no decay applied", () => {
    expect(applyTemporalDecay(0.8, 0)).toBeCloseTo(0.8, 2);
  });
  test("Signal older than 12 hours is significantly decayed", () => {
    const decayed = applyTemporalDecay(0.9, 13 * 60 * 60 * 1000);
    expect(decayed).toBeLessThan(0.5);
  });
  test("Decay is monotonically increasing with age", () => {
    const t1 = applyTemporalDecay(1.0, 1000 * 60 * 60);
    const t2 = applyTemporalDecay(1.0, 1000 * 60 * 60 * 6);
    const t3 = applyTemporalDecay(1.0, 1000 * 60 * 60 * 12);
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t3);
  });
  test("Decay never goes below 0", () => {
    expect(applyTemporalDecay(0.5, 100 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(0);
  });
  test("Corroborated signal resists decay", () => {
    const MS_10H = 10 * 60 * 60 * 1000;
    const decayed = applyTemporalDecay(0.8, MS_10H);
    const withCorr = calculateTrust({ sourceType: "citizen", corroborations: 5, ageMs: MS_10H, conflicts: 0 });
    expect(withCorr).toBeGreaterThan(decayed);
  });
});

describe("Conflict Penalty", () => {
  test("Single conflict reduces trust", () => {
    const base = calculateTrust({ sourceType: "ngo", corroborations: 3, ageMs: 0, conflicts: 0 });
    const conflicted = calculateTrust({ sourceType: "ngo", corroborations: 3, ageMs: 0, conflicts: 1 });
    expect(conflicted).toBeLessThan(base);
  });
  test("Multiple high-trust source conflicts flag uncertainty (trust < 0.5)", () => {
    expect(applyConflictPenalty(0.9, 3)).toBeLessThan(0.5);
  });
  test("Conflict between two verified sources drops both to VERIFY zone", () => {
    const reportA = { id: "A", sourceType: "verified", claim: "fire_active", zone: "Z1", trust: 0.9 };
    const reportB = { id: "B", sourceType: "verified", claim: "fire_denied", zone: "Z1", trust: 0.88 };
    expect(resolveConflict(reportA, reportB).decision).toBe("VERIFY");
  });
  test("Conflict penalty output is never negative", () => {
    expect(applyConflictPenalty(0.3, 99)).toBeGreaterThanOrEqual(0);
  });
});

describe("Semantic Contradiction Detection", () => {
  test("'fire active' and 'fire extinguished' are contradictions", () => {
    expect(detectSemanticContradiction("fire active in sector 4", "fire extinguished in sector 4")).toBe(true);
  });
  test("Two confirming reports are NOT contradictions", () => {
    expect(detectSemanticContradiction("flooding on main street", "flooding on main street confirmed")).toBe(false);
  });
  test("'no casualties' vs 'multiple casualties' is a contradiction", () => {
    expect(detectSemanticContradiction("no casualties reported", "multiple casualties confirmed")).toBe(true);
  });
  test("Empty strings do not throw — return false", () => {
    expect(() => detectSemanticContradiction("", "")).not.toThrow();
    expect(detectSemanticContradiction("", "")).toBe(false);
  });
  test("Null inputs are handled gracefully", () => {
    expect(() => detectSemanticContradiction(null, null)).not.toThrow();
  });
});

describe("Adversarial Cluster Isolation", () => {
  const legit = [
    { id: "r1", sourceType: "ngo", claim: "fire_active", zone: "Z1", submittedAt: Date.now() - 5000 },
    { id: "r2", sourceType: "citizen", claim: "fire_active", zone: "Z1", submittedAt: Date.now() - 4000 },
    { id: "r3", sourceType: "verified", claim: "fire_active", zone: "Z1", submittedAt: Date.now() - 3000 },
  ];
  const botBurst = Array.from({ length: 30 }, (_, i) => ({
    id: `bot_${i}`, sourceType: "anonymous", claim: "fire_denied", zone: "Z1", submittedAt: Date.now() - (1000 * i),
  }));
  test("Bot burst from anonymous sources is flagged as adversarial cluster", () => {
    const result = isolateAdversarialCluster([...legit, ...botBurst]);
    expect(result.adversarialIds.length).toBeGreaterThan(0);
    expect(result.adversarialIds.every(id => id.startsWith("bot_"))).toBe(true);
  });
  test("Legitimate reports are NOT included in adversarial cluster", () => {
    const result = isolateAdversarialCluster([...legit, ...botBurst]);
    const legitIds = legit.map(r => r.id);
    expect(result.adversarialIds.filter(id => legitIds.includes(id))).toHaveLength(0);
  });
  test("Small normal traffic does not trigger false adversarial flag", () => {
    expect(isolateAdversarialCluster(legit).adversarialIds).toHaveLength(0);
  });
  test("Empty report list returns empty adversarial cluster", () => {
    expect(() => isolateAdversarialCluster([])).not.toThrow();
    expect(isolateAdversarialCluster([]).adversarialIds).toHaveLength(0);
  });
});
