/**
 * Trust Engine — Bayesian trust model
 * Trust = f(source_weight, corroboration_density, temporal_decay, conflict_penalty)
 */

export const SOURCE_WEIGHTS: Record<string, number> = {
  verified: 1.0,
  verified_org: 1.0,
  ngo: 0.8,
  citizen: 0.55,
  unknown: 0.4,
  anonymous: 0.2
};

const DECAY_WINDOW_MS = 12 * 60 * 60 * 1000;

export function applyTemporalDecay(trust: number, ageMs: number): number {
  if (ageMs <= 0) return trust;
  return Math.max(0, trust * Math.exp(-ageMs / DECAY_WINDOW_MS));
}

export function applyConflictPenalty(trust: number, conflicts: number): number {
  return Math.max(0, trust - conflicts * 0.15);
}

export function calculateTrust(input: {
  sourceType: string;
  corroborations: number;
  ageMs: number;
  conflicts: number;
}): number {
  const base = SOURCE_WEIGHTS[input.sourceType] ?? SOURCE_WEIGHTS.anonymous;
  const corroborationBoost = Math.min(0.4, input.corroborations * 0.04);
  let trust = applyTemporalDecay(base, input.ageMs);
  trust = trust + corroborationBoost;
  trust = applyConflictPenalty(trust, input.conflicts);
  return Math.max(0, Math.min(1, trust));
}

export function resolveConflict(
  reportA: { id: string; sourceType: string; claim: string; zone: string; trust: number },
  reportB: { id: string; sourceType: string; claim: string; zone: string; trust: number }
): { decision: string } {
  if (reportA.claim !== reportB.claim) {
    const bothHighTrust = (SOURCE_WEIGHTS[reportA.sourceType] ?? 0) >= 0.8
      && (SOURCE_WEIGHTS[reportB.sourceType] ?? 0) >= 0.8;
    if (bothHighTrust) return { decision: "VERIFY" };
    const winner = reportA.trust >= reportB.trust ? reportA : reportB;
    return { decision: winner.trust > 0.75 ? "DISPATCH" : "VERIFY" };
  }
  return { decision: reportA.trust > 0.75 ? "DISPATCH" : "VERIFY" };
}

const CONTRADICTION_PAIRS = [
  [/\bactive\b/i, /\bextinguished\b/i],
  [/\bactive\b/i, /\bdenied\b/i],
  [/\bflooding\b/i, /\bdry\b/i],
  [/\bfire\b/i, /\bno fire\b/i],
  [/\bcasualties\b/i, /\bno casualties\b/i],
  [/\bmultiple casualties\b/i, /\bno casualties\b/i],
  [/\brising\b/i, /\bdry\b/i],
];

export function detectSemanticContradiction(text1: unknown, text2: unknown): boolean {
  if (!text1 || !text2 || typeof text1 !== "string" || typeof text2 !== "string") return false;
  if (text1.length === 0 || text2.length === 0) return false;

  const combined = text1.toLowerCase() + " ||| " + text2.toLowerCase();
  for (const [patA, patB] of CONTRADICTION_PAIRS) {
    const aIn1 = patA.test(text1) && patB.test(text2);
    const aIn2 = patB.test(text1) && patA.test(text2);
    if (aIn1 || aIn2) return true;
  }
  if (/\bconfirmed\b/i.test(text1) && /\bconfirmed\b/i.test(text2)) return false;
  return false;
}

export function isolateAdversarialCluster(
  reports: Array<{ id: string; sourceType: string; claim: string; zone: string; submittedAt: number }>
): { adversarialIds: string[] } {
  if (!reports || reports.length === 0) return { adversarialIds: [] };

  const anonymous = reports.filter(r => r.sourceType === "anonymous");
  if (anonymous.length < 10) return { adversarialIds: [] };

  const claimGroups = new Map<string, typeof anonymous>();
  for (const r of anonymous) {
    const key = `${r.claim}:${r.zone}`;
    const group = claimGroups.get(key) || [];
    group.push(r);
    claimGroups.set(key, group);
  }

  const adversarialIds: string[] = [];
  for (const [, group] of claimGroups) {
    if (group.length >= 10) {
      const sorted = [...group].sort((a, b) => b.submittedAt - a.submittedAt);
      const timeSpan = sorted[0].submittedAt - sorted[sorted.length - 1].submittedAt;
      const avgInterval = timeSpan / (sorted.length - 1);
      if (avgInterval < 2000) {
        adversarialIds.push(...group.map(r => r.id));
      }
    }
  }
  return { adversarialIds };
}
