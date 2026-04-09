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
    reasons.push("High-trust source improves credibility");
  } else {
    reasons.push("Low-trust source reduces baseline confidence");
  }

  if (crossSignalAgreement >= 0.66) {
    reasons.push("Multiple nearby reports agree on the same crisis signal");
  } else {
    reasons.push("Weak cross-report agreement lowers confidence");
  }

  if (contradictionScore < 0.6) {
    reasons.push("Contradicting nearby evidence reduces trust");
  }

  if (report.geminiOutput.tone !== "factual") {
    reasons.push("Non-factual tone reduces reliability");
  }

  if (minutesSinceReport > 20) {
    reasons.push("Report aged out through time decay");
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

