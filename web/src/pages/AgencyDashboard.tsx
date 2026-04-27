import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { buildRecommendations, buildZoneClusters } from "../../../shared/decision";
import { demoReports, demoResources } from "../../../shared/demo-data";
import type { AIAnalysis, CrisisReport, Recommendation, ScoredReport, ZoneCluster } from "../../../shared/crisis";
import { clamp, computeFusedConfidence, conflictScore as computeConflictScore, decide } from "../../../shared/fusion";
import type { ZoneConfidenceBreakdown } from "../../../shared/zone-update";
import { buildAuditEntry, buildSessionId, validateOperatorAction } from "../../../shared/audit-trail";
import { appConfig, setupChecklist } from "../config";
import { db, firebaseEnabled, functionsClient } from "../lib/firebase";
import { normalizeReport } from "../lib/live-reports";
import AIPanel from "../components/AIPanel";
import { analyzeReportDirect, geminiDirectAvailable, getPrecomputedAi } from "../lib/gemini-direct";
import { triggerGoogleChatAlert } from "../lib/chatWebhook";

const LiveMap = lazy(() => import("../components/LiveMap"));

const simulationStart = new Date("2026-04-09T08:00:00.000Z");
const simulationDurationSeconds = 180;
const MAX_AI_CONCURRENCY = 2;
const AI_QUEUE_INTERVAL_MS = 2200;

type FeedEvent = {
  id: string;
  minute?: number;
  label: string;
  detail: string;
  tone: "info" | "alert" | "resolve";
};

type AiStage = "raw" | "queued" | "processing" | "refined" | "fallback";

type DerivedZone = {
  zoneId: string;
  center: { lat: number; lng: number };
  reports: string[];
  trustScore: number;
  urgencyScore: number;
  finalConfidence: number;
  conflictScore: number;
  reportConfidence: number;
  nasaConfidence: number;
  nasaConfirmed: boolean;
  decision: "DISPATCH" | "VERIFY" | "HOLD";
  needs: string[];
  conflictLevel: string;
  affectedEstimate: number;
  breakdown: ZoneConfidenceBreakdown;
};

type NasaHotspot = {
  latitude: number;
  longitude: number;
  confidence: string;
  frp: number;
};

type WeatherSignal = {
  lat: number;
  lng: number;
  rain: number;
  humidity: number;
  wind: number;
  pressure: number;
  riskScore: number;
  timestamp: number;
  windDeg?: number;
};

type SimulationProfile = {
  zone: string;
  sourceType: CrisisReport["sourceType"];
  type: CrisisReport["geminiOutput"]["type"];
  tone: CrisisReport["geminiOutput"]["tone"];
  urgency: number;
  text: string;
  contradictionSignals: number;
  claim: NonNullable<CrisisReport["claim"]>;
  baseCoords: { lat: number; lng: number };
};

const analyzeReportCallable = functionsClient
  ? httpsCallable<{ text: string }, AIAnalysis>(functionsClient, "analyzeReport")
  : null;

type ScenarioKey = "flood" | "earthquake" | "cyclone" | "custom";

const scenarioMeta: Record<ScenarioKey, { title: string; city: string; label: string }> = {
  flood: { title: "Flood in Chennai", city: "Chennai", label: "Flood" },
  earthquake: { title: "Earthquake Response", city: "Guwahati", label: "Earthquake" },
  cyclone: { title: "Cyclone Landfall", city: "Visakhapatnam", label: "Cyclone" },
  custom: { title: "Custom Scenario", city: "Operator Defined", label: "Custom" }
};

const pipelineSteps = [
  {
    title: "Incoming Report",
    text: "Raw field signal enters the system from crowd, NGO, or verified source."
  },
  {
    title: "Triage",
    text: "The report is classified by incident type, urgency, and likely resource need."
  },
  {
    title: "Trust Score",
    text: "Source quality, tone, timing, and agreement are fused into a confidence score."
  },
  {
    title: "Conflict Check",
    text: "Nearby reports are compared to detect contradictions and misinformation risk."
  },
  {
    title: "Zone Update",
    text: "Signals are grouped spatially so each zone gets a live trust and urgency state."
  },
  {
    title: "Decision Update",
    text: "Recommendations reorder automatically as evidence strengthens or collapses."
  }
] as const;

function scoreBadgeClass(score: number): string {
  if (score >= 0.75) {
    return "badge badge--verified";
  }

  if (score >= 0.45) {
    return "badge badge--uncertain";
  }

  return "badge badge--false";
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `T+${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getFunctionUrl(name: string): string {
  if (appConfig.emulators.enabled) {
    return `http://${appConfig.emulators.firestoreHost}:5005/${appConfig.firebase.projectId}/us-central1/${name}`;
  }

  return `https://us-central1-${appConfig.firebase.projectId}.cloudfunctions.net/${name}`;
}

async function fetchFunctionJson<T>(name: string): Promise<T> {
  const response = await fetch(getFunctionUrl(name));
  const text = await response.text();
  let payload: unknown = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail =
      typeof payload === "string"
        ? payload
        : typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : `HTTP ${response.status}`;
    throw new Error(`${name} failed: ${detail}`);
  }

  return payload as T;
}

function toSimulationSecond(timestamp: string): number {
  return Math.max(0, Math.round((new Date(timestamp).getTime() - simulationStart.getTime()) / 1000));
}

function buildFeedEvents(): FeedEvent[] {
  const reportEvents: FeedEvent[] = demoReports.map((report): FeedEvent => ({
    id: `${report.id}-ingest`,
    minute: toSimulationSecond(report.timestamp),
    label: "Report received",
    detail: `${report.zone} | ${report.source} | ${report.geminiOutput.type}`,
    tone: report.sourceType === "anonymous" ? "alert" : "info"
  }));

  const systemEvents: FeedEvent[] = [
    {
      id: "boot",
      minute: 0,
      label: "System online",
      detail: "Simulation, trust engine, and decision loop activated",
      tone: "resolve"
    },
    {
      id: "triage",
      minute: 5,
      label: "Triage complete",
      detail: "Incoming reports classified and urgency normalized",
      tone: "info"
    },
    {
      id: "conflict-b",
      minute: 10,
      label: "Conflict detected",
      detail: "Zone B enters uncertainty after contradictory infrastructure evidence",
      tone: "alert"
    },
    {
      id: "decision-drift",
      minute: 11,
      label: "Decision drift",
      detail: "Zone B dispatch confidence drops and ranking changes",
      tone: "alert"
    },
    {
      id: "stabilize",
      minute: 14,
      label: "System corrected",
      detail: "Verified evidence stabilizes recommendations and suppresses misinformation",
      tone: "resolve"
    }
  ];

  return [...systemEvents, ...reportEvents].sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0));
}

function mapAiTypeToCrisisType(type: AIAnalysis["type"]): CrisisReport["geminiOutput"]["type"] {
  if (type === "earthquake" || type === "fire" || type === "infrastructure") {
    return "infrastructure";
  }

  if (type === "injury") {
    return "injury";
  }

  if (type === "shelter" || type === "supply") {
    return "shelter";
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

  if (type === "injury") {
    return ["medical"];
  }

  if (type === "shelter" || type === "supply") {
    return ["shelter", "food"];
  }

  return ["rescue"];
}

function mergeAiAnalysis(report: CrisisReport, ai: AIAnalysis): CrisisReport {
  return {
    ...report,
    ai,
    claim: ai.claim,
    contradictionSignals: ai.claim === "negative" ? Math.max(report.contradictionSignals ?? 0, 1) : report.contradictionSignals,
    geminiOutput: {
      ...report.geminiOutput,
      type: mapAiTypeToCrisisType(ai.type),
      urgency: Number(ai.severity.toFixed(2)),
      needs: mapAiNeeds(ai.type),
      tone: report.sourceType === "anonymous" && ai.claim === "negative" ? "exaggerated" : report.geminiOutput.tone
    }
  };
}

function buildFallbackAnalysis(report: CrisisReport): AIAnalysis {
  return {
    type: report.geminiOutput.type === "injury" ? "injury" : report.geminiOutput.type === "shelter" ? "shelter" : report.geminiOutput.type,
    severity: report.geminiOutput.urgency,
    confidence: 0.35,
    claim: report.claim ?? "positive",
    entities: [report.zone],
    urgency: report.geminiOutput.urgency,
    reasoning: "Heuristic fallback kept the report in flow because Gemini did not respond in time.",
    contradictionSignal: report.contradictionSignals ? "high" : "none",
    isFallback: true
  };
}

function dedupeReports(existing: CrisisReport[], incoming: CrisisReport[]): CrisisReport[] {
  const seenKeyToReport = new Map<string, CrisisReport>();

  [...existing, ...incoming].forEach((report) => {
    const timeBucket = Math.floor(new Date(report.timestamp).getTime() / 30000);
    const key = `${report.zone}|${report.sourceType}|${report.text.trim().toLowerCase().replace(/\s+/g, " ")}|${timeBucket}`;
    if (!seenKeyToReport.has(key)) {
      seenKeyToReport.set(key, report);
    }
  });

  return Array.from(seenKeyToReport.values());
}

function simulationProfile(index: number, scenario: ScenarioKey): SimulationProfile | null {
  if (scenario !== "flood") {
    return null;
  }

  const step = index % 18;

  // Phase A (steps 0-5): Zone A — high-trust flood reports → DISPATCH
  if (step <= 5) {
    const texts = [
      "Water rising fast near riverbank homes in Zone A",
      "Floodwater entering streets near shelters, multiple families affected",
      "Rescue support needed for stranded families near Zone A bridge",
      "Verified NDRF update: rescue boats deployed in Zone A sector",
      "NGO field team confirms widespread flooding and evacuation need",
      "Verified command: Zone A flood confirmed, rescue operations underway"
    ];
    return {
      zone: "Zone A",
      sourceType: step >= 3 ? "verified_org" : "ngo",
      type: "flood" as const,
      tone: "factual" as const,
      urgency: 0.78 + step * 0.03,
      text: texts[step],
      contradictionSignals: 0,
      claim: "positive" as const,
      baseCoords: { lat: 13.0827, lng: 80.2707 }
    };
  }

  // Phase B (steps 6-11): Zone B — mixed signals, contradiction → VERIFY / PARTIAL RESPONSE
  if (step <= 11) {
    const slot = step - 6;
    const texts = [
      "Airport flooded, hundreds stranded on approach roads",
      "Bridge collapsed near airport, total access lost",
      "Local volunteer reports partial flooding near terminal",
      "People trapped near airport approach, conflicting details",
      "NGO liaison: airport operational with minor waterlogging only",
      "Verified correction: airport operational, no full flooding observed"
    ];
    return {
      zone: "Zone B",
      sourceType: slot >= 4 ? (slot === 5 ? "verified_org" : "ngo") : "anonymous",
      type: "infrastructure" as const,
      tone: slot >= 4 ? ("factual" as const) : slot >= 2 ? ("exaggerated" as const) : ("emotional" as const),
      urgency: slot >= 4 ? 0.35 : 0.58 + slot * 0.06,
      text: texts[slot],
      contradictionSignals: slot >= 4 ? 0 : 2,
      claim: slot >= 4 ? ("positive" as const) : ("negative" as const),
      baseCoords: { lat: 13.1986, lng: 80.1692 }
    };
  }

  // Phase C (steps 12-17): Zone C — misinformation burst → DO NOT DISPATCH
  const slot = step - 12;
  const texts = [
    "BREAKING: dam burst imminent, Zone C will be completely submerged",
    "Unconfirmed surge report spreading on social media for Zone C",
    "Anonymous tip: massive chemical leak in Zone C floodwater",
    "Rumor mill: Zone C shelters destroyed, hundreds missing",
    "Panic reports: Zone C roads and bridges all collapsed",
    "Social media frenzy: Zone C declared total disaster zone by unknown source"
  ];
  return {
    zone: "Zone C",
    sourceType: "anonymous",
    type: "flood" as const,
    tone: "exaggerated" as const,
    urgency: 0.92 - slot * 0.02,
    text: texts[slot],
    contradictionSignals: 3,
    claim: "negative" as const,
    baseCoords: { lat: 13.056, lng: 80.245 }
  };
}

function buildConfidenceStory(zone: DerivedZone | null, report: ScoredReport | null): string {
  if (!zone || !report) {
    return "Confidence breakdown appears when a zone and report are selected.";
  }

  const bd = zone.breakdown;
  const trustContrib = (report.trust.decayedTrust * bd.reportWeight);
  const nasaContrib = (zone.nasaConfidence * bd.nasaWeight);
  const penalty = bd.conflictPenalty;
  const parts: string[] = [];
  parts.push(`Trust input ${report.trust.decayedTrust.toFixed(2)} weighted at ${(bd.reportWeight * 100).toFixed(0)}% contributed ${trustContrib.toFixed(2)}`);
  if (bd.nasaActive) {
    parts.push(`satellite overlay added ${nasaContrib.toFixed(2)}`);
  } else {
    parts.push("no satellite layer active");
  }
  if (penalty > 0.01) {
    parts.push(`conflict penalty (${bd.conflictCount} signals) subtracted ${penalty.toFixed(2)}`);
  }
  if (bd.correlationAdjustments.length > 0) {
    parts.push(bd.correlationAdjustments[0]);
  }
  parts.push(`yielding final confidence ${zone.finalConfidence.toFixed(2)}`);
  return parts.join(", ") + ".";
}

function useSimulationClock() {
  const [minute, setMinute] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => {
        const next = current + speed;
        return next > simulationDurationSeconds ? 0 : next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isPlaying, speed]);

  return {
    minute: elapsedSeconds,
    setMinute: setElapsedSeconds,
    isPlaying,
    setIsPlaying,
    speed,
    setSpeed
  };
}

