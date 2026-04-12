import type { CrisisReport, NasaSignal } from "./crisis";
import { computeFusedConfidence, conflictScore, decide, nasaConfidence, reportConfidence } from "./fusion";

export type ZoneUpdateResult = {
  finalConfidence: number;
  conflictScore: number;
  decision: "DISPATCH" | "VERIFY" | "HOLD";
  reportConfidence: number;
  nasaConfidence: number;
  conflictPenalty: number;
  correlationAdjustments: string[];
};

export function updateZone(_zoneId: string, reports: CrisisReport[], signals: NasaSignal[], now = Date.now()): ZoneUpdateResult {
  const crowdConfidence = reportConfidence(reports, now);
  const signalConfidence = nasaConfidence(signals, now);
  const conflict = conflictScore(reports);
  const fusion = computeFusedConfidence(crowdConfidence, signalConfidence, conflict, {
    scenarioType: reports[0]?.geminiOutput.type === "flood" ? "flood" : reports[0]?.geminiOutput.type === "infrastructure" ? "earthquake" : "mixed",
    weatherSignal: 0
  });

  return {
    finalConfidence: fusion.finalConfidence,
    conflictScore: conflict,
    decision: decide(fusion.finalConfidence),
    reportConfidence: crowdConfidence,
    nasaConfidence: signalConfidence,
    conflictPenalty: fusion.conflictPenalty,
    correlationAdjustments: fusion.correlationAdjustments
  };
}
