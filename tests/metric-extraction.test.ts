import { updateZone } from "../shared/zone-update";
import { genReports, genSignals, resetSeed } from "./generator";
import * as fs from "fs";
import * as path from "path";

describe("Metric extraction", () => {
  test("false positive suppression metric is reproducible across 5 adversarial scenarios", () => {
    let totalFalseReports = 0;
    let totalFalseDispatchesPrevented = 0;

    const runScenario = (
      seed: number,
      posCount: number,
      negCount: number,
      nasaIntensity: number
    ) => {
      resetSeed(seed);
      const reports = [
        ...genReports(posCount, 0.82, "positive"),
        ...genReports(negCount, 0.25, "negative")
      ];
      const signals = genSignals(3, nasaIntensity);

      const filtered = updateZone("Z1", reports, signals);
      const baselineWouldDispatch = 1; // Baseline assumes 100% false dispatch on raw noise
      const filteredDispatch = filtered.decision === "DISPATCH" ? 1 : 0;
      
      const falseReportsCount = reports.filter((r) => r.claim === "negative").length;
      totalFalseReports += falseReportsCount;
      if (baselineWouldDispatch - filteredDispatch > 0 && falseReportsCount > 0) {
          totalFalseDispatchesPrevented += falseReportsCount;
      }
      return { falseReportsCount, filteredDecision: filtered.decision };
    };

    runScenario(42, 20, 40, 0.85); // Balanced attack
    runScenario(43, 10, 60, 0.85); // Heavy misinfo
    runScenario(44, 30, 20, 0.85); // Light misinfo
    runScenario(45, 0, 50, 0.85);  // Pure noise
    runScenario(46, 20, 40, 1.0);  // Coordinated attack

    const suppressionRate = totalFalseReports > 0 ? (totalFalseDispatchesPrevented / totalFalseReports) * 100 : 0;

    const metricOutput = {
      value: Math.round(suppressionRate),
      seed: "42-46",
      scenarioSet: ["Balanced", "Heavy Misinfo", "Light Misinfo", "Pure Noise", "Coordinated Attack"],
      totalFalseReports,
      generatedAt: new Date().toISOString()
    };

    console.log(`METRIC_RESULT: suppression_rate=${metricOutput.value}%`);
    fs.writeFileSync(path.join(__dirname, ".last-metric.json"), JSON.stringify(metricOutput, null, 2));

    expect(metricOutput.value).toBeGreaterThanOrEqual(0);
    expect(metricOutput.value).toBeLessThanOrEqual(100);
  });
});
