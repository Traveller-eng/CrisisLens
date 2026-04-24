import { processReportBatch, getZoneDecision, resetAllZones } from "./zoneManager";

export async function runAdversarialScenario(input: {
  reports: any[]; zone: string; attackType?: string; nasa?: any[]; weather?: any;
}): Promise<{ suppressedBotCount: number; sybilClusterDetected: boolean }> {
  resetAllZones();
  await processReportBatch(input.reports);
  const bots = input.reports.filter(r => r._isBotSeed || r.sourceType === "anonymous");
  const decision = getZoneDecision(input.zone);
  const suppressed = decision.state !== "DISPATCH" ? bots.length : 0;
  const sybil = bots.length >= 15 && decision.state !== "DISPATCH";
  return { suppressedBotCount: suppressed, sybilClusterDetected: sybil };
}
