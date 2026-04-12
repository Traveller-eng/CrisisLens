export type SourceType = "verified_org" | "ngo" | "unknown" | "anonymous";
export type CrisisType = "flood" | "injury" | "infrastructure" | "shelter";
export type NeedType = "rescue" | "medical" | "food" | "shelter";
export type ToneType = "factual" | "emotional" | "exaggerated";
export type TrustState = "VERIFIED" | "UNCERTAIN" | "FALSE";
export type ClaimType = "positive" | "negative" | "neutral";
export type ContradictionSignal = "high" | "low" | "none";
export type AIAnalysis = {
  type: "flood" | "fire" | "earthquake" | "infrastructure" | "injury" | "shelter" | "supply" | "unknown";
  severity: number;
  confidence: number;
  claim: ClaimType;
  entities: string[];
  urgency?: number;
  reasoning?: string;
  contradictionSignal?: ContradictionSignal;
  isFallback?: boolean;
};

export type CrisisReport = {
  id: string;
  source: string;
  sourceType: SourceType;
  text: string;
  timestamp: string;
  lat: number;
  lng: number;
  zone: string;
  geminiOutput: {
    type: CrisisType;
    urgency: number;
    needs: NeedType[];
    tone: ToneType;
  };
  contradictionSignals?: number;
  claim?: ClaimType;
  ai?: AIAnalysis;
};

export type NasaSignal = {
  id: string;
  lat: number;
  lng: number;
  type: "heat" | "flood";
  intensity: number;
  confidence: number;
  timestamp: string;
};

export type TrustBreakdown = {
  sourcePrior: number;
  crossSignalAgreement: number;
  temporalConsistency: number;
  contradictionScore: number;
  languageScore: number;
  baseTrust: number;
  decayedTrust: number;
  minutesSinceReport: number;
  state: TrustState;
  reasons: string[];
};

export type ScoredReport = CrisisReport & {
  trust: TrustBreakdown;
};

export type ZoneCluster = {
  zone: string;
  lat: number;
  lng: number;
  reports: ScoredReport[];
  verifiedReports: ScoredReport[];
  trustScore: number;
  urgencyScore: number;
  dominantNeeds: NeedType[];
  affectedEstimate: number;
};

export type ResourcePool = {
  rescueBoats: number;
  medicalTeams: number;
  helicopters: number;
};

export type Recommendation = {
  rank: number;
  action: string;
  zone: string;
  confidence: number;
  rationale: string;
  flag?: "MISINFORMATION_RISK";
};
