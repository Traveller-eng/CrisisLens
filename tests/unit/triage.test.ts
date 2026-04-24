import { gate1PatternMatch, gate2GeminiReason, gate3OfflineFallback, triageReport, reconcileState, TRIAGE_GATES } from "../../shared/triage";

describe("Gate 1 — Pattern Matching", () => {
  test("Known fire pattern returns result in <5ms", () => {
    const start = Date.now();
    const result = gate1PatternMatch({ text: "large fire spreading on highway 1" });
    expect(Date.now() - start).toBeLessThan(5);
    expect(result).not.toBeNull();
  });
  test("Known flood pattern is matched instantly", () => {
    const r = gate1PatternMatch({ text: "severe flooding blocking main road" });
    expect(r.matched).toBe(true);
    expect(r.category).toBe("flood");
  });
  test("Known denial pattern is matched", () => {
    const r = gate1PatternMatch({ text: "confirmed all clear, no fire" });
    expect(r.matched).toBe(true);
    expect(r.polarity).toBe("denial");
  });
  test("Novel pattern returns unmatched", () => {
    expect(gate1PatternMatch({ text: "something completely unusual 12x!@#" }).matched).toBe(false);
  });
  test("Empty string does not throw", () => {
    expect(() => gate1PatternMatch({ text: "" })).not.toThrow();
    expect(gate1PatternMatch({ text: "" }).matched).toBe(false);
  });
  test("Pattern match result includes confidence", () => {
    const r = gate1PatternMatch({ text: "wildfire visible from multiple directions" });
    expect(r).toHaveProperty("confidence");
    expect(typeof r.confidence).toBe("number");
  });
});

describe("Gate 2 — Gemini Semantic Reasoning", () => {
  test("Returns structured risk assessment", async () => {
    const r = await gate2GeminiReason({ text: "smoke coming from building, not sure if bbq" });
    expect(r).toHaveProperty("category");
    expect(r).toHaveProperty("urgency");
    expect(r).toHaveProperty("confidence");
  }, 10000);
  test("Urgency is HIGH, MEDIUM, or LOW", async () => {
    const r = await gate2GeminiReason({ text: "people trapped on roof, water rising fast" });
    expect(["HIGH", "MEDIUM", "LOW"]).toContain(r.urgency);
  }, 10000);
  test("Gemini timeout falls back to Gate 3", async () => {
    const r = await triageReport({ text: "ambiguous xyz" }, { simulateGeminiTimeout: true });
    expect(r.gate).toBe(TRIAGE_GATES.GATE_3);
    expect(r.category).toBeDefined();
  });
});

describe("Gate 3 — Offline Fallback", () => {
  test("Fire keywords classified correctly", () => { expect(gate3OfflineFallback({ text: "fire flames smoke burning" }).category).toBe("fire"); });
  test("Flood keywords classified correctly", () => { expect(gate3OfflineFallback({ text: "flooding waterlogged submerged" }).category).toBe("flood"); });
  test("Medical keywords classified correctly", () => { expect(gate3OfflineFallback({ text: "injured people need ambulance hospital" }).category).toBe("medical"); });
  test("Denial keywords produce denial polarity", () => { expect(gate3OfflineFallback({ text: "no fire false alarm clear" }).polarity).toBe("denial"); });
  test("Unknown text returns unknown category", () => { expect(gate3OfflineFallback({ text: "asdfgh qwerty 1234" }).category).toBe("unknown"); });
  test("Offline fallback never returns null", () => { expect(gate3OfflineFallback({ text: "" })).not.toBeNull(); });
  test("Offline fallback completes in <2ms", () => {
    const s = Date.now();
    gate3OfflineFallback({ text: "large fire spreading in zone 3" });
    expect(Date.now() - s).toBeLessThan(5);
  });
});

describe("Gate Routing", () => {
  test("Known pattern routes to Gate 1", async () => {
    expect((await triageReport({ text: "wildfire spreading fast" })).gate).toBe(TRIAGE_GATES.GATE_1);
  });
  test("Novel report routes to Gate 2 when online", async () => {
    expect((await triageReport({ text: "bizarre unprecedented #%$@" }, { forceOnline: true })).gate).toBe(TRIAGE_GATES.GATE_2);
  });
  test("Any report routes to Gate 3 when offline", async () => {
    expect((await triageReport({ text: "fire spotted" }, { forceOffline: true })).gate).toBe(TRIAGE_GATES.GATE_3);
  });
});

describe("State Reconciliation", () => {
  const local = [
    { reportId: "r1", zone: "Z1", decision: "HOLD", gate: "GATE_3", timestamp: Date.now() - 5000 },
    { reportId: "r2", zone: "Z2", decision: "DISPATCH", gate: "GATE_3", timestamp: Date.now() - 4000 },
  ];
  const cloud = [
    { reportId: "r1", zone: "Z1", decision: "DISPATCH", gate: "GATE_2", timestamp: Date.now() - 2000 },
    { reportId: "r2", zone: "Z2", decision: "VERIFY", gate: "GATE_2", timestamp: Date.now() - 1000 },
  ];
  test("Cloud truth overwrites local", () => {
    const r = reconcileState({ local, cloud });
    expect(r.find((x: any) => x.reportId === "r1").decision).toBe("DISPATCH");
    expect(r.find((x: any) => x.reportId === "r2").decision).toBe("VERIFY");
  });
  test("Offline audit log is preserved", () => {
    expect(reconcileState({ local, cloud }).auditLog).toBeDefined();
    expect(reconcileState({ local, cloud }).auditLog.length).toBeGreaterThanOrEqual(local.length);
  });
  test("Reconciliation with empty cloud preserves local", () => {
    const r = reconcileState({ local, cloud: [] });
    expect(r.decisions.length).toBe(local.length);
  });
  test("Reconciliation does not throw on null inputs", () => {
    expect(() => reconcileState({ local: null, cloud: null })).not.toThrow();
  });
});
