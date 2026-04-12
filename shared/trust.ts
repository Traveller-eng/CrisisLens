import type { CrisisReport, ScoredReport, ToneType, TrustBreakdown, TrustState, SourceType } from "./crisis";

const sourcePriorMap: Record<SourceType, number> = {
  verified_org: 1,
  ngo: 0.8,
  unknown: 0.4,
  anonymous: 0.2
};

const languageScoreMap: Record<ToneType, number> = {
  factual: 1,
  emotional: 0.5,
  exaggerated: 0.2
};

const trustWeights = {
  sourcePrior: 0.3,
  crossSignalAgreement: 0.25,
  temporalConsistency: 0.2,
  contradictionScore: 0.15,
  languageScore: 0.1
};

const decayLambda = 0.02;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function getTrustState(score: number): TrustState {
  if (score >= 0.75) {
    return "VERIFIED";
  }

  if (score >= 0.45) {
    return "UNCERTAIN";
  }

  return "FALSE";
}

export function scoreReport(report: CrisisReport, zoneReports: CrisisReport[], now = new Date()): ScoredReport {
  const sourcePrior = sourcePriorMap[report.sourceType];

  const similarReports = zoneReports.filter((candidate) => candidate.geminiOutput.type === report.geminiOutput.type);
  const crossSignalAgreement = zoneReports.length === 0 ? 0 : clamp(similarReports.length / zoneReports.length);

  const temporalConsistency = similarReports.length >= 2 ? 0.9 : similarReports.length === 1 ? 0.6 : 0.3;
  const contradictionScore = clamp(1 - (report.contradictionSignals ?? 0) * 0.25);
  const languageScore = languageScoreMap[report.geminiOutput.tone];

  const baseTrust =
    sourcePrior * trustWeights.sourcePrior +
    crossSignalAgreement * trustWeights.crossSignalAgreement +
    temporalConsistency * trustWeights.temporalConsistency +
    contradictionScore * trustWeights.contradictionScore +
    languageScore * trustWeights.languageScore;

  const minutesSinceReport = Math.max(
    0,
    Math.round((now.getTime() - new Date(report.timestamp).getTime()) / 60000)
  );

  const decayedTrust = clamp(baseTrust * Math.exp(-decayLambda * minutesSinceReport));
  const state = getTrustState(decayedTrust);

  const reasons: string[] = [];

  if (sourcePrior >= 0.8) {
    reasons.push(`${report.sourceType === "verified_org" ? "Verified command/agency source" : "NGO source"} lifts baseline credibility to ${sourcePrior.toFixed(2)}.`);
  } else {
    reasons.push(`${report.sourceType === "anonymous" ? "Anonymous source" : "Unknown source"} starts with a low prior of ${sourcePrior.toFixed(2)} before corroboration.`);
  }

  if (crossSignalAgreement >= 0.66) {
    reasons.push(`${similarReports.length} nearby reports align on the same ${report.geminiOutput.type} signal, pushing cross-agreement to ${crossSignalAgreement.toFixed(2)}.`);
  } else {
    reasons.push(`Only ${similarReports.length} nearby reports support this signal, so cross-agreement remains weak at ${crossSignalAgreement.toFixed(2)}.`);
  }

  if (contradictionScore < 0.6) {
    reasons.push(`Contradicting evidence is active in this zone, dragging contradiction health down to ${contradictionScore.toFixed(2)}.`);
  }

  if (report.geminiOutput.tone !== "factual") {
    reasons.push(`${report.geminiOutput.tone} tone lowers language reliability to ${languageScore.toFixed(2)}.`);
  }

  if (minutesSinceReport > 20) {
    reasons.push(`This report is ${minutesSinceReport} minutes old, so time decay has started reducing its weight.`);
  }

  if (report.ai?.reasoning) {
    reasons.push(report.ai.reasoning);
  }

  const trust: TrustBreakdown = {
    sourcePrior,
    crossSignalAgreement,
    temporalConsistency,
    contradictionScore,
    languageScore,
    baseTrust: clamp(baseTrust),
    decayedTrust,
    minutesSinceReport,
    state,
    reasons
  };

  return {
    ...report,
    trust
  };
}
