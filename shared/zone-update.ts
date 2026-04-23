import type { CrisisReport, NasaSignal } from "./crisis";
import { computeFusedConfidence, conflictScore, decide, nasaConfidence, reportConfidence } from "./fusion";

export type ZoneConfidenceBreakdown = {
  reportWeight: number;
  nasaWeight: number;
  weatherWeight: number;
  conflictPenalty: number;
  correlationAdjustments: string[];
  conflictCount: number;
  nasaActive: boolean;
};

export type ZoneUpdateResult = {
  finalConfidence: number;
  conflictScore: number;
  decision: "DISPATCH" | "VERIFY" | "HOLD";
  reportConfidence: number;
  nasaConfidence: number;
  conflictPenalty: number;
  correlationAdjustments: string[];
  breakdown: ZoneConfidenceBreakdown;
};

export function updateZone(_zoneId: string, reports: CrisisReport[], signals: NasaSignal[], now = Date.now()): ZoneUpdateResult {
  const crowdConfidence = reportConfidence(reports, now);
  const signalConfidence = nasaConfidence(signals, now);
  const conflict = conflictScore(reports);
  const fusion = computeFusedConfidence(crowdConfidence, signalConfidence, conflict, {
    scenarioType: reports[0]?.geminiOutput.type === "flood" ? "flood" : reports[0]?.geminiOutput.type === "infrastructure" ? "earthquake" : "mixed",
    weatherSignal: 0
  });

  const conflictingReports = reports.filter((report) => (report.contradictionSignals ?? 0) > 0 || report.claim === "negative");

  return {
    finalConfidence: fusion.finalConfidence,
    conflictScore: conflict,
    decision: decide(fusion.finalConfidence),
    reportConfidence: crowdConfidence,
    nasaConfidence: signalConfidence,
    conflictPenalty: fusion.conflictPenalty,
    correlationAdjustments: fusion.correlationAdjustments,
    breakdown: {
      reportWeight: fusion.weights.report,
      nasaWeight: fusion.weights.nasa,
      weatherWeight: fusion.weights.weather,
      conflictPenalty: fusion.conflictPenalty,
      correlationAdjustments: fusion.correlationAdjustments,
      conflictCount: conflictingReports.length,
      nasaActive: signalConfidence > 0
    }
  };
}
