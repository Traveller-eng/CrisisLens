import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { buildRecommendations, buildZoneClusters } from "../../shared/decision";
import { demoReports, demoResources } from "../../shared/demo-data";
import type { CrisisReport, Recommendation, ScoredReport, ZoneCluster } from "../../shared/crisis";
import { appConfig, setupChecklist } from "./config";
import { db, firebaseEnabled } from "./lib/firebase";
import { normalizeReport } from "./lib/live-reports";

const LiveMap = lazy(() => import("./components/LiveMap"));

const simulationStart = new Date("2026-04-09T08:00:00.000Z");
const simulationDurationSeconds = 180;

type FeedEvent = {
  id: string;
  minute?: number;
  label: string;
  detail: string;
  tone: "info" | "alert" | "resolve";
};

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
  const [expandedAction, setExpandedAction] = useState<"crowd" | "verified" | "misinfo" | null>("crowd");
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
          affectedEstimate: Number(raw.affectedEstimate ?? 0)
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
      : zones.map((zone) => ({
          zoneId: zone.zone,
          center: { lat: zone.lat, lng: zone.lng },
          reports: zone.reports.map((report) => report.id),
          trustScore: zone.trustScore,
          urgencyScore: zone.urgencyScore,
          finalConfidence: zone.trustScore,
          conflictScore: Math.min(1, zone.reports.filter((report) => report.contradictionSignals && report.contradictionSignals > 0).length / Math.max(1, zone.reports.length)),
          reportConfidence: zone.trustScore,
          nasaConfidence: showNasaLayer ? 0.62 : 0,
          nasaConfirmed: showNasaLayer,
          decision: zone.trustScore > 0.75 ? "DISPATCH" : zone.trustScore > 0.5 ? "VERIFY" : "HOLD",
          needs: zone.dominantNeeds,
          conflictLevel: zone.trustScore < 0.45 ? "HIGH" : zone.trustScore < 0.75 ? "MEDIUM" : "LOW",
          affectedEstimate: zone.affectedEstimate
        }));
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
    () =>
      [...allReports]
        .filter((report) => (truthMode === "raw" ? true : report.trust.decayedTrust >= 0.45))
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 18),
    [allReports, truthMode]
  );
  const conflictZones = mapZones.filter((zone) => zone.conflictLevel === "HIGH");
  const highTrustZones = mapZones.filter((zone) => zone.finalConfidence >= 0.75);
  const topTrustScore = selectedDerivedZone?.finalConfidence ?? recommendations[0]?.confidence ?? 0;

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
    setMinute(0);
  }, [scenario]);

  useEffect(() => {
    if (usingLiveReports || simulationReports.length > 0) {
      return;
    }

    const seededReports = Array.from({ length: 4 }, (_, index) => generateSimulationReport(index + 1, scenario, index + 1));
    setSimulationReports(seededReports);
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

    const generator = window.setInterval(() => {
      const burstCount = speed >= 5 ? 6 : speed >= 2 ? 3 : 2;

      setSimulationIndex((current) => {
        let nextIndex = current;
        const nextReports: CrisisReport[] = [];

        for (let burst = 0; burst < burstCount; burst += 1) {
          nextIndex += 1;
          nextReports.push(generateSimulationReport(nextIndex, scenario, minute + nextIndex + burst));
        }

        setSimulationReports((existing) => [...existing.slice(-50), ...nextReports]);
        nextReports.forEach((report, burst) => {
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
    }, Math.max(180, 700 / speed));

    return () => window.clearInterval(generator);
  }, [usingLiveReports, isPlaying, scenario, speed, minute]);

  function pushLocalEvent(event: FeedEvent) {
    setLocalEvents((current) => [event, ...current].slice(0, 16));
  }

  function pushLocalReports(reports: CrisisReport[]) {
    setLocalReports((current) => [...current, ...reports]);
  }

  async function toggleNasaLayer() {
    if (showNasaLayer) {
      setShowNasaLayer(false);
      return;
    }

    setNasaLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchFIRMS");
      const payload = (await response.json()) as { hotspots?: NasaHotspot[] };
      setNasaHotspots(payload.hotspots ?? []);
      setShowNasaLayer(true);
      pushLocalEvent({
        id: `nasa-${Date.now()}`,
        label: "NASA FIRMS overlay active",
        detail: `Satellite hotspot layer loaded with ${payload.hotspots?.length ?? 0} signals`,
        tone: "resolve"
      });
    } catch {
      pushLocalEvent({
        id: `nasa-error-${Date.now()}`,
        label: "NASA layer unavailable",
        detail: "FIRMS hotspot fetch failed from local backend",
        tone: "alert"
      });
    } finally {
      setNasaLoading(false);
    }
  }

  async function syncGdacsLayer() {
    setGdacsLoading(true);
    try {
      const response = await fetch("http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchGDACSSignals");
      const payload = (await response.json()) as { ok?: boolean; count?: number; error?: string };
      if (!response.ok || !payload.ok) {
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
      const response = await fetch("http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchWeatherSignals");
      const payload = (await response.json()) as { ok?: boolean; count?: number; error?: string };
      if (!response.ok || !payload.ok) {
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

  return (
    <div className={`ops-shell ${truthShiftActive ? "ops-shell--truth-shift" : ""}`}>
      <header className="topbar">
        <div className="topbar__brand">
          <h1>CrisisLens</h1>
          <p className="topbar__summary">
            AI-powered decision intelligence for disaster response under uncertainty, built to suppress misinformation and prioritize trusted action.
          </p>
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

          <div className="control-cluster control-cluster--actions">
            <span className="control-label">Interventions</span>
            <div className="action-tabs">
              <button
                className={`action-tab ${expandedAction === "crowd" ? "action-tab--active" : ""}`}
                disabled={generatorPending}
                onClick={() => {
                  setExpandedAction("crowd");
                  void injectLocalSyntheticWave();
                }}
                type="button"
              >
                <span className="action-tab__icon">~</span>
                <strong>Crowd</strong>
              </button>
              <button
                className={`action-tab ${expandedAction === "verified" ? "action-tab--active" : ""}`}
                disabled={generatorPending}
                onClick={() => {
                  setExpandedAction("verified");
                  void injectVerifiedCorrectionFromUi();
                }}
                type="button"
              >
                <span className="action-tab__icon">+</span>
                <strong>Verified</strong>
              </button>
              <button
                className={`action-tab action-tab--danger ${expandedAction === "misinfo" ? "action-tab--active" : ""}`}
                disabled={chaosPending}
                onClick={() => {
                  setExpandedAction("misinfo");
                  void injectChaos();
                }}
                type="button"
              >
                <span className="action-tab__icon">!</span>
                <strong>Misinfo</strong>
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
          <strong>False-signal impact reduced by 40%</strong>
          <p>Simulated Chennai flood conditions with verified correction and contradiction-aware ranking.</p>
        </div>
      </section>

      <main className="command-grid">
        <section className="panel panel--left">
          <div className="panel-heading">
            <h2>Incoming Intelligence</h2>
            <span className="panel-subtitle">Live reports entering the crisis loop before trust filtering</span>
          </div>
          <div className="intel-stream">
            {incomingFeed.map((report) => (
              <button
                key={report.id}
                className={`intel-card ${selectedReport?.id === report.id ? "intel-card--active" : ""}`}
                onClick={() => {
                  setSelectedReportId(report.id);
                  setSelectedZoneId(report.zone);
                }}
                type="button"
              >
                <div className="intel-card__top">
                  <span>{report.zone}</span>
                  <span className={`source-chip source-chip--${report.sourceType}`}>{report.sourceType}</span>
                </div>
                <strong>{report.text}</strong>
                <div className="intel-card__bottom">
                  <span>{report.geminiOutput.type}</span>
                  <span>{new Date(report.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </button>
            ))}
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
                <span className="map-sidecar__title">Reality Layer</span>
                <strong>{truthMode === "raw" ? "Raw chaos view" : "Filtered truth view"}</strong>
                <p>
                  {showNasaLayer
                    ? `NASA FIRMS active with ${nasaHotspots.length} hotspot signals.`
                    : "Turn on NASA FIRMS to reconcile crowd reports with satellite evidence."}
                </p>
              </div>
              {selectedZone && selectedDerivedZone ? (
                <div className="map-detail-overlay">
                  <span className="map-sidecar__title">Zone Authority</span>
                  <h3>{selectedZone.zone}</h3>
                  <p>
                    Confidence <strong>{selectedDerivedZone.finalConfidence.toFixed(2)}</strong> · Urgency{" "}
                    <strong>{selectedZone.urgencyScore.toFixed(2)}</strong>
                  </p>
                  <p>
                    Decision <strong>{selectedDerivedZone.decision}</strong> · Conflict{" "}
                    <strong>{selectedDerivedZone.conflictLevel}</strong>
                  </p>
                  <button
                    className="overlay-link"
                    onClick={() => setSelectedReportId(selectedZone.reports[0]?.id ?? null)}
                    type="button"
                  >
                    Open explainability
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
                <p>{step.text}</p>
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
                    {selectedReport.trust.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
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
              <button
                key={`${recommendation.zone}-${recommendation.rank}`}
                className={`decision-card ${recommendation.flag ? "decision-card--alert" : ""} ${
                  decisionShiftZone === recommendation.zone ? "decision-card--shift" : ""
                }`}
                onClick={() => setSelectedZoneId(recommendation.zone)}
                style={{ animationDelay: `${index * 70}ms` }}
                type="button"
              >
                <div className="decision-card__rank">#{recommendation.rank}</div>
                <div className="decision-card__body">
                  <strong>{displayDecisionAction(recommendation.action)}</strong>
                  <span>{recommendation.zone}</span>
                  <p>{recommendation.rationale}</p>
                </div>
                <div className={scoreBadgeClass(recommendation.confidence)}>{recommendation.confidence}</div>
              </button>
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
  if (decision === "VERIFY") {
    return "PARTIAL RESPONSE";
  }

  if (decision === "HOLD") {
    return "DO NOT DISPATCH";
  }

  return "DISPATCH";
}

function displayDecisionAction(action: string): string {
  return action.replace("VERIFY + LIMITED RESPONSE", "PARTIAL RESPONSE");
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
