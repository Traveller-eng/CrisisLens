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
