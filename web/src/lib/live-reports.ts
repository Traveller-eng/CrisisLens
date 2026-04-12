import type { DocumentData, QueryDocumentSnapshot, Timestamp } from "firebase/firestore";
import type { AIAnalysis, ClaimType, CrisisReport, CrisisType, NeedType, SourceType, ToneType } from "../../../shared/crisis";

const validSourceTypes = new Set<SourceType>(["verified_org", "ngo", "unknown", "anonymous"]);
const validTypes = new Set<CrisisType>(["flood", "injury", "infrastructure", "shelter"]);
const validNeeds = new Set<NeedType>(["rescue", "medical", "food", "shelter"]);
const validTones = new Set<ToneType>(["factual", "emotional", "exaggerated"]);

function normalizeTimestamp(value: unknown): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  const timestamp = value as Timestamp;
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toISOString();
  }

  return new Date().toISOString();
}

function normalizeType(value: unknown): CrisisType {
  return typeof value === "string" && validTypes.has(value as CrisisType) ? (value as CrisisType) : "flood";
}

function normalizeNeeds(value: unknown): NeedType[] {
  if (!Array.isArray(value)) {
    return ["rescue"];
  }

  const needs = value.filter((item): item is NeedType => typeof item === "string" && validNeeds.has(item as NeedType));
  return needs.length > 0 ? needs : ["rescue"];
}

function normalizeTone(value: unknown): ToneType {
  return typeof value === "string" && validTones.has(value as ToneType) ? (value as ToneType) : "factual";
}

function normalizeSourceType(value: unknown): SourceType {
  return typeof value === "string" && validSourceTypes.has(value as SourceType) ? (value as SourceType) : "unknown";
}

export function normalizeReport(doc: QueryDocumentSnapshot<DocumentData>): CrisisReport {
  const raw = doc.data();
  const triage = raw.triage ?? raw.geminiOutput ?? {};
  const geo = raw.geo ?? {};
  const lat = Number(raw.lat ?? geo.lat ?? raw.location?.lat ?? 0);
  const lng = Number(raw.lng ?? geo.lng ?? raw.location?.lng ?? 0);
  const conflicts = Array.isArray(raw.conflicts) ? raw.conflicts.length : Number(raw.contradictionSignals ?? 0);

  return {
    id: doc.id,
    source: raw.source ?? raw.sourceName ?? raw.sourceType ?? "Live source",
    sourceType: normalizeSourceType(raw.sourceType),
    text: raw.text ?? raw.content ?? "Incoming report",
    timestamp: normalizeTimestamp(raw.timestamp),
    lat,
    lng,
    zone: raw.zone ?? raw.zoneId ?? triage.location ?? "Unassigned Zone",
    geminiOutput: {
      type: normalizeType(triage.type),
      urgency: Number(triage.urgency ?? 0.5),
      needs: normalizeNeeds(triage.needs),
      tone: normalizeTone(triage.tone)
    },
    contradictionSignals: Number.isFinite(conflicts) ? conflicts : 0,
    claim:
      raw.claim === "negative" || raw.claim === "neutral"
        ? (raw.claim as ClaimType)
        : ("positive" as ClaimType),
    ai: (raw.ai ?? undefined) as AIAnalysis | undefined
  };
}
