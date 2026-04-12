import { updateZone } from "../shared/zone-update";
import { genReports, genSignals, resetSeed } from "./generator";

describe("CrisisLens Metrics", () => {
  beforeEach(() => {
    resetSeed();
  });

  test("Misinformation suppression metric", () => {
    const reports = [...genReports(20, 0.8, "positive"), ...genReports(40, 0.2, "negative")];
    const signals = genSignals(3, 0.85);

    const result = updateZone("Z1", reports, signals);
    const falseReports = reports.filter((report) => report.claim === "negative").length;
    const suppressed = result.decision === "HOLD" || result.decision === "VERIFY";
    const metric = suppressed ? falseReports : 0;

    console.table([
      {
        confidence: result.finalConfidence.toFixed(2),
        decision: result.decision,
        conflict: result.conflictScore.toFixed(2),
        suppressedFalseSignals: metric
      }
    ]);

    expect(metric).toBeGreaterThan(20);
  });
});
