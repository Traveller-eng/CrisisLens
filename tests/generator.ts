import type { ClaimType, CrisisReport, NasaSignal } from "../shared/crisis";

let seed = 42;

export function resetSeed(nextSeed = 42) {
  seed = nextSeed;
}

function rand(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

export function genReports(n: number, trust: number, claim: ClaimType): CrisisReport[] {
  const baseTimestamp = Date.now();
  return Array.from({ length: n }, (_, index) => {
    const sourceType =
      trust >= 0.82 ? "verified_org" : trust >= 0.62 ? "ngo" : "anonymous";

    return {
      id: `report-${claim}-${index}-${Math.round(rand() * 100000)}`,
      source: sourceType === "verified_org" ? "Verified Desk" : sourceType === "ngo" ? "NGO Desk" : "Crowd Reporter",
      sourceType,
      text: claim === "positive" ? "Flood risk reported in zone" : "No flood reported in zone",
      timestamp: new Date(baseTimestamp - rand() * 100000).toISOString(),
      lat: 13.0827 + (rand() - 0.5) * 0.02,
      lng: 80.2707 + (rand() - 0.5) * 0.02,
      zone: "Z1",
      geminiOutput: {
        type: "flood",
        urgency: Math.max(0.1, Math.min(1, trust + (rand() - 0.5) * 0.15)),
        needs: ["rescue"],
        tone: sourceType === "anonymous" ? "emotional" : "factual"
      },
      contradictionSignals: claim === "negative" ? 1 : 0,
      claim
    };
  });
}

export function genSignals(n: number, intensity: number): NasaSignal[] {
  const baseTimestamp = Date.now();
  return Array.from({ length: n }, (_, index) => ({
    id: `signal-${index}-${Math.round(rand() * 100000)}`,
    lat: 13.0827 + (rand() - 0.5) * 0.02,
    lng: 80.2707 + (rand() - 0.5) * 0.02,
    type: "flood",
    intensity: Math.max(0, Math.min(1, intensity + (rand() - 0.5) * 0.15)),
    confidence: 0.8 + rand() * 0.2,
    timestamp: new Date(baseTimestamp - rand() * 100000).toISOString()
  }));
}
