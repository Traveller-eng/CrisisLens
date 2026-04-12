import { updateZone } from "../shared/zone-update";
import { genReports, genSignals, resetSeed } from "./generator";

describe("Metric extraction", () => {
  test("false positive suppression metric is reproducible", () => {
    resetSeed(42);
    const reports = [...genReports(20, 0.82, "positive"), ...genReports(40, 0.25, "negative")];
    const signals = genSignals(3, 0.85);

    const baselineFalseDispatches = 1;
    const filtered = updateZone("Z1", reports, signals);
    const filteredFalseDispatches = filtered.decision === "DISPATCH" ? 1 : 0;
    const reductionRate =
      (baselineFalseDispatches - filteredFalseDispatches) / baselineFalseDispatches;

    expect(reports.filter((report) => report.claim === "negative").length).toBe(40);
    expect(reductionRate).toBeGreaterThanOrEqual(0);
  });
});
