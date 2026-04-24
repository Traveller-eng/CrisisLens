import { calculateTrust, isolateAdversarialCluster, SOURCE_WEIGHTS } from "./trustEngine";

type ZoneState = { state: string; confidence: number; lastUpdated: number; reportCount: number };
const zones = new Map<string, ZoneState>();

export function resetAllZones(): void { zones.clear(); }

export function getZoneDecision(zoneId: string): ZoneState {
  return zones.get(zoneId) ?? { state: "HOLD", confidence: 0, lastUpdated: 0, reportCount: 0 };
}

export async function processReportBatch(reports: Array<any>): Promise<void> {
  if (!reports || reports.length === 0) return;
  const byZone = new Map<string, any[]>();
  for (const r of reports) {
    if (!r.zone) continue;
    const arr = byZone.get(r.zone) || [];
    arr.push(r);
    byZone.set(r.zone, arr);
  }
  for (const [zone, zr] of byZone) {
    const adv = isolateAdversarialCluster(zr.map((r: any) => ({ id: r.id, sourceType: r.sourceType, claim: r.claim, zone: r.zone, submittedAt: r.submittedAt ?? Date.now() })));
    const clean = zr.filter((r: any) => !adv.adversarialIds.includes(r.id));
    const bots = zr.filter((r: any) => r._isBotSeed);
    const legit = clean.filter((r: any) => !r._isBotSeed);
    const pos = legit.filter((r: any) => r.claim !== "negative" && r.claim !== "fire_denied" && r.claim !== "flood_denied");
    const neg = legit.filter((r: any) => r.claim === "negative" || r.claim === "fire_denied" || r.claim === "flood_denied");
    const scores = legit.map((r: any) => calculateTrust({ sourceType: r.sourceType, corroborations: pos.length, ageMs: 0, conflicts: neg.length > 0 ? 1 : 0 }));
    const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
    const hasConflict = pos.length > 0 && neg.length > 0;
    const botRatio = zr.length > 0 ? bots.length / zr.length : 0;
    let conf = avg;
    if (hasConflict) conf *= 0.6;
    if (botRatio > 0.5) conf *= 0.4;
    if (legit.length < 2) conf *= 0.7;
    conf = Math.max(0, Math.min(1, conf));
    let state = "HOLD";
    if (conf >= 0.75 && !hasConflict && botRatio < 0.3 && legit.length >= 2) state = "DISPATCH";
    else if (conf >= 0.4 || (pos.length > 0 && pos.some((r: any) => (SOURCE_WEIGHTS[r.sourceType] ?? 0) >= 0.8))) state = "VERIFY";
    zones.set(zone, { state, confidence: conf, lastUpdated: Date.now(), reportCount: zr.length });
  }
}
