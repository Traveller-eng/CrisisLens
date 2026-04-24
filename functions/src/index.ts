import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { demoReports, demoResources } from "../../shared/demo-data";
import { buildRecommendations, buildZoneClusters } from "../../shared/decision";
import type { AIAnalysis, CrisisReport, NasaSignal } from "../../shared/crisis";
import { computeFusedConfidence, conflictScore, decide, nasaConfidence, reportConfidence } from "../../shared/fusion";
import { buildAuditEntry } from "../../shared/audit-trail";
import {
  fetchFirmsHotspots,
  fetchGDACSFeed,
  fetchGdacsSignals,
  fetchWeatherRiskSignal,
  generateSyntheticReports,
  generateVerifiedCorrection
} from "./data-flow";
import { analyzeReport, analyzeReportText } from "./gemini";
import { analyzeReportVertex } from "./vertexEngine";
import { maskSensitiveData } from "./privacyEngine";
import { PubSub } from "@google-cloud/pubsub";

initializeApp();

const db = getFirestore();
const pubsub = new PubSub();
const TOPIC_NAME = "emergency-reports-queue";

type StoredReport = Record<string, unknown>;

function normalizeTimestamp(value: unknown): string {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    return candidate.toDate().toISOString();
  }

  return new Date().toISOString();
}

function normalizeReport(id: string, raw: StoredReport): CrisisReport {
  const triage = (raw.triage ?? raw.geminiOutput ?? {}) as Record<string, unknown>;
  const geo = (raw.geo ?? {}) as Record<string, unknown>;
  const conflicts = Array.isArray(raw.conflicts) ? raw.conflicts.length : Number(raw.contradictionSignals ?? 0);

  return {
    id,
    source: String(raw.source ?? raw.sourceName ?? raw.sourceType ?? "Live source"),
    sourceType:
      raw.sourceType === "verified_org" || raw.sourceType === "ngo" || raw.sourceType === "citizen" || raw.sourceType === "anonymous"
        ? raw.sourceType
        : "unknown",
    text: String(raw.text ?? raw.content ?? "Incoming report"),
    timestamp: normalizeTimestamp(raw.timestamp),
    lat: Number(raw.lat ?? geo.lat ?? 0),
    lng: Number(raw.lng ?? geo.lng ?? 0),
    zone: String(raw.zone ?? raw.zoneId ?? triage.location ?? "Unassigned Zone"),
    geminiOutput: {
      type:
        triage.type === "injury" || triage.type === "infrastructure" || triage.type === "shelter"
          ? triage.type
          : "flood",
      urgency: Number(triage.urgency ?? 0.5),
      needs: Array.isArray(triage.needs) && triage.needs.length > 0 ? (triage.needs as CrisisReport["geminiOutput"]["needs"]) : ["rescue"],
      tone: triage.tone === "emotional" || triage.tone === "exaggerated" ? triage.tone : "factual"
    },
    contradictionSignals: Number.isFinite(conflicts) ? conflicts : 0,
    claim: raw.claim === "negative" || raw.claim === "neutral" ? raw.claim : "positive",
    ai: raw.ai as AIAnalysis | undefined
  };
}

function mapAiTypeToCrisisType(type: AIAnalysis["type"]): CrisisReport["geminiOutput"]["type"] {
  if (type === "earthquake") {
    return "infrastructure";
  }

  if (type === "fire") {
    return "infrastructure";
  }

  if (type === "flood") {
    return "flood";
  }

  return "flood";
}

function mapAiNeeds(type: AIAnalysis["type"]): CrisisReport["geminiOutput"]["needs"] {
  if (type === "earthquake") {
    return ["medical", "rescue"];
  }

  if (type === "fire") {
    return ["rescue", "shelter"];
  }

  return ["rescue"];
}

async function getAllReports(): Promise<CrisisReport[]> {
  const snapshot = await db.collection("reports").get();
  return snapshot.docs.map((doc) => normalizeReport(doc.id, doc.data()));
}

function normalizeSignal(id: string, raw: StoredReport): NasaSignal {
  return {
    id,
    lat: Number(raw.lat ?? raw.latitude ?? 0),
    lng: Number(raw.lng ?? raw.longitude ?? 0),
    type: raw.type === "flood" ? "flood" : "heat",
    intensity: Number(raw.intensity ?? raw.frp ?? 0),
    confidence: Number(raw.confidence ?? 0.8),
    timestamp: normalizeTimestamp(raw.timestamp)
  };
}

