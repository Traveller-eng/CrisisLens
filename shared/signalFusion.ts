/**
 * Signal Fusion Engine
 * 8km spatial buffering, 12-hour temporal windowing, composite confidence scoring.
 */

export const SPATIAL_BUFFER_KM = 8;
export const TEMPORAL_WINDOW_MS = 12 * 60 * 60 * 1000;

const SOURCE_WEIGHTS: Record<string, number> = {
  verified: 1.0, verified_org: 1.0, ngo: 0.8, citizen: 0.55, unknown: 0.4, anonymous: 0.2
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if ([lat1, lon1, lat2, lon2].some(v => isNaN(v))) return NaN;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function spatiallyCorrelate(
  report: { lat: number; lon: number },
  centerLat: number,
  centerLon: number
): { correlated: boolean; weight: number } {
  const dist = haversineKm(report.lat, report.lon, centerLat, centerLon);
  if (isNaN(dist)) return { correlated: false, weight: 0 };
  const correlated = dist <= SPATIAL_BUFFER_KM;
  const weight = correlated ? Math.max(0, 1 - dist / SPATIAL_BUFFER_KM) : 0;
  return { correlated, weight };
}

export function temporallyCorrelate(
  signalTimeMs: number,
  nowMs: number
): { inWindow: boolean } {
  const diff = nowMs - signalTimeMs;
  if (diff < 0) return { inWindow: false };
  return { inWindow: diff <= TEMPORAL_WINDOW_MS };
}

export function decayConfidenceOverTime(confidence: number, ageMs: number): number {
  const factor = Math.max(0, 1 - ageMs / TEMPORAL_WINDOW_MS);
  return Math.max(0, confidence * factor);
}

export function computeCompositeConfidence(input: {
  reports: Array<{ lat?: number; lon?: number; sourceType?: string; claim?: string }>;
  nasa?: Array<{ lat: number; lon: number; confidence: string; acq_date: string }>;
  weather?: { windSpeedKph?: number; humidity?: number; rainfall_mm_last_24h?: number } | null;
}): number {
  const { reports, nasa = [], weather = null } = input;
  if (reports.length === 0) return 0;

  const avgLat = reports.reduce((s, r) => s + (r.lat ?? 0), 0) / reports.length;
  const avgLon = reports.reduce((s, r) => s + (r.lon ?? 0), 0) / reports.length;
  const avgTrust = reports.reduce((s, r) => s + (SOURCE_WEIGHTS[r.sourceType ?? "anonymous"] ?? 0.3), 0) / reports.length;
  const reportSignal = Math.min(1.0, avgTrust * Math.min(reports.length / 3, 1.5));

  let nasaBoost = 0;
  const now = Date.now();
  for (const h of nasa) {
    const sp = spatiallyCorrelate({ lat: h.lat, lon: h.lon }, avgLat, avgLon);
    const tp = temporallyCorrelate(new Date(h.acq_date).getTime(), now);
    if (sp.correlated && tp.inWindow) {
      const w = h.confidence === "high" ? 0.25 : h.confidence === "low" ? 0.08 : 0.15;
      nasaBoost = Math.max(nasaBoost, w);
    }
  }

  let weatherBoost = 0;
  if (weather) {
    const hasFire = reports.some(r => r.claim === "fire_active");
    const hasFlood = reports.some(r => r.claim === "flood_active");
    if (hasFire && (weather.windSpeedKph ?? 0) > 30 && (weather.humidity ?? 100) < 30) weatherBoost = 0.12;
    if (hasFlood && ((weather.rainfall_mm_last_24h ?? 0) > 50 || (weather.humidity ?? 0) > 80)) weatherBoost = 0.12;
  }

  return Math.min(1.0, Math.max(0, reportSignal + nasaBoost + weatherBoost));
}

export async function alignNASAFirms(opts: { lat: number; lon: number; simulateTimeout?: boolean }): Promise<any[]> {
  if (opts.simulateTimeout) return [];
  return [];
}

export async function alignWeatherSignal(opts: { lat: number; lon: number; simulateFailure?: boolean }): Promise<any | null> {
  if (opts.simulateFailure) return null;
  return null;
}

export async function fuseSignals(input: {
  zone: string;
  crowdReports: Array<any>;
  nasa?: Array<any>;
  weather?: any;
}): Promise<{ compositeConfidence: number }> {
  const reports = input.crowdReports.map(r => ({ ...r, lon: r.lon ?? r.lng }));
  const confidence = computeCompositeConfidence({
    reports,
    nasa: input.nasa,
    weather: input.weather
  });
  return { compositeConfidence: confidence };
}