function getScenarioReports(scenario: ScenarioKey): CrisisReport[] {
  if (scenario === "earthquake") {
    return demoReports.map((report, index) => ({
      ...report,
      zone: index % 2 === 0 ? "Zone E" : "Zone F",
      text:
        index % 2 === 0
          ? "Structural damage reported after tremors, possible trapped residents."
          : "Medical aid needed near collapsed storefronts after aftershock.",
      geminiOutput: {
        ...report.geminiOutput,
        type: index % 2 === 0 ? "infrastructure" : "injury",
        urgency: Math.min(0.96, report.geminiOutput.urgency + 0.04)
      }
    }));
  }

  if (scenario === "cyclone") {
    return demoReports.map((report, index) => ({
      ...report,
      zone: index % 2 === 0 ? "Zone G" : "Zone H",
      text:
        index % 2 === 0
          ? "Cyclone winds damaging shelters near the coast."
          : "Storm surge reported with stranded families awaiting evacuation.",
      geminiOutput: {
        ...report.geminiOutput,
        type: index % 2 === 0 ? "shelter" : "flood",
        urgency: Math.min(0.98, report.geminiOutput.urgency + 0.05)
      }
    }));
  }

  if (scenario === "custom") {
    return demoReports.map((report) => ({
      ...report,
      zone: "Custom Zone",
      text: `Custom scenario input: ${report.text}`
    }));
  }

  return demoReports;
}

function getActiveState(minute: number, scenario: ScenarioKey) {
  const scenarioReports = getScenarioReports(scenario);
  const now = new Date(simulationStart.getTime() + minute * 60000);
  const visibleReports = scenarioReports.filter((report) => toSimulationSecond(report.timestamp) <= minute);
  const zones = buildZoneClusters(visibleReports, now);
  const recommendations = buildRecommendations(visibleReports, demoResources, now);
  const feedEvents = buildFeedEvents().filter((event) => (event.minute ?? 0) <= minute).slice(0, 8);

  return {
    now,
    visibleReports,
    zones,
    recommendations,
    feedEvents
  };
}

function generateSimulationReport(index: number, scenario: ScenarioKey, elapsedSeconds: number): CrisisReport {
  const profile = simulationProfile(index, scenario);
  if (profile) {
    return {
      id: `sim-${scenario}-${index}-${Date.now()}`,
      text: profile.text,
      source: profile.sourceType === "verified_org" ? "Verified Command" : profile.sourceType === "ngo" ? "NGO Field Desk" : `Crowd Reporter ${index}`,
      sourceType: profile.sourceType,
      lat: Number((profile.baseCoords.lat + ((index % 5) - 2) * 0.0016).toFixed(6)),
      lng: Number((profile.baseCoords.lng + ((index % 7) - 3) * 0.0014).toFixed(6)),
      zone: profile.zone,
      timestamp: new Date(simulationStart.getTime() + elapsedSeconds * 1000).toISOString(),
      geminiOutput: {
        type: profile.type,
        urgency: Number(profile.urgency.toFixed(2)),
        needs: profile.type === "shelter" ? ["shelter", "food"] : profile.type === "infrastructure" ? ["rescue"] : ["rescue", "medical"],
        tone: profile.tone
      },
      contradictionSignals: profile.contradictionSignals,
      claim: profile.claim
    };
  }

  const scenarioZones: Record<ScenarioKey, string[]> = {
    flood: ["Zone A", "Zone B", "Zone C"],
    earthquake: ["Zone E", "Zone F", "Zone G"],
    cyclone: ["Zone H", "Zone I", "Zone J"],
    custom: ["Custom Zone", "Custom North", "Custom South"]
  };

  const zone = scenarioZones[scenario][index % scenarioZones[scenario].length];
  const sourceType = index % 7 === 0 ? "verified_org" : index % 3 === 0 ? "ngo" : "anonymous";
  const type =
    scenario === "earthquake"
      ? index % 2 === 0
        ? "infrastructure"
        : "injury"
      : scenario === "cyclone"
        ? index % 3 === 0
          ? "shelter"
          : "flood"
        : index % 4 === 0
          ? "infrastructure"
          : "flood";

  const baseCoords =
    zone.includes("B") || zone.includes("F") || zone.includes("I")
      ? { lat: 13.1986, lng: 80.1692 }
      : zone.includes("C") || zone.includes("G") || zone.includes("J")
        ? { lat: 13.056, lng: 80.245 }
        : { lat: 13.0827, lng: 80.2707 };

  const textPool =
    type === "injury"
      ? ["Injuries reported near collapsed structure", "Medical teams needed for trapped residents", "Casualties reported after impact"]
      : type === "infrastructure"
        ? ["Bridge damage reported by locals", "Road access blocked by debris", "Structural failure suspected near transit line"]
        : type === "shelter"
          ? ["Shelter camp filling rapidly", "Families need temporary shelter and food", "Evacuation center nearing capacity"]
          : ["Water rising rapidly in residential lanes", "Families stranded near low-lying area", "Floodwaters cutting off access routes"];

  return {
    id: `sim-${scenario}-${index}-${Date.now()}`,
    text: textPool[index % textPool.length],
    source: sourceType === "verified_org" ? "Verified Command" : sourceType === "ngo" ? "NGO Field Desk" : `Crowd Reporter ${index}`,
    sourceType,
    lat: Number((baseCoords.lat + ((index % 5) - 2) * 0.0021).toFixed(6)),
    lng: Number((baseCoords.lng + ((index % 7) - 3) * 0.0018).toFixed(6)),
    zone,
    timestamp: new Date(simulationStart.getTime() + elapsedSeconds * 1000).toISOString(),
    geminiOutput: {
      type,
      urgency: Number((0.52 + ((index % 6) * 0.08)).toFixed(2)),
      needs:
        type === "injury"
          ? ["medical"]
          : type === "shelter"
            ? ["shelter", "food"]
            : ["rescue"],
      tone: sourceType === "anonymous" && index % 4 === 0 ? "exaggerated" : sourceType === "anonymous" ? "emotional" : "factual"
    },
    contradictionSignals: sourceType === "anonymous" && index % 5 === 0 ? 2 : sourceType === "anonymous" && index % 3 === 0 ? 1 : 0
  };
}