async function getAllSignals(): Promise<NasaSignal[]> {
  const snapshot = await db.collection("signals").get();
  return snapshot.docs.map((doc) => normalizeSignal(doc.id, doc.data()));
}

async function syncGdacsSignals() {
  const gdacsSignals = await fetchGdacsSignals();
  const batch = db.batch();

  gdacsSignals.forEach((signal) => {
    const docId = `gdacs_${signal.eventId}`;
    const ref = db.collection("signals").doc(docId);
    batch.set(
      ref,
      {
        source: signal.source,
        eventId: signal.eventId,
        type: "flood",
        disasterType: signal.type,
        severity: signal.severity,
        confidence: signal.confidence,
        intensity: signal.intensity,
        lat: signal.lat,
        lng: signal.lng,
        description: signal.description,
        timestamp: signal.timestamp,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  });

  await batch.commit();
  return gdacsSignals;
}

async function syncWeatherSignals() {
  const zonesSnapshot = await db.collection("zones").get();
  const zoneCenters = zonesSnapshot.docs
    .map((doc) => doc.data() as { center?: { lat?: number; lng?: number } })
    .map((zone) => ({
      lat: Number(zone.center?.lat ?? 0),
      lng: Number(zone.center?.lng ?? 0)
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && (point.lat !== 0 || point.lng !== 0));

  const fallbackPoints = [
    { lat: 13.0827, lng: 80.2707 },
    { lat: 13.1986, lng: 80.1692 },
    { lat: 13.056, lng: 80.245 }
  ];

  const targets = (zoneCenters.length > 0 ? zoneCenters : fallbackPoints).slice(0, 6);
  const signals = await Promise.all(targets.map((point) => fetchWeatherRiskSignal(point.lat, point.lng)));
  const batch = db.batch();

  signals.forEach((signal) => {
    const docId = `weather_${signal.lat.toFixed(3)}_${signal.lng.toFixed(3)}`.replace(/\./g, "_");
    const ref = db.collection("signals").doc(docId);
    batch.set(
      ref,
      {
        ...signal,
        intensity: signal.riskScore,
        confidence: signal.riskScore,
        windDeg: signal.windDeg,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    );
  });

  await batch.commit();
  return signals;
}

async function writeDerivedState(reports: CrisisReport[], signals: NasaSignal[]) {
  const now = new Date();
  const zones = buildZoneClusters(reports, now);
  const batch = db.batch();

  const zonesCollection = db.collection("zones");
  const existingZones = await zonesCollection.get();
  existingZones.docs.forEach((doc) => batch.delete(doc.ref));

  const recommendations = zones
    .map((zone) => {
      const zoneSignals = signals.filter(
        (signal) => Math.abs(signal.lat - zone.lat) <= 0.08 && Math.abs(signal.lng - zone.lng) <= 0.08
      );
      const crowdScore = reportConfidence(zone.reports, now.getTime());
      const nasaScore = nasaConfidence(zoneSignals, now.getTime());
      const conflict = conflictScore(zone.reports);
      const fusion = computeFusedConfidence(crowdScore, nasaScore, conflict, {
        scenarioType: zone.reports[0]?.geminiOutput.type === "flood" ? "flood" : zone.reports[0]?.geminiOutput.type === "infrastructure" ? "earthquake" : "mixed",
        weatherSignal: 0
      });
      const finalConfidence = fusion.finalConfidence;
      const decision = decide(finalConfidence);

      return {
        zone,
        zoneSignals,
        crowdScore,
        nasaScore,
        conflict,
        fusion,
        finalConfidence,
        decision
      };
    })
    .sort((a, b) => b.finalConfidence - a.finalConfidence)
    .map((item, index) => {
      const action =
        item.decision === "DISPATCH"
          ? `Deploy ${item.zone.dominantNeeds[0] === "medical" ? "medical" : "rescue"} units`
          : item.decision === "VERIFY"
            ? "VERIFY + LIMITED RESPONSE"
            : "DO NOT DISPATCH";

      return {
        rank: index + 1,
        action,
        zone: item.zone.zone,
        confidence: Number(item.finalConfidence.toFixed(2)),
        rationale: `reports ${item.crowdScore.toFixed(2)} | nasa ${item.nasaScore.toFixed(2)} | conflict ${item.conflict.toFixed(2)}${item.fusion.correlationAdjustments.length ? ` | ${item.fusion.correlationAdjustments[0]}` : ""}`
      };
    });

  zones.forEach((zone) => {
    const zoneSignals = signals.filter(
      (signal) => Math.abs(signal.lat - zone.lat) <= 0.08 && Math.abs(signal.lng - zone.lng) <= 0.08
    );
    const crowdScore = reportConfidence(zone.reports, now.getTime());
    const nasaScore = nasaConfidence(zoneSignals, now.getTime());
    const conflict = conflictScore(zone.reports);
    const fusion = computeFusedConfidence(crowdScore, nasaScore, conflict, {
      scenarioType: zone.reports[0]?.geminiOutput.type === "flood" ? "flood" : zone.reports[0]?.geminiOutput.type === "infrastructure" ? "earthquake" : "mixed",
      weatherSignal: 0
    });
    const finalConfidence = fusion.finalConfidence;
    const decision = decide(finalConfidence);
    const zoneRef = zonesCollection.doc(zone.zone);
    const conflictingReports = zone.reports.filter((report) => (report.contradictionSignals ?? 0) > 0 || report.claim === "negative");
    batch.set(zoneRef, {
      zoneId: zone.zone,
      center: { lat: zone.lat, lng: zone.lng },
      reports: zone.reports.map((report) => report.id),
      trustScore: Number(zone.trustScore.toFixed(3)),
      urgencyScore: Number(zone.urgencyScore.toFixed(3)),
      finalConfidence: Number(finalConfidence.toFixed(3)),
      conflictScore: Number(conflict.toFixed(3)),
      conflictPenalty: Number(fusion.conflictPenalty.toFixed(3)),
      reportConfidence: Number(crowdScore.toFixed(3)),
      nasaConfidence: Number(nasaScore.toFixed(3)),
      nasaConfirmed: zoneSignals.length > 0,
      correlationAdjustments: fusion.correlationAdjustments,
      decision,
      needs: zone.dominantNeeds,
      conflictLevel: conflict > 0.66 ? "HIGH" : conflict > 0.33 ? "MEDIUM" : "LOW",
      affectedEstimate: zone.affectedEstimate,
      breakdown: {
        reportWeight: Number(fusion.weights.report.toFixed(3)),
        nasaWeight: Number(fusion.weights.nasa.toFixed(3)),
        weatherWeight: Number(fusion.weights.weather.toFixed(3)),
        conflictPenalty: Number(fusion.conflictPenalty.toFixed(3)),
        correlationAdjustments: fusion.correlationAdjustments,
        conflictCount: conflictingReports.length,
        nasaActive: zoneSignals.length > 0
      },
      updatedAt: now.toISOString()
    });
  });

  const decisionsRef = db.collection("decisions").doc("latest");
  batch.set(decisionsRef, {
    timestamp: now.toISOString(),
    recommendations
  });

  batch.set(db.collection("system_state").doc("latest"), {
    timestamp: now.toISOString(),
    reportsCount: reports.length,
    signalsCount: signals.length,
    zonesCount: zones.length,
    recommendationCount: recommendations.length
  });

  await batch.commit();

  await Promise.all(
    recommendations.slice(0, 3).map((recommendation) =>
      db.collection("audit").add(
        buildAuditEntry({
          sessionId: "local-demo",
          zoneId: recommendation.zone,
          eventType: "RECOMMENDATION_ISSUED",
          systemRecommendation: recommendation.action,
          systemConfidence: recommendation.confidence,
          systemReasoning: recommendation.rationale,
          operatorId: "demo-operator"
        })
      )
    )
  );
}

async function appendEvent(input: {
  type: string;
  entity: string;
  title: string;
  detail: string;
  level: "info" | "alert" | "resolve";
  oldValue?: number | null;
  newValue?: number | null;
}) {
  await db.collection("events").add({
    ...input,
    timestamp: new Date().toISOString()
  });
}

export const health = onRequest((request, response) => {
  response.json({
    ok: true,
    service: "crisislens-functions",
    message: "Cloud Functions starter is running",
    method: request.method
  });
});

export const demoState = onRequest((_request, response) => {
  const now = new Date("2026-04-09T08:18:00.000Z");

  response.json({
    reports: demoReports,
    zones: buildZoneClusters(demoReports, now),
    recommendations: buildRecommendations(demoReports, demoResources, now)
  });
});

export const ingestStub = onRequest((request, response) => {
  response.json({
    nextStep: "Replace this stub with GDACS, ReliefWeb, and Gemini ingestion logic.",
    received: request.body ?? null,
    requiredSecrets: ["GEMINI_API_KEY"],
    todo: [
      "Fetch raw crisis reports from external sources",
      "Normalize schema into report objects",
      "Call Gemini Flash for triage and contradiction checks",
      "Persist reports into Firestore",
      "Emit analytics to BigQuery"
    ]
  });
});

export const fetchGDACS = onRequest(async (_request, response) => {
  try {
    const feed = await fetchGDACSFeed();
    response.json({
      ok: true,
      source: "GDACS",
      preview: feed.slice(0, 1200)
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch GDACS feed"
    });
  }
});

export const fetchGDACSSignals = onRequest(async (_request, response) => {
  try {
    const signals = await syncGdacsSignals();
    response.json({
      ok: true,
      source: "GDACS",
      count: signals.length,
      signals
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch GDACS signals"
    });
  }
});

export const syncGDACSSignalsEveryFiveMinutes = onSchedule("every 5 minutes", async () => {
  try {
    const signals = await syncGdacsSignals();
    await appendEvent({
      type: "GDACS_SYNC",
      entity: "signals:gdacs",
      title: "GDACS sync complete",
      detail: `${signals.length} flood signals refreshed from GDACS`,
      level: "info"
    });
  } catch (error) {
    await appendEvent({
      type: "GDACS_SYNC_FAILED",
      entity: "signals:gdacs",
      title: "GDACS sync failed",
      detail: error instanceof Error ? error.message.slice(0, 280) : "Unknown GDACS sync error",
      level: "alert"
    });
    throw error;
  }
});

export const fetchWeatherSignals = onRequest(async (_request, response) => {
  try {
    const signals = await syncWeatherSignals();
    response.json({
      ok: true,
      source: "WEATHER",
      count: signals.length,
      signals
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch weather signals"
    });
  }
});

export { analyzeReport };

export const syncWeatherSignalsEveryFiveMinutes = onSchedule("every 5 minutes", async () => {
  try {
    const signals = await syncWeatherSignals();
    await appendEvent({
      type: "WEATHER_SYNC",
      entity: "signals:weather",
      title: "Weather sync complete",
      detail: `${signals.length} weather risk signals refreshed`,
      level: "info"
    });
  } catch (error) {
    await appendEvent({
      type: "WEATHER_SYNC_FAILED",
      entity: "signals:weather",
      title: "Weather sync failed",
      detail: error instanceof Error ? error.message.slice(0, 280) : "Unknown weather sync error",
      level: "alert"
    });
    throw error;
  }
});

export const injectSyntheticReports = onRequest(async (request, response) => {
  const count = Number(request.query.count ?? request.body?.count ?? 24);
  const zone = String(request.query.zone ?? request.body?.zone ?? "Zone A");
  const reports = generateSyntheticReports(count, zone);
  const batch = db.batch();

  reports.forEach((report) => {
    const ref = db.collection("reports").doc();
    batch.set(ref, report);
  });

  await batch.commit();

  response.json({
    ok: true,
    inserted: reports.length,
    zone
  });
});

export const injectVerifiedCorrection = onRequest(async (request, response) => {
  const zone = String(request.query.zone ?? request.body?.zone ?? "Zone B");
  const report = generateVerifiedCorrection(zone);
  const ref = await db.collection("reports").add(report);

  response.json({
    ok: true,
    reportId: ref.id,
    zone
  });
});

export const fetchFIRMS = onRequest(async (_request, response) => {
  try {
    const hotspots = await fetchFirmsHotspots();
    const existing = await db.collection("signals").get();
    const batch = db.batch();
    existing.docs.forEach((doc) => batch.delete(doc.ref));
    hotspots.forEach((hotspot, index) => {
      const ref = db.collection("signals").doc(`firms-${index}`);
      batch.set(ref, {
        lat: hotspot.latitude,
        lng: hotspot.longitude,
        type: "heat",
        intensity: Math.min(1, hotspot.frp / 50),
        confidence:
          hotspot.confidence === "h"
            ? 0.9
            : hotspot.confidence === "n"
              ? 0.6
              : Number(String(hotspot.confidence).replace(/[^0-9.]/g, "")) / 100 || 0.7,
        timestamp: new Date().toISOString()
      });
    });
    await batch.commit();
    const reports = await getAllReports();
    const signals = await getAllSignals();
    await writeDerivedState(reports, signals);
    response.json({
      ok: true,
      source: "NASA FIRMS",
      count: hotspots.length,
      hotspots
    });
  } catch (error) {
    const maybeAxiosError = error as {
      message?: string;
      response?: {
        status?: number;
        statusText?: string;
        data?: unknown;
      };
    };
    response.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch FIRMS hotspots",
      upstreamStatus: maybeAxiosError.response?.status ?? null,
      upstreamStatusText: maybeAxiosError.response?.statusText ?? null,
      upstreamBody:
        typeof maybeAxiosError.response?.data === "string"
          ? maybeAxiosError.response.data.slice(0, 800)
          : maybeAxiosError.response?.data ?? null
    });
  }
});

export const onReportWrite = onDocumentWritten("reports/{reportId}", async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as StoredReport) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as StoredReport) : null;
  const reportId = event.params.reportId;

  if (after && !after.ai && typeof after.text === "string" && after.text.trim()) {
    try {
      // Step 1: DLP Privacy Shield — strip PII before any AI processing
      const safeText = await maskSensitiveData(after.text);

      // Step 2: Vertex AI enterprise semantic analysis
      const vertexResult = await analyzeReportVertex(safeText);

      // Step 3: Gemini crisis classification pipeline
      const ai = await analyzeReportText(safeText);
      const triage = {
        type: mapAiTypeToCrisisType(ai.type),
        urgency: ai.severity,
        needs: mapAiNeeds(ai.type),
        tone: "factual" as const,
        location: String(after.zone ?? after.zoneId ?? "Unassigned Zone")
      };

      await db.collection("reports").doc(reportId).set(
        {
          ai,
          claim: ai.claim,
          triage,
          vertexAnalysis: vertexResult
        },
        { merge: true }
      );

      await appendEvent({
        type: "AI_ANALYSIS_COMPLETE",
        entity: `report:${reportId}`,
        title: "AI structured output ready (DLP → Vertex → Gemini)",
        detail: `${ai.type} | confidence ${ai.confidence.toFixed(2)} | vertex credibility ${vertexResult.credibility ?? "N/A"} | risk: ${vertexResult.risk_flag ?? "unknown"}`,
        level: "resolve"
      });
    } catch (error) {
      await appendEvent({
        type: "AI_ANALYSIS_FAILED",
        entity: `report:${reportId}`,
        title: "AI analysis failed",
        detail: error instanceof Error ? error.message.slice(0, 280) : "Unknown Gemini/Vertex analysis error",
        level: "alert"
      });
    }

    return;
  }

  if (after) {
    await appendEvent({
      type: before ? "TRUST_UPDATE" : "REPORT_RECEIVED",
      entity: `report:${reportId}`,
      title: before ? "Trust updated" : "Report received",
      detail: `${String(after.zone ?? after.zoneId ?? "Unknown zone")} | ${String(after.source ?? after.sourceType ?? "source")}`,
      level: after.sourceType === "anonymous" ? "alert" : "info",
      oldValue: typeof before?.trust === "object" && before?.trust ? Number((before.trust as { score?: unknown }).score ?? 0) : null,
      newValue: typeof after?.trust === "object" && after?.trust ? Number((after.trust as { score?: unknown }).score ?? 0) : null
    });
  }

  if (!after && before) {
    await appendEvent({
      type: "REPORT_REMOVED",
      entity: `report:${reportId}`,
      title: "Report removed",
      detail: `${String(before.zone ?? before.zoneId ?? "Unknown zone")} removed from active pipeline`,
      level: "resolve"
    });
  }

  const reports = await getAllReports();
  const signals = await getAllSignals();
  await writeDerivedState(reports, signals);

  const zones = buildZoneClusters(reports, new Date());
  const unstableZones = zones.filter((zone) => zone.trustScore < 0.45);

  for (const zone of unstableZones) {
    await appendEvent({
      type: "CONFLICT_DETECTED",
      entity: `zone:${zone.zone}`,
      title: "Conflict detected",
      detail: `${zone.zone} dropped into high uncertainty due to contradictory or low-trust reports`,
      level: "alert",
      newValue: Number(zone.trustScore.toFixed(3))
    });
  }

  const latestRecommendations = buildRecommendations(reports, demoResources, new Date());
  if (latestRecommendations[0]) {
    await appendEvent({
      type: "DECISION_UPDATED",
      entity: `decision:${latestRecommendations[0].zone}`,
      title: "Decision updated",
      detail: `Top recommendation is now ${latestRecommendations[0].action} for ${latestRecommendations[0].zone}`,
      level: latestRecommendations[0].flag ? "alert" : "resolve",
      newValue: latestRecommendations[0].confidence
    });
  }
});

