import type { CrisisReport, NasaSignal } from "./crisis";
import { conflictScore, decide, fuseConfidence, nasaConfidence, reportConfidence } from "./fusion";

export type ZoneUpdateResult = {
  finalConfidence: number;
  conflictScore: number;
  decision: "DISPATCH" | "VERIFY" | "HOLD";
  reportConfidence: number;
  nasaConfidence: number;
};

export function updateZone(_zoneId: string, reports: CrisisReport[], signals: NasaSignal[], now = Date.now()): ZoneUpdateResult {
  const crowdConfidence = reportConfidence(reports, now);
  const signalConfidence = nasaConfidence(signals, now);
  const conflict = conflictScore(reports);
  const finalConfidence = fuseConfidence(crowdConfidence, signalConfidence, conflict, signals.length > 0);

  return {
    finalConfidence,
    conflictScore: conflict,
    decision: decide(finalConfidence),
    reportConfidence: crowdConfidence,
    nasaConfidence: signalConfidence
  };
}
