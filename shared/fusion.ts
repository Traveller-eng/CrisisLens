import type { CrisisReport, NasaSignal } from "./crisis";

const EPS = 1e-6;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function timeWeight(timestamp: string, now = Date.now(), tauMs = 10 * 60 * 1000): number {
  const dt = Math.max(0, now - new Date(timestamp).getTime());
  return Math.exp(-dt / tauMs);
}

export function reportConfidence(reports: CrisisReport[], now = Date.now()): number {
  if (reports.length === 0) {
    return 0;
  }

  let numerator = 0;
  let denominator = 0;

  reports.forEach((report) => {
    const weight = timeWeight(report.timestamp, now);
    const trust =
      report.sourceType === "verified_org"
        ? 0.9
        : report.sourceType === "ngo"
          ? 0.72
          : report.sourceType === "anonymous"
            ? 0.34
            : 0.5;
    numerator += weight * trust;
    denominator += weight;
  });

  return numerator / (denominator + EPS);
}

export function nasaConfidence(signals: NasaSignal[], now = Date.now()): number {
  if (signals.length === 0) {
    return 0;
  }

  let numerator = 0;
  let denominator = 0;

  signals.forEach((signal) => {
    const weight = timeWeight(signal.timestamp, now);
    numerator += weight * signal.intensity * signal.confidence;
    denominator += weight;
  });

  return numerator / (denominator + EPS);
}

export function conflictScore(reports: CrisisReport[]): number {
  if (reports.length < 2) {
    return 0;
  }

  let positive = 0;
  let negative = 0;

  reports.forEach((report) => {
    const claim = report.claim ?? (report.contradictionSignals && report.contradictionSignals > 0 ? "negative" : "positive");
    if (claim === "positive") {
      positive += 1;
    } else {
      negative += 1;
    }
  });

  const total = positive + negative;
  if (total === 0) {
    return 0;
  }

  const imbalance = Math.abs(positive - negative) / total;
  return clamp(1 - imbalance);
}

export function computeWeights(hasNasa: boolean) {
  if (hasNasa) {
    return { alpha: 0.45, beta: 0.45, gamma: 0.6 };
  }

  return { alpha: 0.7, beta: 0, gamma: 0.6 };
}

export type EnvironmentalContext = {
  rainfallIntensity?: number;
  weatherSignal?: number;
  scenarioType?: "flood" | "fire" | "earthquake" | "mixed";
  activeAlerts?: string[];
};

export type FusionResult = {
  finalConfidence: number;
  conflictPenalty: number;
  weights: {
    report: number;
    nasa: number;
    weather: number;
  };
  correlationAdjustments: string[];
};

export function computeFusedConfidence(
  reportScore: number,
  nasaScore: number,
  conflict: number,
  context: EnvironmentalContext = {}
): FusionResult {
  let weights = {
    report: 0.5,
    nasa: nasaScore > 0 ? 0.3 : 0,
    weather: (context.weatherSignal ?? 0) > 0 ? 0.2 : 0
  };
  const correlationAdjustments: string[] = [];
  const scenarioType = context.scenarioType ?? "mixed";
  const rainfallIntensity = context.rainfallIntensity ?? context.weatherSignal ?? 0;

  if (scenarioType === "flood" && rainfallIntensity > 0.6) {
    weights.report *= 0.8;
    weights.nasa *= 0.75;
    weights.weather *= 1.2;
    correlationAdjustments.push("Rainfall correlation penalty applied to crowd and satellite signals.");
  }

  if (scenarioType === "fire" && nasaScore > 0.7) {
    weights.nasa *= 1.3;
    weights.report *= 0.85;
    correlationAdjustments.push("Fire scenario boosts thermal satellite weighting.");
  }

  if (scenarioType === "earthquake") {
    weights.nasa *= 0.5;
    weights.report *= 1.2;
    correlationAdjustments.push("Earthquake scenario prioritizes crowd signals over satellite input.");
  }

  const totalWeight = Math.max(EPS, weights.report + weights.nasa + weights.weather);
  weights = {
    report: weights.report / totalWeight,
    nasa: weights.nasa / totalWeight,
    weather: weights.weather / totalWeight
  };

  const rawFused =
    weights.report * reportScore +
    weights.nasa * nasaScore +
    weights.weather * (context.weatherSignal ?? rainfallIntensity ?? 0);
  const conflictPenalty = conflict * 0.6;

  return {
    finalConfidence: clamp(rawFused - conflictPenalty),
    conflictPenalty,
    weights,
    correlationAdjustments
  };
}

export function fuseConfidence(reportScore: number, nasaScore: number, conflict: number, hasNasa: boolean): number {
  const { alpha, beta, gamma } = computeWeights(hasNasa);
  return clamp(alpha * reportScore + beta * nasaScore - gamma * conflict);
}

export function decide(score: number): "DISPATCH" | "VERIFY" | "HOLD" {
  if (score > 0.75) {
    return "DISPATCH";
  }

  if (score > 0.5) {
    return "VERIFY";
  }

  return "HOLD";
}
