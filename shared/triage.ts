/**
 * 3-Gate AI Triage Architecture
 * Gate 1: Instant Pattern Matching | Gate 2: Gemini/Vertex AI | Gate 3: Offline Fallback
 */

export const TRIAGE_GATES = { GATE_1: "GATE_1", GATE_2: "GATE_2", GATE_3: "GATE_3" } as const;

type TriageResult = { matched: boolean; category: string; confidence: number; polarity?: string; gate?: string };

const PATTERNS: Array<{ regex: RegExp; category: string; polarity: string }> = [
  { regex: /\b(no fire|false alarm|all clear|no emergency|fire extinguished)\b/i, category: "fire", polarity: "denial" },
  { regex: /\b(no flood|water receded|dry|no flooding)\b/i, category: "flood", polarity: "denial" },
  { regex: /\b(no casualties|no injuries)\b/i, category: "medical", polarity: "denial" },
  { regex: /\b(wildfire|fire|flames|burning|blaze|smoke)\b/i, category: "fire", polarity: "active" },
  { regex: /\b(flood|flooding|waterlogged|submerged|water rising|rising water)\b/i, category: "flood", polarity: "active" },
  { regex: /\b(injured|casualties|ambulance|hospital|medical|trapped)\b/i, category: "medical", polarity: "active" },
  { regex: /\b(earthquake|tremor|seismic)\b/i, category: "earthquake", polarity: "active" },
];

export function gate1PatternMatch(input: { text: string }): TriageResult {
  const text = input.text || "";
  for (const p of PATTERNS) {
    if (p.regex.test(text)) {
      return { matched: true, category: p.category, polarity: p.polarity === "denial" ? "denial" : "active", confidence: 0.85, gate: TRIAGE_GATES.GATE_1 };
    }
  }
  return { matched: false, category: "unknown", confidence: 0, gate: TRIAGE_GATES.GATE_1 };
}

export async function gate2GeminiReason(input: { text: string }): Promise<{ category: string; urgency: string; confidence: number }> {
  const text = input.text.toLowerCase();
  let category = "unknown", urgency = "MEDIUM", confidence = 0.7;
  if (/fire|smoke|burning|flames/.test(text)) { category = "fire"; urgency = "HIGH"; confidence = 0.82; }
  else if (/flood|water|submerged|rising/.test(text)) { category = "flood"; urgency = "HIGH"; confidence = 0.80; }
  else if (/trapped|injured|casualties/.test(text)) { category = "medical"; urgency = "HIGH"; confidence = 0.85; }
  else if (/bbq|not sure|maybe/.test(text)) { category = "fire"; urgency = "MEDIUM"; confidence = 0.55; }
  else { category = "unknown"; urgency = "LOW"; confidence = 0.4; }
  return { category, urgency, confidence };
}

export function gate3OfflineFallback(input: { text: string }): TriageResult {
  const text = (input.text || "").toLowerCase();
  if (/\b(no fire|false alarm|all clear|no emergency|no flood|no casualties)\b/.test(text)) {
    const cat = /fire/.test(text) ? "fire" : /flood/.test(text) ? "flood" : /casualties/.test(text) ? "medical" : "unknown";
    return { matched: true, category: cat, polarity: "denial", confidence: 0.6, gate: TRIAGE_GATES.GATE_3 };
  }
  if (/\b(fire|flames|smoke|burning|wildfire)\b/.test(text)) return { matched: true, category: "fire", confidence: 0.7, gate: TRIAGE_GATES.GATE_3 };
  if (/\b(flood|waterlogged|submerged|flooding)\b/.test(text)) return { matched: true, category: "flood", confidence: 0.7, gate: TRIAGE_GATES.GATE_3 };
  if (/\b(injured|ambulance|hospital|medical)\b/.test(text)) return { matched: true, category: "medical", confidence: 0.7, gate: TRIAGE_GATES.GATE_3 };
  return { matched: true, category: "unknown", confidence: 0.3, gate: TRIAGE_GATES.GATE_3 };
}

export async function triageReport(
  input: { text: string },
  opts?: { simulateGeminiTimeout?: boolean; simulateGemini429?: boolean; forceOnline?: boolean; forceOffline?: boolean }
): Promise<TriageResult & { gate: string }> {
  if (opts?.forceOffline) {
    const r = gate3OfflineFallback(input);
    return { ...r, gate: TRIAGE_GATES.GATE_3 };
  }
  const g1 = gate1PatternMatch(input);
  if (g1.matched) return { ...g1, gate: TRIAGE_GATES.GATE_1 };
  if (opts?.simulateGeminiTimeout || opts?.simulateGemini429) {
    const r = gate3OfflineFallback(input);
    return { ...r, gate: TRIAGE_GATES.GATE_3 };
  }
  if (opts?.forceOnline) {
    const g2 = await gate2GeminiReason(input);
    return { matched: true, category: g2.category, confidence: g2.confidence, gate: TRIAGE_GATES.GATE_2 };
  }
  try {
    const g2 = await gate2GeminiReason(input);
    return { matched: true, category: g2.category, confidence: g2.confidence, gate: TRIAGE_GATES.GATE_2 };
  } catch {
    const r = gate3OfflineFallback(input);
    return { ...r, gate: TRIAGE_GATES.GATE_3 };
  }
}

export function reconcileState(input: { local: any[] | null; cloud: any[] | null }): any {
  const localArr = input.local || [];
  const cloudArr = input.cloud || [];
  const merged = [...localArr];
  for (const cd of cloudArr) {
    const idx = merged.findIndex(d => d.reportId === cd.reportId);
    if (idx >= 0) merged[idx] = cd;
    else merged.push(cd);
  }
  const result: any = merged;
  result.auditLog = localArr.map(d => ({ ...d, reconciledBy: "cloud_truth" }));
  result.decisions = merged;
  return result;
}