import * as fs from "fs";
import * as path from "path";

export const fetchSuppressionMetric = onRequest({ cors: true, maxInstances: 10 }, async (req, res) => {
  try {
    const metricPath = path.join(__dirname, "../../tests/.last-metric.json");
    if (fs.existsSync(metricPath)) {
      const data = fs.readFileSync(metricPath, "utf8");
      res.status(200).json(JSON.parse(data));
    } else {
      res.status(404).json({ error: "Metric not generated. Run npm run extract-metric" });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * THE SHOCK ABSORBER (Pub/Sub Ingestion Endpoint)
 * The React frontend posts to this URL. It queues the message and returns immediately.
 * Zero latency for the citizen — the heavy AI processing happens in the background.
 */
export const ingestReport = onRequest({ cors: true }, async (req, res) => {
  try {
    const reportData = req.body;

    if (!reportData || !reportData.text) {
      res.status(400).json({ error: "Report text is required." });
      return;
    }

    const dataBuffer = Buffer.from(JSON.stringify(reportData));
    await pubsub.topic(TOPIC_NAME).publishMessage({ data: dataBuffer });

    res.status(200).json({
      status: "queued",
      message: "Report received and queued for secure AI processing."
    });
  } catch (error) {
    console.error("Pub/Sub Ingestion Error:", error);
    res.status(500).json({ error: "Failed to queue report." });
  }
});

/**
 * THE HEAVY LIFTER (Pub/Sub Background Worker)
 * Automatically triggered by GCP when a new message hits the queue.
 * Runs: DLP Privacy Shield → Vertex AI Semantic Analysis → Firestore Write
 */
export const processReportWorker = onMessagePublished(TOPIC_NAME, async (event) => {
  try {
    const rawMessage = event.data.message.json as { text?: string; location?: string };
    console.log("Worker pulled report from queue:", rawMessage);

    const rawText = rawMessage.text || "";

    // Phase 1: Privacy Shield (Strip PII)
    const safeText = await maskSensitiveData(rawText);
    console.log("DLP Scrubbing complete.");

    // Phase 2: Vertex AI Semantic Reasoning
    const aiAnalysis = await analyzeReportVertex(safeText);
    console.log("Vertex AI Analysis complete.", aiAnalysis);

    // Phase 3: Action Execution (Save to Firestore — triggers onReportWrite for zone updates)
    await db.collection("reports").add({
      text: safeText,
      source: "Pub/Sub Ingestion",
      sourceType: "citizen",
      location: rawMessage.location || "Unknown",
      zone: rawMessage.location || "Zone A",
      timestamp: new Date().toISOString(),
      vertexAnalysis: aiAnalysis,
      decision: (aiAnalysis.credibility > 0.8 && !aiAnalysis.risk_flag.includes("contradiction")) ? "DISPATCH" : "HOLD",
      status: "processed"
    });

    console.log("Report fully processed and written to reality layer.");
  } catch (error) {
    console.error("Worker processing failed:", error);
  }
});