export default function App() {
  const { minute, setMinute, isPlaying, setIsPlaying, speed, setSpeed } = useSimulationClock();
  const [scenario, setScenario] = useState<ScenarioKey>("flood");
  const [liveReports, setLiveReports] = useState<CrisisReport[] | null>(null);
  const [liveEvents, setLiveEvents] = useState<FeedEvent[]>([]);
  const [liveZones, setLiveZones] = useState<DerivedZone[]>([]);
  const [liveDecisions, setLiveDecisions] = useState<Recommendation[] | null>(null);
  const [localReports, setLocalReports] = useState<CrisisReport[]>([]);
  const [localEvents, setLocalEvents] = useState<FeedEvent[]>([]);
  const [simulationReports, setSimulationReports] = useState<CrisisReport[]>([]);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [activePipeline, setActivePipeline] = useState<{ report: CrisisReport; stage: number } | null>(null);
  const [truthShiftActive, setTruthShiftActive] = useState(false);
  const [liveModeState, setLiveModeState] = useState<"connecting" | "live" | "empty" | "fallback" | "error">(
    firebaseEnabled ? "connecting" : "fallback"
  );
  const [chaosPending, setChaosPending] = useState(false);
  const [generatorPending, setGeneratorPending] = useState(false);
  const [expandedAction, setExpandedAction] = useState<"crowd" | "verified" | "misinfo" | "attack" | null>(null);
  const [showNasaLayer, setShowNasaLayer] = useState(false);
  const [nasaHotspots, setNasaHotspots] = useState<NasaHotspot[]>([]);
  const [nasaLoading, setNasaLoading] = useState(false);
  const [gdacsLoading, setGdacsLoading] = useState(false);
  const [gdacsCount, setGdacsCount] = useState(0);
  const [gdacsActive, setGdacsActive] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherLayerOn, setWeatherLayerOn] = useState(false);
  const [weatherSignals, setWeatherSignals] = useState<WeatherSignal[]>([]);
  const [truthMode, setTruthMode] = useState<"raw" | "filtered">("filtered");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [decisionShiftZone, setDecisionShiftZone] = useState<string | null>(null);
  const pipelineTimersRef = useRef<number[]>([]);
  const previousRecommendationRef = useRef<string>("");
  const analysisInFlightRef = useRef<Set<string>>(new Set());
  const [auditSessionId] = useState(() => buildSessionId());
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [benchmarkedMetric, setBenchmarkedMetric] = useState<{ value: number; scenarioSet: string[]; generatedAt: string } | null>(null);
  const [aiLifecycle, setAiLifecycle] = useState<Record<string, AiStage>>({});

  useEffect(() => {
    fetchFunctionJson<{ value: number; scenarioSet: string[]; generatedAt: string }>("fetchSuppressionMetric")
      .then(data => {
        if (data.value !== undefined) {
          setBenchmarkedMetric(data);
        }
      })
      .catch((err) => console.log("Metric fetch skipped/failed:", err.message));
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !db) {
      setLiveModeState("fallback");
      return;
    }

    const reportsQuery = query(collection(db, "reports"), orderBy("timestamp", "asc"));
    const eventsQuery = query(collection(db, "events"), orderBy("timestamp", "desc"));

    const unsubscribeReports = onSnapshot(
      reportsQuery,
      (snapshot) => {
        const reports = snapshot.docs.map((docSnapshot) => normalizeReport(docSnapshot));
        setLiveReports(reports);
        setLiveModeState(reports.length > 0 ? "live" : "empty");
      },
      () => setLiveModeState("error")
    );

    const unsubscribeEvents = onSnapshot(eventsQuery, (snapshot) => {
      const nextEvents: FeedEvent[] = snapshot.docs.slice(0, 16).map((eventDoc) => {
        const raw = eventDoc.data() as Record<string, unknown>;
        return {
          id: eventDoc.id,
          label: String(raw.title ?? raw.type ?? "System event"),
          detail: String(raw.detail ?? raw.entity ?? "Event update"),
          tone: raw.level === "alert" || raw.level === "resolve" ? raw.level : "info"
        };
      });

      setLiveEvents(nextEvents);
    });

    const unsubscribeSignals = onSnapshot(collection(db, "signals"), (snapshot) => {
      const nextWeatherSignals = snapshot.docs
        .map((signalDoc) => signalDoc.data() as Record<string, unknown>)
        .filter((raw) => raw.source === "WEATHER")
        .map((raw) => ({
          lat: Number(raw.lat ?? 0),
          lng: Number(raw.lng ?? 0),
          rain: Number(raw.rain ?? 0),
          humidity: Number(raw.humidity ?? 0),
          wind: Number(raw.wind ?? 0),
          pressure: Number(raw.pressure ?? 0),
          riskScore: Number(raw.riskScore ?? raw.confidence ?? 0),
          timestamp: Number(raw.timestamp ?? Date.now()),
          windDeg: Number(raw.windDeg ?? 0)
        }))
        .filter((signal) => Number.isFinite(signal.lat) && Number.isFinite(signal.lng));

      setWeatherSignals(nextWeatherSignals);
    });

    const unsubscribeZones = onSnapshot(collection(db, "zones"), (snapshot) => {
      const nextZones = snapshot.docs.map((zoneDoc) => {
        const raw = zoneDoc.data() as Record<string, unknown>;
        const rawBreakdown = (raw.breakdown ?? {}) as Record<string, unknown>;
        return {
          zoneId: zoneDoc.id,
          center: {
            lat: Number((raw.center as { lat?: unknown })?.lat ?? 0),
            lng: Number((raw.center as { lng?: unknown })?.lng ?? 0)
          },
          reports: Array.isArray(raw.reports) ? (raw.reports as string[]) : [],
          trustScore: Number(raw.trustScore ?? 0),
          urgencyScore: Number(raw.urgencyScore ?? 0),
          finalConfidence: Number(raw.finalConfidence ?? raw.trustScore ?? 0),
          conflictScore: Number(raw.conflictScore ?? 0),
          reportConfidence: Number(raw.reportConfidence ?? raw.trustScore ?? 0),
          nasaConfidence: Number(raw.nasaConfidence ?? 0),
          nasaConfirmed: Boolean(raw.nasaConfirmed),
          decision:
            raw.decision === "DISPATCH" || raw.decision === "VERIFY" || raw.decision === "HOLD"
              ? raw.decision
              : "HOLD",
          needs: Array.isArray(raw.needs) ? (raw.needs as string[]) : [],
          conflictLevel: String(raw.conflictLevel ?? "LOW"),
          affectedEstimate: Number(raw.affectedEstimate ?? 0),
          breakdown: {
            reportWeight: Number(rawBreakdown.reportWeight ?? 0.5),
            nasaWeight: Number(rawBreakdown.nasaWeight ?? 0),
            weatherWeight: Number(rawBreakdown.weatherWeight ?? 0),
            conflictPenalty: Number(rawBreakdown.conflictPenalty ?? 0),
            correlationAdjustments: Array.isArray(rawBreakdown.correlationAdjustments) ? (rawBreakdown.correlationAdjustments as string[]) : [],
            conflictCount: Number(rawBreakdown.conflictCount ?? 0),
            nasaActive: Boolean(rawBreakdown.nasaActive)
          }
        } satisfies DerivedZone;
      });

      setLiveZones(nextZones);
    });

    const unsubscribeDecisions = onSnapshot(doc(db, "decisions", "latest"), (decisionDoc) => {
      if (!decisionDoc.exists()) {
        setLiveDecisions(null);
        return;
      }

      const raw = decisionDoc.data() as { recommendations?: Recommendation[] };
      setLiveDecisions(raw.recommendations ?? null);
    });

    return () => {
      unsubscribeReports();
      unsubscribeEvents();
      unsubscribeSignals();
      unsubscribeZones();
      unsubscribeDecisions();
    };
  }, []);

  const demoState = getActiveState(minute, scenario);
  const usingLiveReports = liveModeState === "live" && (liveReports?.length ?? 0) > 0;
  const baseReports = usingLiveReports ? liveReports ?? [] : demoState.visibleReports;
  const activeReports = [...baseReports, ...simulationReports, ...localReports].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const activeNow = usingLiveReports ? new Date() : demoState.now;
  const zones = buildZoneClusters(activeReports, activeNow);
  const recommendations = usingLiveReports && liveDecisions?.length ? liveDecisions : buildRecommendations(activeReports, demoResources, activeNow);
  const feedEvents = [...localEvents, ...(usingLiveReports && liveEvents.length ? liveEvents : demoState.feedEvents)].slice(0, 16);
  const mapZones =
    usingLiveReports && liveZones.length
      ? liveZones
      : zones.map((zone) => {
          const conflict = computeConflictScore(zone.reports);
          const nasaScore = showNasaLayer ? 0.62 : 0;
          const fusion = computeFusedConfidence(zone.trustScore, nasaScore, conflict, {
            scenarioType: zone.reports[0]?.geminiOutput.type === "flood" ? "flood" : zone.reports[0]?.geminiOutput.type === "infrastructure" ? "earthquake" : "mixed",
            weatherSignal: 0
          });
          const finalConfidence = fusion.finalConfidence;
          const decision = conflict > 0.6 && finalConfidence < 0.55 ? "HOLD" : decide(finalConfidence);
          const conflictingReports = zone.reports.filter((report) => (report.contradictionSignals ?? 0) > 0 || report.claim === "negative");
          return {
            zoneId: zone.zone,
            center: { lat: zone.lat, lng: zone.lng },
            reports: zone.reports.map((report) => report.id),
            trustScore: zone.trustScore,
            urgencyScore: zone.urgencyScore,
            finalConfidence,
            conflictScore: conflict,
            reportConfidence: zone.trustScore,
            nasaConfidence: nasaScore,
            nasaConfirmed: showNasaLayer,
            decision,
            needs: zone.dominantNeeds,
            conflictLevel: conflict > 0.6 ? "HIGH" : conflict > 0.3 ? "MEDIUM" : "LOW",
            affectedEstimate: zone.affectedEstimate,
            breakdown: {
              reportWeight: fusion.weights.report,
              nasaWeight: fusion.weights.nasa,
              weatherWeight: fusion.weights.weather,
              conflictPenalty: fusion.conflictPenalty,
              correlationAdjustments: fusion.correlationAdjustments,
              conflictCount: conflictingReports.length,
              nasaActive: nasaScore > 0
            }
          } satisfies DerivedZone;
        });
  const visibleMapZones =
    truthMode === "filtered"
      ? mapZones.filter((zone) => zone.finalConfidence >= 0.45 || zone.conflictLevel === "HIGH" || zone.nasaConfirmed)
      : mapZones;

  useEffect(() => {
    const firstZone = zones[0];
    if (!firstZone) {
      setSelectedZoneId(null);
      setSelectedReportId(null);
      return;
    }

    if (!zones.some((zone) => zone.zone === selectedZoneId)) {
      setSelectedZoneId(firstZone.zone);
      setSelectedReportId(firstZone.reports[0]?.id ?? null);
    }
  }, [selectedZoneId, zones]);

  const selectedZone = zones.find((zone) => zone.zone === selectedZoneId) ?? zones[0] ?? null;
  const selectedDerivedZone = mapZones.find((zone) => zone.zoneId === selectedZoneId) ?? mapZones[0] ?? null;
  const allReports = zones.flatMap((zone) => zone.reports);
  const selectedReport =
    allReports.find((report) => report.id === selectedReportId) ??
    selectedZone?.reports[0] ??
    allReports[0] ??
    null;

  const incomingFeed = useMemo(
    () => {
      const recentReports = [...allReports].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (truthMode === "raw") {
        return recentReports.slice(0, 18);
      }

      const highSignal = recentReports.filter(
        (report) =>
          report.trust.decayedTrust >= 0.45 ||
          report.sourceType === "verified_org" ||
          report.sourceType === "citizen" ||
          (report.contradictionSignals ?? 0) >= 2
      );

      if (highSignal.length >= 10) {
        return highSignal.slice(0, 18);
      }

      const highSignalIds = new Set(highSignal.map((report) => report.id));
      const contextReports = recentReports.filter((report) => !highSignalIds.has(report.id)).slice(0, 10 - highSignal.length);
      return [...highSignal, ...contextReports].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 18);
    },
    [allReports, truthMode]
  );
  const conflictZones = mapZones.filter((zone) => zone.conflictLevel === "HIGH");
  const highTrustZones = mapZones.filter((zone) => zone.finalConfidence >= 0.75);
  const topTrustScore = selectedDerivedZone?.finalConfidence ?? recommendations[0]?.confidence ?? 0;
  const confidenceStory = buildConfidenceStory(selectedDerivedZone, selectedReport);
  const suppressedCount = allReports.filter((report) => (report.claim ?? "positive") === "negative" && report.trust.decayedTrust < 0.45).length;
  const totalNegative = allReports.filter((report) => (report.claim ?? "positive") === "negative").length;
  const suppressedMetricPct = totalNegative > 0 ? Math.round((suppressedCount / totalNegative) * 100) : 0;
  const aiQueue = [...simulationReports, ...localReports]
    .filter((report) => !report.ai && !analysisInFlightRef.current.has(report.id))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const pendingAiCount = aiQueue.length;
  const aiQueuePosition = selectedReport ? aiQueue.findIndex((report) => report.id === selectedReport.id) + 1 : 0;
  const selectedAiStage: AiStage = selectedReport
    ? selectedReport.ai?.isFallback
      ? "fallback"
      : selectedReport.ai
        ? "refined"
        : aiLifecycle[selectedReport.id] ?? "raw"
    : "raw";

  useEffect(() => {
    const signature = recommendations.map((item) => `${item.zone}:${item.action}:${item.confidence.toFixed(2)}`).join("|");
    if (!signature || previousRecommendationRef.current === signature) {
      previousRecommendationRef.current = signature;
      return;
    }

    if (previousRecommendationRef.current) {
      const currentTop = recommendations[0];
      const previousTop = previousRecommendationRef.current.split("|")[0] ?? "";
      const previousAction = previousTop.split(":")[1] ?? "";
      if (currentTop) {
        setDecisionShiftZone(currentTop.zone);
        window.setTimeout(() => setDecisionShiftZone(null), 1400);
        pushLocalEvent({
          id: `decision-shift-${Date.now()}`,
          label: "Decision shift",
          detail: `${currentTop.zone}: ${previousAction || "prior state"} -> ${displayDecisionAction(currentTop.action)}`,
          tone: "alert"
        });
      }
    }

    previousRecommendationRef.current = signature;
  }, [recommendations]);

  useEffect(() => {
    setLocalReports([]);
    setLocalEvents([]);
    setSimulationReports([]);
    setSimulationIndex(0);
    setAiLifecycle({});
    setMinute(0);
  }, [scenario]);

  useEffect(() => {
    if (usingLiveReports || simulationReports.length > 0) {
      return;
    }

    const seededReports = Array.from({ length: 6 }, (_, index) => generateSimulationReport(index + 1, scenario, (index + 1) * 8));
    setSimulationReports(seededReports);
    markReportsQueued(seededReports);
    setSimulationIndex(seededReports.length);
    const seedEvent: FeedEvent = {
      id: `seed-${scenario}-${Date.now()}`,
      label: "Simulation stream active",
      detail: `${scenarioMeta[scenario].label} scenario seeded with initial crowd reports`,
      tone: "info"
    };
    setLocalEvents((current) => [seedEvent, ...current].slice(0, 16));
  }, [scenario, simulationReports.length, usingLiveReports]);

  useEffect(() => {
    if (usingLiveReports || !isPlaying) {
      return;
    }

    const intervalMs = speed === 5 ? 550 : speed === 2 ? 950 : 1500;

    const generator = window.setInterval(() => {
      const burstCount = speed >= 5 ? 2 : 1;

      setSimulationIndex((current) => {
        let nextIndex = current;
        const nextReports: CrisisReport[] = [];

        for (let burst = 0; burst < burstCount; burst += 1) {
          nextIndex += 1;
          nextReports.push(generateSimulationReport(nextIndex, scenario, minute + nextIndex + burst));
        }

        setSimulationReports((existing) => [...existing.slice(-50), ...nextReports]);
        markReportsQueued(nextReports);
        nextReports.forEach((report) => {
          pushLocalEvent({
            id: `sim-${report.id}`,
            label: burstCount > 1 ? "Burst report received" : "Report received",
            detail: `${report.zone} | ${report.source} | ${report.geminiOutput.type}`,
            tone: report.sourceType === "anonymous" ? "alert" : report.sourceType === "verified_org" ? "resolve" : "info"
          });
        });
        startPipelineRun(nextReports[nextReports.length - 1]);
        return nextIndex;
      });
    }, intervalMs);

    return () => window.clearInterval(generator);
  }, [usingLiveReports, isPlaying, minute, scenario, speed]);

  useEffect(() => {
    if (usingLiveReports) {
      return;
    }
    const worker = window.setInterval(() => {
      const capacity = MAX_AI_CONCURRENCY - analysisInFlightRef.current.size;
      if (capacity <= 0) {
        return;
      }

      const nextReport =
        [...simulationReports, ...localReports]
          .filter((report) => !report.ai && !analysisInFlightRef.current.has(report.id))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] ?? null;

      if (!nextReport) {
        return;
      }

      analysisInFlightRef.current.add(nextReport.id);

      const applyAi = (ai: AIAnalysis, source: string) => {
        setSimulationReports((current) =>
          current.map((report) => (report.id === nextReport.id ? mergeAiAnalysis(report, ai) : report))
        );
        setLocalReports((current) =>
          current.map((report) => (report.id === nextReport.id ? mergeAiAnalysis(report, ai) : report))
        );
        setAiLifecycle((current) => ({ ...current, [nextReport.id]: ai.isFallback ? "fallback" : "refined" }));
        pushLocalEvent({
          id: `ai-${nextReport.id}`,
          label: ai.isFallback ? "AI heuristic complete" : "AI analysis complete",
          detail: `${nextReport.zone} | ${ai.type} | claim ${ai.claim} | conf ${ai.confidence.toFixed(2)} (${source})`,
          tone: ai.claim === "negative" ? "alert" : "resolve"
        });
        analysisInFlightRef.current.delete(nextReport.id);
      };

      // ── GATE 1: Pre-computed or cached AI (instant, zero API calls) ──
      const precomputed = getPrecomputedAi(nextReport.text);
      if (precomputed) {
        setAiLifecycle((current) => ({ ...current, [nextReport.id]: "processing" }));
        // Small delay to make the "processing → complete" transition visible in the UI
        window.setTimeout(() => applyAi(precomputed, "pre-computed"), 200);
        return;
      }

      // ── GATE 2: Real Gemini API call (rate-limited, cached, for citizen reports) ──
      setAiLifecycle((current) => ({ ...current, [nextReport.id]: "processing" }));
      if (geminiDirectAvailable) {
        pushLocalEvent({
          id: `ai-start-${nextReport.id}`,
          label: "Gemini processing",
          detail: `${nextReport.zone} sent to Gemini for live classification`,
          tone: "info"
        });
        analyzeReportDirect(nextReport.text)
          .then((ai) => applyAi(ai, "Gemini live"))
          .catch((err) => {
            console.warn("Gemini API failed:", err);
            const fallback = buildFallbackAnalysis(nextReport);
            applyAi(fallback, "heuristic");
          });
        return;
      }

      // ── GATE 3: Local heuristic fallback ──
      const fallback = buildFallbackAnalysis(nextReport);
      applyAi(fallback, "heuristic");
    }, 800);

    return () => window.clearInterval(worker);
  }, [localReports, simulationReports, usingLiveReports]);

  function pushLocalEvent(event: FeedEvent) {
    setLocalEvents((current) => [event, ...current].slice(0, 16));
  }

  function markReportsQueued(reports: CrisisReport[]) {
    setAiLifecycle((current) => {
      const next = { ...current };
      reports.forEach((report) => {
        if (!next[report.id] || next[report.id] === "raw") {
          next[report.id] = "queued";
        }
      });
      return next;
    });
  }

  function pushLocalReports(reports: CrisisReport[]) {
    setLocalReports((current) => dedupeReports(current, reports));
    markReportsQueued(reports);
  }

  async function toggleNasaLayer() {
    if (showNasaLayer) {
      setShowNasaLayer(false);
      return;
    }

    setNasaLoading(true);
    try {
      const payload = await fetchFunctionJson<{ hotspots?: NasaHotspot[] }>("fetchFIRMS");
      setNasaHotspots(payload.hotspots ?? []);
      setShowNasaLayer(true);
      pushLocalEvent({
        id: `nasa-${Date.now()}`,
        label: "NASA FIRMS overlay active",
        detail: `Satellite hotspot layer loaded with ${payload.hotspots?.length ?? 0} signals`,
        tone: "resolve"
      });
    } catch (error) {
      pushLocalEvent({
        id: `nasa-error-${Date.now()}`,
        label: "NASA layer unavailable",
        detail: error instanceof Error ? error.message : "FIRMS hotspot fetch failed from backend",
        tone: "alert"
      });
    } finally {
      setNasaLoading(false);
    }
  }

  async function syncGdacsLayer() {
    setGdacsLoading(true);
    try {
      const payload = await fetchFunctionJson<{ ok?: boolean; count?: number; error?: string }>("fetchGDACSSignals");
      if (payload.ok === false) {
        throw new Error(payload.error ?? "GDACS sync failed");
      }

      setGdacsCount(payload.count ?? 0);
      setGdacsActive(true);
      pushLocalEvent({
        id: `gdacs-${Date.now()}`,
        label: "GDACS reality layer active",
        detail: `${payload.count ?? 0} public flood alerts synced into signals`,
        tone: "resolve"
      });
    } catch (error) {
      setGdacsActive(false);
      pushLocalEvent({
        id: `gdacs-error-${Date.now()}`,
        label: "GDACS sync failed",
        detail: error instanceof Error ? error.message : "GDACS reality layer unavailable",
        tone: "alert"
      });
    } finally {
      setGdacsLoading(false);
    }
  }

  async function toggleWeatherLayer() {
    if (weatherLayerOn) {
      setWeatherLayerOn(false);
      return;
    }

    setWeatherLoading(true);
    try {
      const payload = await fetchFunctionJson<{ ok?: boolean; count?: number; error?: string }>("fetchWeatherSignals");
      if (payload.ok === false) {
        throw new Error(payload.error ?? "Weather sync failed");
      }

      setWeatherLayerOn(true);
      pushLocalEvent({
        id: `weather-${Date.now()}`,
        label: "Weather layer active",
        detail: `${payload.count ?? 0} flood-risk weather signals loaded`,
        tone: "resolve"
      });
    } catch (error) {
      setWeatherLayerOn(false);
      pushLocalEvent({
        id: `weather-error-${Date.now()}`,
        label: "Weather layer unavailable",
        detail: error instanceof Error ? error.message : "Weather sync failed",
        tone: "alert"
      });
    } finally {
      setWeatherLoading(false);
    }
  }

  function startPipelineRun(report: CrisisReport) {
    pipelineTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    pipelineTimersRef.current = [];
    setActivePipeline({ report, stage: 0 });

    const stageEvents = [
      { label: "Classified", detail: `${report.geminiOutput.type} | urgency ${report.geminiOutput.urgency.toFixed(2)}`, tone: "info" as const },
      { label: "Trust updated", detail: `${report.zone} confidence recomputed from source, tone, and timing`, tone: report.sourceType === "anonymous" ? "alert" as const : "resolve" as const },
      { label: "Conflict check", detail: report.contradictionSignals ? `Contradiction risk detected in ${report.zone}` : `No major contradiction in ${report.zone}`, tone: report.contradictionSignals ? "alert" as const : "info" as const },
      { label: "Zone updated", detail: `${report.zone} zone state refreshed with new signal density`, tone: "info" as const },
      { label: "Decision updated", detail: `Recommendations re-ranked after ${report.zone} changed`, tone: "resolve" as const }
    ];

    stageEvents.forEach((event, index) => {
      const timer = window.setTimeout(() => {
        setActivePipeline({ report, stage: index + 1 });
        pushLocalEvent({
          id: `${report.id}-stage-${index}`,
          label: event.label,
          detail: event.detail,
          tone: event.tone
        });
      }, 260 * (index + 1));
      pipelineTimersRef.current.push(timer);
    });
  }

  async function injectChaos() {
    const chaosReports: CrisisReport[] = [
      {
        id: `local-chaos-a-${Date.now()}`,
        text: "Bridge collapse rumors spreading fast near Zone B. Multiple stranded commuters reported.",
        source: "Social Stream Chaos",
        sourceType: "anonymous",
        lat: 13.1981,
        lng: 80.1701,
        zone: "Zone B",
        timestamp: new Date().toISOString(),
        geminiOutput: {
          type: "infrastructure",
          urgency: 0.91,
          needs: ["rescue"],
          tone: "exaggerated"
        },
        contradictionSignals: 2
      },
      {
        id: `local-chaos-b-${Date.now()}`,
        text: "Verified field responder says traffic is moving and bridge remains operational in Zone B.",
        source: "Field Command",
        sourceType: "verified_org",
        lat: 13.1994,
        lng: 80.1718,
        zone: "Zone B",
        timestamp: new Date(Date.now() + 1200).toISOString(),
        geminiOutput: {
          type: "infrastructure",
          urgency: 0.46,
          needs: ["medical"],
          tone: "factual"
        },
        contradictionSignals: 0
      },
      {
        id: `local-chaos-c-${Date.now()}`,
        text: "Fresh flood surge reported around Zone A shelters, evacuation support may be needed.",
        source: "ReliefWeb Partner Live",
        sourceType: "ngo",
        lat: 13.0842,
        lng: 80.2734,
        zone: "Zone A",
        timestamp: new Date(Date.now() + 2200).toISOString(),
        geminiOutput: {
          type: "flood",
          urgency: 0.88,
          needs: ["rescue", "shelter"],
          tone: "factual"
        },
        contradictionSignals: 0
      }
    ];

    setChaosPending(true);

    try {
      if (db && usingLiveReports) {
        const firestore = db;
        await Promise.all(
          chaosReports.map((report) =>
            addDoc(collection(firestore, "reports"), {
              text: report.text,
              source: report.source,
              sourceType: report.sourceType,
              lat: report.lat,
              lng: report.lng,
              zone: report.zone,
              timestamp: report.timestamp,
              triage: {
                type: report.geminiOutput.type,
                urgency: report.geminiOutput.urgency,
                needs: report.geminiOutput.needs,
                tone: report.geminiOutput.tone,
                location: report.zone
              },
              conflicts: report.contradictionSignals ? [`conflict-${report.id}`] : []
            })
          )
        );
      } else {
        pushLocalReports(chaosReports);
        pushLocalEvent({
          id: `local-chaos-${Date.now()}`,
          label: "Misinformation injected",
          detail: "Contradictory reports added locally to stress the trust engine",
          tone: "alert"
        });
        chaosReports.forEach((report) => startPipelineRun(report));
      }
    } finally {
      setChaosPending(false);
    }
  }

  async function simulateAdversarialAttack() {
    const attackReports: CrisisReport[] = [
      {
        id: `attack-1-${Date.now()}`,
        text: "Water is 3 feet high on Main Street, we need boats!",
        source: "Citizen Reporter A",
        sourceType: "citizen",
        lat: 13.0835,
        lng: 80.2715,
        zone: "Zone A",
        timestamp: new Date().toISOString(),
        geminiOutput: { type: "flood", urgency: 0.85, needs: ["rescue"], tone: "emotional" },
        contradictionSignals: 0,
        claim: "positive"
      },
      {
        id: `attack-2-${Date.now()}`,
        text: "Flooding is severe on Main, cars are submerged.",
        source: "Citizen Reporter B",
        sourceType: "citizen",
        lat: 13.0838,
        lng: 80.2711,
        zone: "Zone A",
        timestamp: new Date(Date.now() + 800).toISOString(),
        geminiOutput: { type: "flood", urgency: 0.82, needs: ["rescue"], tone: "factual" },
        contradictionSignals: 0,
        claim: "positive"
      },
      {
        id: `attack-3-${Date.now()}`,
        text: "Main Street is completely dry, no emergency here. False alarm everyone.",
        source: "Anonymous Bot Account",
        sourceType: "anonymous",
        lat: 13.0831,
        lng: 80.2718,
        zone: "Zone A",
        timestamp: new Date(Date.now() + 1600).toISOString(),
        geminiOutput: { type: "flood", urgency: 0.12, needs: ["rescue"], tone: "factual" },
        contradictionSignals: 3,
        claim: "negative"
      },
      {
        id: `attack-4-${Date.now()}`,
        text: "Confirmed: water level rising near Main Street junction, rescue boats en route.",
        source: "NDRF Field Unit",
        sourceType: "verified_org",
        lat: 13.0840,
        lng: 80.2720,
        zone: "Zone A",
        timestamp: new Date(Date.now() + 2400).toISOString(),
        geminiOutput: { type: "flood", urgency: 0.90, needs: ["rescue", "medical"], tone: "factual" },
        contradictionSignals: 0,
        claim: "positive"
      },
      {
        id: `attack-5-${Date.now()}`,
        text: "NGO team on ground at Main Street. People stranded on rooftops, water still rising.",
        source: "RedCross Chennai",
        sourceType: "ngo",
        lat: 13.0833,
        lng: 80.2708,
        zone: "Zone A",
        timestamp: new Date(Date.now() + 3200).toISOString(),
        geminiOutput: { type: "flood", urgency: 0.88, needs: ["rescue", "shelter"], tone: "factual" },
        contradictionSignals: 0,
        claim: "positive"
      }
    ];

    setChaosPending(true);
    try {
      pushLocalReports(attackReports);
      pushLocalEvent({
        id: `adversarial-attack-${Date.now()}`,
        label: "\u26a0\ufe0f Adversarial attack simulated",
        detail: "5 reports injected: 4 genuine flood signals + 1 bot contradiction. Watch the trust engine isolate the fake.",
        tone: "alert"
      });
      attackReports.forEach((report) => startPipelineRun(report));
    } finally {
      setChaosPending(false);
    }
  }

  async function injectLocalSyntheticWave() {
    const reports: CrisisReport[] = Array.from({ length: 12 }, (_, index) => ({
      id: `local-wave-${Date.now()}-${index}`,
      text: ["Water rising fast", "People stuck here", "Road blocked", "Bridge collapsed", "Shelter supplies running low"][index % 5],
      source: `UI Synthetic Reporter ${index + 1}`,
      sourceType: "anonymous",
      lat: Number((13.0827 + ((index % 6) - 2) * 0.0022).toFixed(6)),
      lng: Number((80.2707 + ((index % 5) - 2) * 0.002).toFixed(6)),
      zone: index % 3 === 0 ? "Zone B" : "Zone A",
      timestamp: new Date(Date.now() + index * 900).toISOString(),
      geminiOutput: {
        type: index % 4 === 0 ? "infrastructure" : "flood",
        urgency: Number((0.58 + (index % 4) * 0.09).toFixed(2)),
        needs: index % 5 === 0 ? ["shelter", "food"] : ["rescue"],
        tone: index % 3 === 0 ? "emotional" : "factual"
      },
      contradictionSignals: index % 4 === 0 ? 1 : 0
    }));

    setGeneratorPending(true);

    try {
      if (db && usingLiveReports) {
        const firestore = db;
        await Promise.all(
          reports.map((report) =>
            addDoc(collection(firestore, "reports"), {
              text: report.text,
              source: report.source,
              sourceType: report.sourceType,
              lat: report.lat,
              lng: report.lng,
              zone: report.zone,
              timestamp: report.timestamp,
              triage: {
                type: report.geminiOutput.type,
                urgency: report.geminiOutput.urgency,
                needs: report.geminiOutput.needs,
                tone: report.geminiOutput.tone,
                location: report.zone
              },
              conflicts: report.contradictionSignals ? [`ui-conflict-${report.id}`] : []
            })
          )
        );
      } else {
        pushLocalReports(reports);
        pushLocalEvent({
          id: `local-wave-${Date.now()}`,
          label: "Crowd wave injected",
          detail: "Synthetic public reports added to the local simulation",
          tone: "info"
        });
        reports.slice(-3).forEach((report) => startPipelineRun(report));
      }
    } finally {
      setGeneratorPending(false);
    }
  }

  async function injectVerifiedCorrectionFromUi() {
    setGeneratorPending(true);

    const verifiedReport: CrisisReport = {
      id: `local-verified-${Date.now()}`,
      text: "Verified command update: bridge remains operational and no full collapse is confirmed.",
      source: "UI Verified Command",
      sourceType: "verified_org",
      lat: 13.1994,
      lng: 80.1718,
      zone: "Zone B",
      timestamp: new Date().toISOString(),
      geminiOutput: {
        type: "infrastructure",
        urgency: 0.42,
        needs: ["medical"],
        tone: "factual"
      },
      contradictionSignals: 0
    };

    try {
      if (db && usingLiveReports) {
        const firestore = db;
        await addDoc(collection(firestore, "reports"), {
          text: verifiedReport.text,
          source: verifiedReport.source,
          sourceType: verifiedReport.sourceType,
          lat: verifiedReport.lat,
          lng: verifiedReport.lng,
          zone: verifiedReport.zone,
          timestamp: verifiedReport.timestamp,
          triage: {
            type: verifiedReport.geminiOutput.type,
            urgency: verifiedReport.geminiOutput.urgency,
            needs: verifiedReport.geminiOutput.needs,
            tone: verifiedReport.geminiOutput.tone,
            location: verifiedReport.zone
          },
          conflicts: []
        });
      } else {
        pushLocalReports([verifiedReport]);
        pushLocalEvent({
          id: `local-verified-event-${Date.now()}`,
          label: "Verified correction added",
          detail: "A high-trust report was added to challenge the current narrative",
          tone: "resolve"
        });
        setTruthShiftActive(true);
        window.setTimeout(() => setTruthShiftActive(false), 1400);
        startPipelineRun(verifiedReport);
      }
    } finally {
      setGeneratorPending(false);
    }
  }

  function handleStartSimulation() {
    setIsPlaying(true);
    pushLocalEvent({
      id: `simulation-start-${Date.now()}`,
      label: "Live demo running",
      detail: `${scenarioMeta[scenario].label} stream resumed`,
      tone: "resolve"
    });
  }

  function handlePauseSimulation() {
    setIsPlaying(false);
    pushLocalEvent({
      id: `simulation-pause-${Date.now()}`,
      label: "Live demo paused",
      detail: "Simulation stream paused for inspection",
      tone: "info"
    });
  }

  const handleOperatorAction = async (recommendation: Recommendation, actionType: "CONFIRMED" | "OVERRIDDEN", event: React.MouseEvent | React.FormEvent) => {
    event.stopPropagation();
    if (event.type === 'submit') event.preventDefault();
    
    const validation = validateOperatorAction(actionType, actionType === "OVERRIDDEN" ? overrideReason : undefined);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    const payload = buildAuditEntry({
      sessionId: auditSessionId,
      zoneId: recommendation.zone,
      eventType: actionType === "CONFIRMED" ? "OPERATOR_CONFIRMED" : "OPERATOR_OVERRIDDEN",
      systemRecommendation: recommendation.action,
      systemConfidence: recommendation.confidence,
      systemReasoning: recommendation.rationale,
      operatorAction: actionType,
      operatorReason: actionType === "OVERRIDDEN" ? overrideReason : undefined,
      operatorId: "demo-operator"
    });

    if (firebaseEnabled && db) {
      try {
        await addDoc(collection(db, "audit", auditSessionId, "entries"), payload);
      } catch (err) {
        console.error("Failed to write audit log:", err);
      }
    }

    setLocalEvents((prev) => [
      {
        id: `audit-${Date.now()}`,
        tone: actionType === "CONFIRMED" ? "resolve" : "alert",
        label: actionType === "CONFIRMED" ? "OPERATOR CONFIRMATION" : "OPERATOR OVERRIDE",
        detail: actionType === "CONFIRMED" ? `Dispatch confirmed for ${recommendation.zone}` : `Override on ${recommendation.zone}: ${overrideReason}`,
        timestamp: new Date().toISOString()
      },
      ...prev
    ]);

    if (actionType === "OVERRIDDEN") {
      setOverrideTarget(null);
      setOverrideReason("");
    }

    // Fire Google Chat webhook for confirmed dispatches
    if (actionType === "CONFIRMED" && recommendation.confidence >= 0.6) {
      triggerGoogleChatAlert({
        location: recommendation.zone,
        confidence: `${(recommendation.confidence * 100).toFixed(1)}%`,
        reasoning: recommendation.rationale
      });
    }
  };

  return (
    <div className={`ops-shell ${truthShiftActive ? "ops-shell--truth-shift" : ""}`}>
      <header className="topbar">
        <div className="topbar__brand">
          <h1>CrisisLens</h1>
          <p className="topbar__summary">Trust-filtered crisis intelligence for fast, evidence-backed decisions.</p>
        </div>

        <div className="topbar__controls">
          <div className="control-cluster">
            <label className="control-label" htmlFor="scenario">
              Scenario
            </label>
            <select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value as ScenarioKey)}>
              <option value="flood">Flood</option>
              <option value="earthquake">Earthquake</option>
              <option value="cyclone">Cyclone</option>
              <option value="custom">Custom Scenario</option>
            </select>
          </div>

          <div className="control-cluster">
            <span className="control-label">Live Demo</span>
            <div className="button-row">
              <button className={`control-button ${isPlaying ? "control-button--active" : ""}`} onClick={handleStartSimulation} type="button">
                Start
              </button>
              <button className={`control-button ${!isPlaying ? "control-button--active" : ""}`} onClick={handlePauseSimulation} type="button">
                Pause
              </button>
            </div>
          </div>

          <div className="control-cluster">
            <span className="control-label">Speed</span>
            <div className="button-row">
              {[1, 2, 5].map((value) => (
                <button
                  key={value}
                  className={`speed-pill ${speed === value ? "speed-pill--active" : ""}`}
                  onClick={() => setSpeed(value as 1 | 2 | 5)}
                  type="button"
                >
                  {value}x
                </button>
              ))}
            </div>
          </div>

          <div className="control-cluster">
            <span className="control-label">Reality View</span>
            <div className="button-row">
              <button
                className={`speed-pill ${truthMode === "raw" ? "speed-pill--active" : ""}`}
                onClick={() => setTruthMode("raw")}
                type="button"
              >
                Raw Chaos
              </button>
              <button
                className={`speed-pill ${truthMode === "filtered" ? "speed-pill--active" : ""}`}
                onClick={() => setTruthMode("filtered")}
                type="button"
              >
                Filtered Truth
              </button>
            </div>
          </div>
        </div>
      </header>

      <section className="status-rail">
        <StatusPill label={scenarioMeta[scenario].title} ready />
        <StatusPill label={usingLiveReports ? "Live Sync" : "Demo Stream"} ready />
        <StatusPill label={`Clock ${usingLiveReports ? "LIVE" : formatClock(minute)}`} ready />
        <StatusPill label={truthMode === "raw" ? "Raw Chaos" : "Filtered Truth"} ready={truthMode === "filtered"} />
        <StatusPill label={gdacsActive ? `GDACS ${gdacsCount}` : "GDACS idle"} ready={gdacsActive} />
        <StatusPill label={weatherLayerOn ? `Weather ${weatherSignals.length}` : "Weather off"} ready={weatherLayerOn} />
        <StatusPill label={`Verified ${highTrustZones.length}`} ready />
        <StatusPill label={`Conflict ${conflictZones.length}`} ready={conflictZones.length === 0} />
        <StatusPill label={`Suppressed ${suppressedCount}`} ready={false} />
        <StatusPill label={pendingAiCount > 0 ? `AI Queue ${pendingAiCount}` : "AI Queue clear"} ready={pendingAiCount === 0} />
        <StatusPill label={`Trust ${topTrustScore.toFixed(2)}`} ready={topTrustScore >= 0.75} />
        <StatusPill label="Gemini" ready={setupChecklist.hasGeminiKey} />
        <StatusPill label="Maps" ready={setupChecklist.hasMapsKey} />
        <StatusPill label="Firebase" ready={setupChecklist.hasFirebaseConfig} />
      </section>

      <section className="timeline-strip panel">
        <div className="timeline-row">
          <strong>Simulation Timeline</strong>
          <input
            max={simulationDurationSeconds}
            min={0}
            onChange={(event) => setMinute(Number(event.target.value))}
            type="range"
            value={Math.min(minute, simulationDurationSeconds)}
          />
          <span>{formatClock(Math.min(minute, simulationDurationSeconds))}</span>
        </div>
      </section>

      <section className="mission-strip">
        <div>
          <span className="mission-label">Chennai Flood Response</span>
          <h2>{scenarioMeta[scenario].title}</h2>
          <p>
            Incoming reports stream from crowd, NGO, and verified sources around Chennai. CrisisLens triages them,
            scores trust, detects contradictions, updates hotspot confidence, and reorders response decisions live.
          </p>
        </div>
        <div className="mission-metrics">
          <MetricCard label="Reports" value={String(allReports.length)} />
          <MetricCard label="Top Confidence" value={recommendations[0] ? recommendations[0].confidence.toFixed(2) : "0.00"} />
          <MetricCard label="Mode" value={usingLiveReports ? "Live" : `${speed}x demo`} />
          <MetricCard label="Timer" value={formatClock(minute)} />
        </div>
      </section>

      <section className="trigger-strip">
        <div className="trigger-card">
          <span className="mission-label">Interventions</span>
          <h3>Stress The System</h3>
          <p>Inject crowd noise, verified correction, or misinformation without bloating the command bar.</p>
          <div className="action-tabs">
            <button
              className={`action-tab ${expandedAction === "crowd" ? "action-tab--active" : ""}`}
              disabled={generatorPending}
              onClick={() => setExpandedAction((current) => (current === "crowd" ? null : "crowd"))}
              type="button"
            >
              <span className="action-tab__icon">~</span>
              <strong>Crowd</strong>
            </button>
            <button
              className={`action-tab ${expandedAction === "verified" ? "action-tab--active" : ""}`}
              disabled={generatorPending}
              onClick={() => setExpandedAction((current) => (current === "verified" ? null : "verified"))}
              type="button"
            >
              <span className="action-tab__icon">+</span>
              <strong>Verified</strong>
            </button>
            <button
              className={`action-tab action-tab--danger ${expandedAction === "misinfo" ? "action-tab--active" : ""}`}
              disabled={chaosPending}
              onClick={() => setExpandedAction((current) => (current === "misinfo" ? null : "misinfo"))}
              type="button"
            >
              <span className="action-tab__icon">!</span>
              <strong>Misinfo</strong>
            </button>
            <button
              className={`action-tab action-tab--danger ${expandedAction === "attack" ? "action-tab--active" : ""}`}
              disabled={chaosPending}
              onClick={() => setExpandedAction((current) => (current === "attack" ? null : "attack"))}
              type="button"
            >
              <span className="action-tab__icon">⚠</span>
              <strong>Attack</strong>
            </button>
          </div>
          {expandedAction === "crowd" ? (
            <div className="action-panel">
              <p>Inject a burst of noisy public reports into active zones.</p>
              <button className="control-button topbar-runner" disabled={generatorPending} onClick={injectLocalSyntheticWave} type="button">
                Run Crowd Wave
              </button>
            </div>
          ) : null}
          {expandedAction === "verified" ? (
            <div className="action-panel">
              <p>Add a high-trust correction so the system can recover.</p>
              <button className="control-button topbar-runner" disabled={generatorPending} onClick={injectVerifiedCorrectionFromUi} type="button">
                Run Verified Report
              </button>
            </div>
          ) : null}
          {expandedAction === "misinfo" ? (
            <div className="action-panel">
              <p>Force a contradiction-heavy moment and watch trust shift live.</p>
              <button className="control-button control-button--chaos topbar-runner" disabled={chaosPending} onClick={injectChaos} type="button">
                {chaosPending ? "Injecting..." : "Run Misinformation"}
              </button>
            </div>
          ) : null}
          {expandedAction === "attack" ? (
            <div className="action-panel">
              <p><strong>Orchestrated demo:</strong> 4 real flood reports + 1 bot contradiction. The AI catches and isolates the fake signal live.</p>
              <button className="control-button control-button--chaos topbar-runner" disabled={chaosPending} onClick={simulateAdversarialAttack} type="button">
                {chaosPending ? "Attacking..." : "⚠️ Simulate Attack"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="trigger-card">
          <span className="mission-label">Reality Layer</span>
          <h3>GDACS Trigger Ready</h3>
          <p>
            Real disaster alerts can enter through the backend `fetchGDACS` endpoint, then the trust engine layers
            local uncertainty handling and response prioritization on top.
          </p>
          <div className="button-row">
            <button className="control-button" disabled={gdacsLoading} onClick={syncGdacsLayer} type="button">
              {gdacsLoading ? "Syncing GDACS..." : gdacsActive ? `Refresh GDACS (${gdacsCount})` : "Sync GDACS Alerts"}
            </button>
            <button className="control-button" disabled={weatherLoading} onClick={toggleWeatherLayer} type="button">
              {weatherLoading ? "Loading Weather..." : weatherLayerOn ? "Hide Weather Layer" : "WEATHER LAYER ON/OFF"}
            </button>
            <button className="control-button" disabled={nasaLoading} onClick={toggleNasaLayer} type="button">
              {nasaLoading ? "Loading FIRMS..." : showNasaLayer ? "Hide NASA FIRMS" : "Show NASA FIRMS"}
            </button>
          </div>
        </div>
        <div className="metric-banner">
          <span className="mission-label">Killer Metric</span>
          <strong>{benchmarkedMetric ? `${benchmarkedMetric.value}% false-dispatch suppression` : (suppressedCount > 0 ? `${suppressedCount} false signals blocked — ${suppressedMetricPct}% suppression rate (local)` : "Awaiting adversarial signals to measure suppression")}</strong>
          <p>{benchmarkedMetric ? `Benchmarked across ${benchmarkedMetric.scenarioSet.length} scenarios. Generated at ${new Date(benchmarkedMetric.generatedAt).toLocaleTimeString()}.` : (suppressedCount > 0 ? `Of ${totalNegative} negative-claim reports, ${suppressedCount} were suppressed by the trust filter (trust < 0.45). Run \`npm run extract-metric\` for reproducible seed-based extraction.` : "Inject misinformation or start the simulation to see live suppression metrics from the trust engine.")}</p>
        </div>
      </section>

      <main className="command-grid">
        <section className="panel panel--left">
          <div className="panel-heading">
            <h2>Incoming Intelligence</h2>
            <span className="panel-subtitle">Live reports entering the crisis loop before trust filtering</span>
          </div>
          <div className="intel-table-wrap">
            <table className="intel-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Source</th>
                  <th>Report</th>
                  <th>Type</th>
                  <th>AI</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {incomingFeed.map((report) => (
                  <tr
                    key={report.id}
                    className={`intel-table__row ${selectedReport?.id === report.id ? "intel-table__row--active" : ""}`}
                    onClick={() => {
                      setSelectedReportId(report.id);
                      setSelectedZoneId(report.zone);
                    }}
                  >
                    <td className="intel-table__zone">{report.zone}</td>
                    <td><span className={`source-chip source-chip--${report.sourceType}`}>{report.sourceType}</span></td>
                    <td className="intel-table__text">{report.text}</td>
                    <td>{report.geminiOutput.type}</td>
                    <td className="intel-table__ai">
                      {report.ai?.isFallback
                        ? "fallback"
                        : report.ai
                          ? "refined"
                          : aiLifecycle[report.id] === "processing"
                            ? "processing"
                            : "raw"}
                    </td>
                    <td className="intel-table__time">{new Date(report.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel panel--center">
          <div className="panel-heading">
            <h2>Emergency Operations Map</h2>
            <span className="panel-subtitle">Trusted spatial intelligence, conflict pulses, and live operational pressure</span>
          </div>
          <div className="map-guidance">
            <div className="legend-chip legend-chip--verified">Verified</div>
            <div className="legend-chip legend-chip--uncertain">Uncertain</div>
            <div className="legend-chip legend-chip--conflict">Conflict</div>
            <p>
              {truthMode === "raw"
                ? "Raw mode shows clutter, contradictions, and every live signal."
                : "Filtered truth suppresses weak signals and keeps the clearest operational picture."}
            </p>
          </div>
          {appConfig.googleMapsApiKey ? (
            <div className={`map-shell ${showNasaLayer ? "map-shell--nasa" : ""}`}>
              <Suspense fallback={<div className="map-loading">Loading live map...</div>}>
              <LiveMap
                apiKey={appConfig.googleMapsApiKey}
                nasaHotspots={showNasaLayer ? nasaHotspots : []}
                showWeatherLayer={weatherLayerOn}
                onSelectZone={(zoneId) => {
                  setSelectedZoneId(zoneId);
                  const matchingZone = zones.find((zone) => zone.zone === zoneId);
                    setSelectedReportId(matchingZone?.reports[0]?.id ?? null);
                  }}
                selectedZoneId={selectedZone?.zone ?? null}
                weatherSignals={weatherSignals}
                zones={visibleMapZones}
              />
              </Suspense>
              <div className="map-overlay-card">
                <strong>{truthMode === "raw" ? "Raw" : "Filtered"}</strong>
                <p>
                  {showNasaLayer
                    ? `FIRMS · ${nasaHotspots.length}`
                    : "NASA off"}
                </p>
              </div>
              {selectedZone && selectedDerivedZone ? (
                <div className="map-detail-overlay">
                  <h3>{selectedZone.zone}</h3>
                  <p>
                    Conf <strong>{selectedDerivedZone.finalConfidence.toFixed(2)}</strong> · Urg <strong>{selectedZone.urgencyScore.toFixed(2)}</strong> · <strong>{selectedDerivedZone.decision}</strong> · {selectedDerivedZone.conflictLevel}
                  </p>
                  <button
                    className="overlay-link"
                    onClick={() => setSelectedReportId(selectedZone.reports[0]?.id ?? null)}
                    type="button"
                  >
                    Explain
                  </button>
                </div>
              ) : null}
              {showNasaLayer ? (
                <div className="map-satellite-badge">
                  <span>SATELLITE CONFIRMATION ACTIVE</span>
                </div>
              ) : null}
              {gdacsActive ? (
                <div className="map-gdacs-badge">
                  <span>GDACS ALERTS LIVE · {gdacsCount}</span>
                </div>
              ) : null}
              {weatherLayerOn ? (
                <div className="map-weather-badge">
                  <span>WEATHER RISK LIVE · {weatherSignals.length}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="setup-card">
              <p>Add `VITE_GOOGLE_MAPS_API_KEY` to enable the live map.</p>
            </div>
          )}

          <div className="pipeline-expanded">
            {pipelineSteps.map((step, index) => (
              <article
                key={step.title}
                className={`pipeline-card ${activePipeline?.stage === index ? "pipeline-card--active" : ""}`}
              >
                <span className="pipeline-card__title">{step.title}</span>
                <p>
                  {activePipeline?.stage === index
                    ? `${step.text} Active: ${activePipeline.report.zone} · ${activePipeline.report.geminiOutput.type} · ${activePipeline.report.sourceType}.`
                    : step.text}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel--details">
          <div className="panel-heading">
            <h2>Conflict + Trust Panel</h2>
            <span className="panel-subtitle">Raw intake, fusion logic, and why this zone is being trusted or suppressed</span>
          </div>
          <div className="trust-summary-row">
            <div className="score-card">
              <span>Final Confidence</span>
              <strong>{selectedDerivedZone?.finalConfidence.toFixed(2) ?? "0.00"}</strong>
              <em>{displayDecisionState(selectedDerivedZone?.decision ?? "HOLD")}</em>
              <div className={`trust-meter trust-meter--${trustMeterTone(selectedDerivedZone?.finalConfidence ?? 0)}`}>
                <div className="trust-meter__fill" style={{ width: `${Math.round((selectedDerivedZone?.finalConfidence ?? 0) * 100)}%` }} />
              </div>
            </div>
            <div className="score-card">
              <span>Conflict Score</span>
              <strong>{selectedDerivedZone?.conflictScore.toFixed(2) ?? "0.00"}</strong>
              <em>{selectedDerivedZone?.conflictLevel ?? "LOW"}</em>
            </div>
            <div className="score-card">
              <span>NASA Confidence</span>
              <strong>{selectedDerivedZone?.nasaConfidence.toFixed(2) ?? "0.00"}</strong>
              <em>{selectedDerivedZone?.nasaConfirmed ? "Satellite confirmed" : "No satellite layer"}</em>
            </div>
          </div>
          <div className="detail-card detail-card--decomposition">
            <h3>Confidence Decomposition</h3>
            <div className="decomposition-chain" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", margin: "14px 0", fontSize: "1.1rem" }}>
              <div style={{ padding: "8px", background: "rgba(255,138,76,0.1)", borderRadius: "8px" }}>
                <span>Trust</span> <strong style={{ color: "#ff8a4c" }}>{selectedReport?.trust.decayedTrust.toFixed(2) ?? "0.00"}</strong>
                <span style={{ fontSize: "0.8em", opacity: 0.7, marginLeft: "4px" }}>× {(selectedDerivedZone?.breakdown?.reportWeight ?? 0.5).toFixed(2)}</span>
              </div>
              <span className="decomposition-operator">+</span>
              <div style={{ padding: "8px", background: "rgba(0,199,255,0.1)", borderRadius: "8px" }}>
                <span>NASA</span> <strong style={{ color: "#00c7ff" }}>{selectedDerivedZone?.nasaConfidence.toFixed(2) ?? "0.00"}</strong>
                <span style={{ fontSize: "0.8em", opacity: 0.7, marginLeft: "4px" }}>× {(selectedDerivedZone?.breakdown?.nasaWeight ?? 0).toFixed(2)}</span>
              </div>
              <span className="decomposition-operator">−</span>
              <div style={{ padding: "8px", background: "rgba(255,95,87,0.1)", borderRadius: "8px" }}>
                <span>Conflict</span> <strong style={{ color: "#ff5f57" }}>{(selectedDerivedZone?.breakdown?.conflictCount ?? 0) > 0 ? (selectedDerivedZone?.breakdown?.conflictPenalty ?? 0).toFixed(2) : "0.00"}</strong>
              </div>
              <span className="decomposition-operator" style={{ fontWeight: "bold", marginLeft: "8px" }}>=</span>
              <div style={{ padding: "8px", background: "rgba(72,227,161,0.1)", borderRadius: "8px", border: "1px solid rgba(72,227,161,0.3)" }}>
                <span>Final</span> <strong style={{ color: "#48e3a1", fontSize: "1.2em" }}>{selectedDerivedZone?.finalConfidence.toFixed(2) ?? "0.00"}</strong>
              </div>
            </div>
            <p className="helper-text">{confidenceStory}</p>
          </div>
          <div className="trust-panel-grid">
            {selectedReport ? (
              <div className="explain-layout">
                <div className="score-card">
                  <span>Trust State</span>
                  <strong>{selectedReport.trust.decayedTrust.toFixed(2)}</strong>
                  <em>{selectedReport.trust.state}</em>
                </div>
                <div className="breakdown">
                  <Breakdown label="Source prior" value={selectedReport.trust.sourcePrior} />
                  <Breakdown label="Cross-signal" value={selectedReport.trust.crossSignalAgreement} />
                  <Breakdown label="Temporal" value={selectedReport.trust.temporalConsistency} />
                  <Breakdown label="Contradiction" value={selectedReport.trust.contradictionScore} />
                  <Breakdown label="Language" value={selectedReport.trust.languageScore} />
                </div>
                <div className="detail-card">
                  <h3>Selected Report</h3>
                  <p>{selectedReport.text}</p>
                  <p className="helper-text">
                    {selectedReport.zone} | urgency {selectedReport.geminiOutput.urgency.toFixed(2)} | {selectedReport.geminiOutput.type}
                  </p>
                </div>
                <div className="detail-card">
                  <h3>Why It Matters</h3>
                  <ul>
                    {[...(selectedReport.ai?.reasoning ? [selectedReport.ai.reasoning] : []), ...selectedReport.trust.reasons].slice(0, 5).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
                <AIPanel
                  data={selectedReport.ai}
                  status={selectedAiStage}
                  queuePosition={selectedAiStage === "queued" ? aiQueuePosition || null : null}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel panel--right">
          <div className="panel-heading">
            <h2>Decision Authority</h2>
            <span className="panel-subtitle">What command should do next, backed by fused trust and satellite-aware confidence</span>
          </div>
          {selectedDerivedZone ? (
            <div className="authority-card">
              <span className="mission-label">Selected Zone</span>
              <h3>{selectedDerivedZone.zoneId}</h3>
              <div className={`authority-status authority-status--${trustMeterTone(selectedDerivedZone.finalConfidence)}`}>
                {displayDecisionState(selectedDerivedZone.decision)}
              </div>
              <div className="authority-grid">
                <div>
                  <span>STATUS</span>
                  <strong>{selectedDerivedZone.conflictLevel === "HIGH" ? "Misinformation hotspot" : "Low confidence state"}</strong>
                </div>
                <div>
                  <span>ACTION</span>
                  <strong>{displayDecisionState(selectedDerivedZone.decision)}</strong>
                </div>
                <div>
                  <span>SIGNALS</span>
                  <strong>{selectedDerivedZone.reports.length} reports</strong>
                </div>
                <div>
                  <span>NASA</span>
                  <strong>{selectedDerivedZone.nasaConfirmed ? "Confirmed" : "Not active"}</strong>
                </div>
                <div>
                  <span>URGENCY</span>
                  <strong>{selectedDerivedZone.urgencyScore >= 0.75 ? "HIGH" : selectedDerivedZone.urgencyScore >= 0.5 ? "MEDIUM" : "LOW"}</strong>
                </div>
                <div>
                  <span>TRUST</span>
                  <strong>{trustMeterLabel(selectedDerivedZone.finalConfidence)}</strong>
                </div>
              </div>
            </div>
          ) : null}
          <div className="decision-stack">
            {recommendations.map((recommendation, index) => (
              <div
                key={`${recommendation.zone}-${recommendation.rank}`}
                className={`decision-card ${recommendation.flag ? "decision-card--alert" : ""} ${
                  decisionShiftZone === recommendation.zone ? "decision-card--shift" : ""
                }`}
                onClick={() => setSelectedZoneId(recommendation.zone)}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="decision-card__rank">#{recommendation.rank}</div>
                <div className="decision-card__body">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <strong>{displayDecisionAction(recommendation.action)}</strong>
                      <span>{recommendation.zone}</span>
                    </div>
                    <div className={scoreBadgeClass(recommendation.confidence)}>{recommendation.confidence}</div>
                  </div>
                  <p>{recommendation.rationale}</p>
                  
                  {overrideTarget === recommendation.zone ? (
                    <form className="override-form action-panel" onClick={(e) => e.stopPropagation()} onSubmit={(e) => handleOperatorAction(recommendation, "OVERRIDDEN", e)}>
                      <p>Enter required reason for overriding system recommendation:</p>
                      <input 
                        type="text" 
                        value={overrideReason} 
                        onChange={(e) => setOverrideReason(e.target.value)} 
                        placeholder="e.g. Visual confirmation differs"
                        autoFocus
                        style={{ width: "100%", marginBottom: "8px", padding: "6px", background: "rgba(0,0,0,0.4)", border: "1px solid #73c7ef", color: "#fff" }}
                      />
                      <div className="button-row">
                        <button type="button" className="control-button" onClick={() => setOverrideTarget(null)}>Cancel</button>
                        <button type="submit" className="control-button control-button--chaos">Submit Override</button>
                      </div>
                    </form>
                  ) : (
                    <div className="decision-card__actions" style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                      <button 
                        type="button" 
                        className="control-button speed-pill--active" 
                        onClick={(e) => handleOperatorAction(recommendation, "CONFIRMED", e)}
                      >
                        Confirm Dispatch
                      </button>
                      <button 
                        type="button" 
                        className="control-button" 
                        onClick={(e) => { e.stopPropagation(); setOverrideTarget(recommendation.zone); }}
                      >
                        Override
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel panel--thinking">
          <div className="panel-heading">
            <h2>Live Event Feed</h2>
            <span className="panel-subtitle">Streaming system updates that make the intelligence loop visible</span>
          </div>
          <div className="thinking-console">
            {feedEvents.map((event, index) => (
              <article key={event.id} className={`thinking-line thinking-line--${event.tone}`} style={{ animationDelay: `${index * 40}ms` }}>
                <span className="thinking-line__time">{typeof event.minute === "number" ? `+${event.minute.toString().padStart(2, "0")}s` : "LIVE"}</span>
                <strong>{event.label}</strong>
                <span>{event.detail}</span>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Breakdown({ label, value }: { label: string; value: number }) {
  return (
    <div className="breakdown-row">
      <div className="breakdown-meta">
        <span>{label}</span>
        <strong>{value.toFixed(2)}</strong>
      </div>
      <div className="breakdown-bar">
        <div className="breakdown-fill" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ label, ready }: { label: string; ready: boolean }) {
  return <span className={`status-pill ${ready ? "status-pill--ready" : "status-pill--pending"}`}>{label}</span>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function displayDecisionState(decision: string): string {
  if (decision === "MONITOR") {
    return "MONITOR";
  }

  if (decision === "VERIFY") {
    return "PARTIAL RESPONSE";
  }

  if (decision === "HOLD") {
    return "DO NOT DISPATCH";
  }

  return "DISPATCH";
}

function displayDecisionAction(action: string): string {
  return action.replace("VERIFY + LIMITED RESPONSE", "PARTIAL RESPONSE").replace("Monitor situation", "MONITOR");
}

function trustMeterTone(value: number): "low" | "medium" | "high" {
  if (value >= 0.75) {
    return "high";
  }

  if (value >= 0.5) {
    return "medium";
  }

  return "low";
}

function trustMeterLabel(value: number): string {
  if (value >= 0.75) {
    return "HIGH TRUST";
  }

  if (value >= 0.5) {
    return "MEDIUM TRUST";
  }

  return "LOW TRUST";
}
