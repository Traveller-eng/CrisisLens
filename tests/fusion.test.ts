import { updateZone } from "../shared/zone-update";
import { genReports, genSignals, resetSeed } from "./generator";

describe("CrisisLens Fusion Engine", () => {
  beforeEach(() => {
    resetSeed();
  });

  test("Ideal scenario -> DISPATCH", () => {
    const reports = genReports(30, 0.9, "positive");
    const signals = genSignals(5, 0.95);

    const result = updateZone("Z1", reports, signals);

    expect(result.finalConfidence).toBeGreaterThan(0.7);
    expect(result.conflictScore).toBeLessThan(0.2);
    expect(result.decision).toBe("DISPATCH");
  });

  test("Misinformation attack -> VERIFY or HOLD", () => {
    const reports = [...genReports(20, 0.82, "positive"), ...genReports(40, 0.25, "negative")];
    const signals = genSignals(3, 0.85);

    const result = updateZone("Z1", reports, signals);

    expect(result.conflictScore).toBeGreaterThan(0.3);
    expect(["VERIFY", "HOLD"]).toContain(result.decision);
  });

  test("Coordinated fake attack -> VERIFY because satellite confirmation prevents HOLD", () => {
    const reports = genReports(50, 0.25, "negative");
    const signals = genSignals(4, 0.98);

    const result = updateZone("Z1", reports, signals);

    expect(result.nasaConfidence).toBeGreaterThan(0.8);
    expect(result.finalConfidence).toBeGreaterThan(0.5);
    expect(result.decision).toBe("VERIFY");
  });

  test("No NASA fallback still operates", () => {
    const reports = genReports(25, 0.72, "positive");

    const result = updateZone("Z1", reports, []);

    expect(result.reportConfidence).toBeGreaterThan(0.6);
    expect(["VERIFY", "DISPATCH"]).toContain(result.decision);
  });

  test("Sparse data -> HOLD", () => {
    const reports = genReports(2, 0.34, "positive");
    const result = updateZone("Z1", reports, []);

    expect(result.finalConfidence).toBeLessThan(0.5);
    expect(result.decision).toBe("HOLD");
  });

  test("Conflict explosion -> HOLD", () => {
    const reports = [...genReports(25, 0.72, "positive"), ...genReports(25, 0.72, "negative")];
    const signals = genSignals(2, 0.5);

    const result = updateZone("Z1", reports, signals);

    expect(result.conflictScore).toBeGreaterThan(0.9);
    expect(result.decision).toBe("HOLD");
  });

  test("High noise does not crash and stays bounded", () => {
    resetSeed(99);
    const reports = [...genReports(35, 0.2, "negative"), ...genReports(35, 0.85, "positive"), ...genReports(15, 0.55, "positive"), ...genReports(15, 0.55, "negative")];
    const signals = genSignals(3, 0.6);

    const result = updateZone("Z1", reports, signals);

    expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
    expect(result.finalConfidence).toBeLessThanOrEqual(1);
    expect(["DISPATCH", "VERIFY", "HOLD"]).toContain(result.decision);
  });

  test("Recent data dominates older data", () => {
    const oldPositive = genReports(10, 0.9, "positive").map((report) => ({
      ...report,
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    }));
    const recentNegative = genReports(10, 0.34, "negative");
    const signals = genSignals(2, 0.8);

    const result = updateZone("Z1", [...oldPositive, ...recentNegative], signals);

    expect(result.conflictScore).toBeGreaterThan(0.3);
    expect(["VERIFY", "HOLD"]).toContain(result.decision);
  });

  test("Extreme NASA override -> VERIFY", () => {
    const reports = genReports(40, 0.34, "negative");
    const signals = genSignals(5, 1);

    const result = updateZone("Z1", reports, signals);

    expect(result.nasaConfidence).toBeGreaterThan(0.85);
    expect(result.finalConfidence).toBeGreaterThan(0.5);
    expect(result.decision).toBe("VERIFY");
  });

  test("Zero input -> HOLD", () => {
    const result = updateZone("Z1", [], []);

    expect(result.finalConfidence).toBe(0);
    expect(result.conflictScore).toBe(0);
    expect(result.decision).toBe("HOLD");
  });

  test("Stability under repeated noisy runs", () => {
    const results: number[] = [];

    for (let index = 0; index < 20; index += 1) {
      resetSeed(100 + index);
      const reports = genReports(50, 0.65, "positive");
      const signals = genSignals(3, 0.72);
      const result = updateZone("Z1", reports, signals);
      results.push(result.finalConfidence);
    }

    const average = results.reduce((sum, value) => sum + value, 0) / results.length;
    const variance = results.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / results.length;

    expect(variance).toBeLessThan(0.05);
  });

  test("Performance under load", () => {
    const reports = genReports(1000, 0.6, "positive");
    const signals = genSignals(50, 0.7);

    const startedAt = Date.now();
    const result = updateZone("Z1", reports, signals);
    const elapsedMs = Date.now() - startedAt;

    expect(result.finalConfidence).toBeGreaterThanOrEqual(0);
    expect(elapsedMs).toBeLessThan(100);
  });
});
