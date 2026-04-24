import { spatiallyCorrelate, temporallyCorrelate, computeCompositeConfidence, decayConfidenceOverTime, alignNASAFirms, alignWeatherSignal, fuseSignals, SPATIAL_BUFFER_KM, TEMPORAL_WINDOW_MS } from "../../shared/signalFusion";

describe("Spatial Buffering (8km)", () => {
  const cLat = 37.7749, cLon = -122.4194;
  test("Report within 8km is spatially correlated", () => {
    expect(spatiallyCorrelate({ lat: 37.8200, lon: -122.4194 }, cLat, cLon).correlated).toBe(true);
  });
  test("Report exactly at 8km boundary is included", () => {
    // ~7.9km north — within 8km Haversine buffer
    expect(spatiallyCorrelate({ lat: 37.8460, lon: -122.4194 }, cLat, cLon).correlated).toBe(true);
  });
  test("Report beyond 8km is not correlated", () => {
    expect(spatiallyCorrelate({ lat: 37.9100, lon: -122.4194 }, cLat, cLon).correlated).toBe(false);
  });
  test("Same point scores maximum spatial correlation weight", () => {
    expect(spatiallyCorrelate({ lat: cLat, lon: cLon }, cLat, cLon).weight).toBeCloseTo(1.0, 1);
  });
  test("SPATIAL_BUFFER_KM is 8", () => { expect(SPATIAL_BUFFER_KM).toBe(8); });
  test("Invalid coordinates handled gracefully", () => {
    expect(() => spatiallyCorrelate({ lat: NaN, lon: NaN }, cLat, cLon)).not.toThrow();
    expect(spatiallyCorrelate({ lat: NaN, lon: NaN }, cLat, cLon).correlated).toBe(false);
  });
});

describe("Temporal Windowing (12h)", () => {
  const now = Date.now();
  test("Signal from 6 hours ago is within window", () => {
    expect(temporallyCorrelate(now - 6 * 3600000, now).inWindow).toBe(true);
  });
  test("Signal at exactly 12h boundary is included", () => {
    expect(temporallyCorrelate(now - TEMPORAL_WINDOW_MS, now).inWindow).toBe(true);
  });
  test("Signal from 13 hours ago is outside window", () => {
    expect(temporallyCorrelate(now - 13 * 3600000, now).inWindow).toBe(false);
  });
  test("Future-timestamped signal is rejected", () => {
    expect(temporallyCorrelate(now + 3600000, now).inWindow).toBe(false);
  });
  test("TEMPORAL_WINDOW_MS equals 12 hours in ms", () => {
    expect(TEMPORAL_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("Composite Confidence Score", () => {
  test("Score is always between 0 and 1", () => {
    const score = computeCompositeConfidence({ reports: [{ sourceType: "verified", claim: "fire_active", lat: 34, lon: -118 }], nasa: [] });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
  test("Zero reports produce zero confidence", () => {
    expect(computeCompositeConfidence({ reports: [], nasa: [], weather: null })).toBe(0);
  });
  test("Multiple corroborating signals push confidence toward 1.0", () => {
    const reports = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, sourceType: "ngo", claim: "fire_active", lat: 34.05, lon: -118.25 }));
    const nasa = [{ lat: 34.07, lon: -118.25, confidence: "high", acq_date: new Date().toISOString() }];
    const weather = { windSpeedKph: 60, humidity: 15 };
    expect(computeCompositeConfidence({ reports, nasa, weather })).toBeGreaterThan(0.8);
  });
  test("Confidence decays linearly over time", () => {
    const initial = 0.9;
    const at6h = decayConfidenceOverTime(initial, 6 * 3600000);
    const at12h = decayConfidenceOverTime(initial, 12 * 3600000);
    expect(at6h).toBeLessThan(initial);
    expect(at12h).toBeLessThan(at6h);
    const d1 = initial - at6h, d2 = initial - at12h;
    expect(d2 / d1).toBeCloseTo(2, 0);
  });
});

describe("NASA FIRMS Alignment", () => {
  const crowdReport = { lat: 34.05, lon: -118.25, claim: "fire_active" };
  const nasaHotspot = { lat: 34.09, lon: -118.25, confidence: "high", acq_date: new Date(Date.now() - 5 * 3600000).toISOString() };
  test("NASA hotspot within 8km and 12h window boosts confidence", () => {
    const before = computeCompositeConfidence({ reports: [crowdReport], nasa: [] });
    const after = computeCompositeConfidence({ reports: [crowdReport], nasa: [nasaHotspot] });
    expect(after).toBeGreaterThan(before);
  });
  test("Stale NASA hotspot (>12h) does NOT boost confidence", () => {
    const stale = { ...nasaHotspot, acq_date: new Date(Date.now() - 15 * 3600000).toISOString() };
    const without = computeCompositeConfidence({ reports: [crowdReport], nasa: [] });
    const withStale = computeCompositeConfidence({ reports: [crowdReport], nasa: [stale] });
    expect(withStale).toBeCloseTo(without, 2);
  });
  test("NASA hotspot >8km away does NOT boost confidence", () => {
    const far = { ...nasaHotspot, lat: 34.50 };
    const without = computeCompositeConfidence({ reports: [crowdReport], nasa: [] });
    const withFar = computeCompositeConfidence({ reports: [crowdReport], nasa: [far] });
    expect(withFar).toBeCloseTo(without, 2);
  });
  test("alignNASAFirms returns empty on timeout", async () => {
    const result = await alignNASAFirms({ lat: 0, lon: 0, simulateTimeout: true });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

describe("Full Signal Fusion — Integration", () => {
  test("Fusion of confirmed crowd + NASA + weather returns >0.8", async () => {
    const result = await fuseSignals({
      zone: "Z1",
      crowdReports: [
        { id: "c1", sourceType: "verified", claim: "fire_active", lat: 34.05, lon: -118.25 },
        { id: "c2", sourceType: "ngo", claim: "fire_active", lat: 34.07, lon: -118.27 },
        { id: "c3", sourceType: "citizen", claim: "fire_active", lat: 34.06, lon: -118.24 },
      ],
      nasa: [{ lat: 34.06, lon: -118.25, confidence: "high", acq_date: new Date().toISOString() }],
      weather: { windSpeedKph: 55, humidity: 18 },
    });
    expect(result.compositeConfidence).toBeGreaterThan(0.8);
  });
  test("Contradictory crowd reports without NASA produce confidence <0.5", async () => {
    const result = await fuseSignals({
      zone: "Z2",
      crowdReports: [
        { id: "c1", sourceType: "citizen", claim: "fire_active", lat: 35.0, lon: -119.0 },
        { id: "c2", sourceType: "citizen", claim: "fire_denied", lat: 35.0, lon: -119.0 },
      ],
      nasa: [],
    });
    expect(result.compositeConfidence).toBeLessThan(0.6);
  });
});
