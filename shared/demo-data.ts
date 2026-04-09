import type { CrisisReport, ResourcePool } from "./crisis";

export const demoResources: ResourcePool = {
  rescueBoats: 3,
  medicalTeams: 2,
  helicopters: 1
};

export const demoReports: CrisisReport[] = [
  {
    id: "r1",
    source: "GDACS",
    sourceType: "verified_org",
    text: "Severe flooding reported with stranded households near Zone A riverbank.",
    timestamp: "2026-04-09T08:00:00.000Z",
    lat: 13.0827,
    lng: 80.2707,
    zone: "Zone A",
    geminiOutput: {
      type: "flood",
      urgency: 0.92,
      needs: ["rescue", "medical"],
      tone: "factual"
    },
    contradictionSignals: 0
  },
  {
    id: "r2",
    source: "ReliefWeb Partner",
    sourceType: "ngo",
    text: "Community volunteers confirm floodwater rise and injuries in Zone A.",
    timestamp: "2026-04-09T08:06:00.000Z",
    lat: 13.084,
    lng: 80.2725,
    zone: "Zone A",
    geminiOutput: {
      type: "injury",
      urgency: 0.84,
      needs: ["medical", "rescue"],
      tone: "factual"
    },
    contradictionSignals: 0
  },
  {
    id: "r3",
    source: "Social Stream",
    sourceType: "anonymous",
    text: "Airport completely flooded. Hundreds trapped. No help coming.",
    timestamp: "2026-04-09T08:08:00.000Z",
    lat: 13.1986,
    lng: 80.1692,
    zone: "Zone B",
    geminiOutput: {
      type: "flood",
      urgency: 0.95,
      needs: ["rescue"],
      tone: "exaggerated"
    },
    contradictionSignals: 2
  },
  {
    id: "r4",
    source: "Local Volunteer Feed",
    sourceType: "unknown",
    text: "Possible flooding around airport access road in Zone B.",
    timestamp: "2026-04-09T08:10:00.000Z",
    lat: 13.197,
    lng: 80.1704,
    zone: "Zone B",
    geminiOutput: {
      type: "flood",
      urgency: 0.62,
      needs: ["rescue"],
      tone: "emotional"
    },
    contradictionSignals: 1
  },
  {
    id: "r5",
    source: "Airport NGO Liaison",
    sourceType: "ngo",
    text: "Airport remains operational with no flooding inside the terminal zone.",
    timestamp: "2026-04-09T08:14:00.000Z",
    lat: 13.1994,
    lng: 80.172,
    zone: "Zone B",
    geminiOutput: {
      type: "infrastructure",
      urgency: 0.21,
      needs: ["food"],
      tone: "factual"
    },
    contradictionSignals: 0
  },
  {
    id: "r6",
    source: "Relief Camp Desk",
    sourceType: "ngo",
    text: "Families displaced in Zone C need shelter and food packs.",
    timestamp: "2026-04-09T08:12:00.000Z",
    lat: 13.056,
    lng: 80.245,
    zone: "Zone C",
    geminiOutput: {
      type: "shelter",
      urgency: 0.73,
      needs: ["shelter", "food"],
      tone: "factual"
    },
    contradictionSignals: 0
  }
];
