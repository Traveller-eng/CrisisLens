import type { AIAnalysis, CrisisReport, ResourcePool } from "./crisis";

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
    contradictionSignals: 0,
    ai: {
      type: "flood",
      severity: 0.88,
      confidence: 0.92,
      claim: "positive",
      entities: ["Zone A riverbank", "households"],
      urgency: 0.92,
      reasoning: "Verified source confirms active flooding with stranded residents requiring immediate rescue.",
      contradictionSignal: "none",
      isFallback: false
    }
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
    contradictionSignals: 0,
    ai: {
      type: "injury",
      severity: 0.76,
      confidence: 0.85,
      claim: "positive",
      entities: ["Zone A", "community volunteers"],
      urgency: 0.84,
      reasoning: "NGO-confirmed report of rising floodwater and injuries aligns with Zone A flood pattern.",
      contradictionSignal: "none",
      isFallback: false
    }
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
    contradictionSignals: 2,
    claim: "negative",
    ai: {
      type: "flood",
      severity: 0.91,
      confidence: 0.38,
      claim: "negative",
      entities: ["airport"],
      urgency: 0.95,
      reasoning: "Anonymous report uses absolute language ('completely', 'no help') typical of exaggeration. Contradicts verified operational status of airport.",
      contradictionSignal: "high",
      isFallback: false
    }
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
    contradictionSignals: 1,
    ai: {
      type: "flood",
      severity: 0.52,
      confidence: 0.48,
      claim: "neutral",
      entities: ["airport access road", "Zone B"],
      urgency: 0.62,
      reasoning: "Hedged language ('possible') indicates uncertainty. Partial corroboration of Zone B flooding but below confirmation threshold.",
      contradictionSignal: "low",
      isFallback: false
    }
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
    contradictionSignals: 0,
    ai: {
      type: "infrastructure",
      severity: 0.18,
      confidence: 0.82,
      claim: "negative",
      entities: ["airport", "terminal zone"],
      urgency: 0.21,
      reasoning: "NGO liaison directly contradicts prior airport flood claims. High-trust source denying crisis indicates misinformation in earlier reports.",
      contradictionSignal: "high",
      isFallback: false
    }
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
    contradictionSignals: 0,
    ai: {
      type: "shelter",
      severity: 0.65,
      confidence: 0.79,
      claim: "positive",
      entities: ["Zone C", "families"],
      urgency: 0.73,
      reasoning: "Relief camp confirms displacement and active shelter need. Consistent with regional flood displacement pattern.",
      contradictionSignal: "none",
      isFallback: false
    }
  }
];

/** Pre-computed AI analysis for synthetic simulation report texts. Keyed by exact text. */
export const precomputedAiMap: Record<string, AIAnalysis> = {
  // Phase A — Zone A flood reports
  "Water rising fast near riverbank homes in Zone A": { type: "flood", severity: 0.74, confidence: 0.82, claim: "positive", entities: ["riverbank", "Zone A"], urgency: 0.78, reasoning: "Direct observation of rising water near residential area consistent with active flooding.", contradictionSignal: "none", isFallback: false },
  "Floodwater entering streets near shelters, multiple families affected": { type: "flood", severity: 0.78, confidence: 0.84, claim: "positive", entities: ["streets", "shelters", "families"], urgency: 0.82, reasoning: "Multiple families affected by floodwater entering populated areas signals escalating flood.", contradictionSignal: "none", isFallback: false },
  "Rescue support needed for stranded families near Zone A bridge": { type: "flood", severity: 0.81, confidence: 0.86, claim: "positive", entities: ["Zone A bridge", "families"], urgency: 0.85, reasoning: "Stranded families near bridge indicate flood-blocked access requiring rescue deployment.", contradictionSignal: "none", isFallback: false },
  "Verified NDRF update: rescue boats deployed in Zone A sector": { type: "flood", severity: 0.72, confidence: 0.94, claim: "positive", entities: ["NDRF", "rescue boats", "Zone A"], urgency: 0.80, reasoning: "Verified NDRF deployment confirms active flood response in Zone A.", contradictionSignal: "none", isFallback: false },
  "NGO field team confirms widespread flooding and evacuation need": { type: "flood", severity: 0.82, confidence: 0.88, claim: "positive", entities: ["NGO field team"], urgency: 0.86, reasoning: "NGO ground confirmation of widespread flooding elevates confidence and urgency.", contradictionSignal: "none", isFallback: false },
  "Verified command: Zone A flood confirmed, rescue operations underway": { type: "flood", severity: 0.76, confidence: 0.95, claim: "positive", entities: ["Zone A", "rescue operations"], urgency: 0.84, reasoning: "Verified command confirmation makes this the highest-trust signal for Zone A flooding.", contradictionSignal: "none", isFallback: false },
  // Phase B — Zone B contradiction arc
  "Airport flooded, hundreds stranded on approach roads": { type: "infrastructure", severity: 0.85, confidence: 0.35, claim: "negative", entities: ["airport", "approach roads"], urgency: 0.88, reasoning: "Anonymous report claims mass stranding at airport. Exaggerated language lowers confidence.", contradictionSignal: "high", isFallback: false },
  "Bridge collapsed near airport, total access lost": { type: "infrastructure", severity: 0.92, confidence: 0.32, claim: "negative", entities: ["bridge", "airport"], urgency: 0.90, reasoning: "Unverified bridge collapse claim contradicts later operational reports. High misinformation risk.", contradictionSignal: "high", isFallback: false },
  "Local volunteer reports partial flooding near terminal": { type: "flood", severity: 0.55, confidence: 0.52, claim: "neutral", entities: ["terminal"], urgency: 0.58, reasoning: "Partial flooding report adds nuance but hedged language keeps confidence moderate.", contradictionSignal: "low", isFallback: false },
  "People trapped near airport approach, conflicting details": { type: "infrastructure", severity: 0.68, confidence: 0.40, claim: "negative", entities: ["airport approach"], urgency: 0.72, reasoning: "Report itself acknowledges conflicting details, triggering contradiction signal.", contradictionSignal: "high", isFallback: false },
  "NGO liaison: airport operational with minor waterlogging only": { type: "infrastructure", severity: 0.28, confidence: 0.78, claim: "negative", entities: ["airport"], urgency: 0.32, reasoning: "NGO correction downgrades airport flooding to minor waterlogging, contradicting crisis claims.", contradictionSignal: "high", isFallback: false },
  "Verified correction: airport operational, no full flooding observed": { type: "infrastructure", severity: 0.22, confidence: 0.91, claim: "negative", entities: ["airport"], urgency: 0.25, reasoning: "Verified source definitively denies airport flooding, suppressing earlier misinformation.", contradictionSignal: "high", isFallback: false },
  // Phase C — Zone C misinformation burst
  "BREAKING: dam burst imminent, Zone C will be completely submerged": { type: "flood", severity: 0.95, confidence: 0.18, claim: "negative", entities: ["dam", "Zone C"], urgency: 0.92, reasoning: "Unverified 'BREAKING' dam burst claim with absolute language is high misinformation risk.", contradictionSignal: "high", isFallback: false },
  "Unconfirmed surge report spreading on social media for Zone C": { type: "flood", severity: 0.72, confidence: 0.22, claim: "negative", entities: ["social media", "Zone C"], urgency: 0.68, reasoning: "Social media surge report explicitly flagged as unconfirmed. Low reliability.", contradictionSignal: "high", isFallback: false },
  "Anonymous tip: massive chemical leak in Zone C floodwater": { type: "flood", severity: 0.88, confidence: 0.15, claim: "negative", entities: ["chemical leak", "Zone C"], urgency: 0.85, reasoning: "Anonymous chemical leak claim has no corroboration and escalates panic. Strong misinformation signal.", contradictionSignal: "high", isFallback: false },
  "Rumor mill: Zone C shelters destroyed, hundreds missing": { type: "shelter", severity: 0.90, confidence: 0.12, claim: "negative", entities: ["shelters", "Zone C"], urgency: 0.88, reasoning: "Self-identified rumor about shelter destruction. Zero credibility, maximum panic potential.", contradictionSignal: "high", isFallback: false },
  "Panic reports: Zone C roads and bridges all collapsed": { type: "infrastructure", severity: 0.92, confidence: 0.14, claim: "negative", entities: ["roads", "bridges", "Zone C"], urgency: 0.90, reasoning: "Mass infrastructure collapse claim from panic source. No verified corroboration.", contradictionSignal: "high", isFallback: false },
  "Social media frenzy: Zone C declared total disaster zone by unknown source": { type: "flood", severity: 0.88, confidence: 0.10, claim: "negative", entities: ["Zone C", "unknown source"], urgency: 0.86, reasoning: "Declaration from unknown source lacks authority. Social media amplification of unverified claim.", contradictionSignal: "high", isFallback: false },
  // Generic simulation text pool
  "Water rising rapidly in residential lanes": { type: "flood", severity: 0.72, confidence: 0.75, claim: "positive", entities: ["residential lanes"], urgency: 0.76, reasoning: "Direct flood observation in residential area signals active water rise.", contradictionSignal: "none", isFallback: false },
  "Families stranded near low-lying area": { type: "flood", severity: 0.78, confidence: 0.77, claim: "positive", entities: ["families", "low-lying area"], urgency: 0.80, reasoning: "Stranded families in flood-prone geography consistent with flood impact.", contradictionSignal: "none", isFallback: false },
  "Floodwaters cutting off access routes": { type: "flood", severity: 0.74, confidence: 0.79, claim: "positive", entities: ["access routes"], urgency: 0.78, reasoning: "Access routes cut off implies isolation requiring coordinated rescue.", contradictionSignal: "none", isFallback: false },
  "Bridge damage reported by locals": { type: "infrastructure", severity: 0.68, confidence: 0.62, claim: "positive", entities: ["bridge"], urgency: 0.70, reasoning: "Local report of bridge damage. Moderate confidence pending verification.", contradictionSignal: "none", isFallback: false },
  "Road access blocked by debris": { type: "infrastructure", severity: 0.65, confidence: 0.70, claim: "positive", entities: ["road", "debris"], urgency: 0.68, reasoning: "Debris blocking road access consistent with flood or structural damage aftermath.", contradictionSignal: "none", isFallback: false },
  "Structural failure suspected near transit line": { type: "infrastructure", severity: 0.72, confidence: 0.58, claim: "positive", entities: ["transit line"], urgency: 0.74, reasoning: "Suspected structural failure near transit requires immediate assessment.", contradictionSignal: "low", isFallback: false },
  "Injuries reported near collapsed structure": { type: "injury", severity: 0.82, confidence: 0.74, claim: "positive", entities: ["collapsed structure"], urgency: 0.85, reasoning: "Injuries from structural collapse requires medical and rescue priority.", contradictionSignal: "none", isFallback: false },
  "Medical teams needed for trapped residents": { type: "injury", severity: 0.79, confidence: 0.80, claim: "positive", entities: ["trapped residents"], urgency: 0.83, reasoning: "Trapped residents needing medical teams indicates active rescue scenario.", contradictionSignal: "none", isFallback: false },
  "Casualties reported after impact": { type: "injury", severity: 0.88, confidence: 0.72, claim: "positive", entities: [], urgency: 0.90, reasoning: "Casualty report escalates severity. Source verification needed for confidence.", contradictionSignal: "none", isFallback: false },
  "Shelter camp filling rapidly": { type: "shelter", severity: 0.62, confidence: 0.78, claim: "positive", entities: ["shelter camp"], urgency: 0.65, reasoning: "Rapid shelter filling indicates displacement surge requiring capacity management.", contradictionSignal: "none", isFallback: false },
  "Families need temporary shelter and food": { type: "shelter", severity: 0.65, confidence: 0.80, claim: "positive", entities: ["families"], urgency: 0.70, reasoning: "Direct shelter and food need from displaced families.", contradictionSignal: "none", isFallback: false },
  "Evacuation center nearing capacity": { type: "shelter", severity: 0.68, confidence: 0.82, claim: "positive", entities: ["evacuation center"], urgency: 0.72, reasoning: "Evacuation center at capacity requires overflow planning.", contradictionSignal: "none", isFallback: false },
  // Chaos injection reports
  "Bridge collapse rumors spreading fast near Zone B. Multiple stranded commuters reported.": { type: "infrastructure", severity: 0.82, confidence: 0.30, claim: "negative", entities: ["bridge", "Zone B", "commuters"], urgency: 0.85, reasoning: "Self-identified rumor about bridge collapse with exaggerated commuter stranding. High misinformation risk.", contradictionSignal: "high", isFallback: false },
  "Verified field responder says traffic is moving and bridge remains operational in Zone B.": { type: "infrastructure", severity: 0.22, confidence: 0.88, claim: "negative", entities: ["bridge", "Zone B"], urgency: 0.25, reasoning: "Verified correction confirming bridge operational. Contradicts collapse rumors.", contradictionSignal: "high", isFallback: false },
  "Fresh flood surge reported around Zone A shelters, evacuation support may be needed.": { type: "flood", severity: 0.78, confidence: 0.82, claim: "positive", entities: ["Zone A shelters"], urgency: 0.80, reasoning: "NGO-sourced flood surge report near shelters is credible and urgent.", contradictionSignal: "none", isFallback: false },
  // Verified correction
  "Verified command update: bridge remains operational and no full collapse is confirmed.": { type: "infrastructure", severity: 0.18, confidence: 0.93, claim: "negative", entities: ["bridge"], urgency: 0.20, reasoning: "Highest-trust correction definitively denying bridge collapse. Suppresses all prior misinformation.", contradictionSignal: "high", isFallback: false },
  // Crowd wave injection
  "Water rising fast": { type: "flood", severity: 0.70, confidence: 0.68, claim: "positive", entities: [], urgency: 0.74, reasoning: "Short crowd report consistent with active flooding.", contradictionSignal: "none", isFallback: false },
  "People stuck here": { type: "flood", severity: 0.72, confidence: 0.60, claim: "positive", entities: [], urgency: 0.78, reasoning: "Distress signal from stranded individuals.", contradictionSignal: "none", isFallback: false },
  "Road blocked": { type: "infrastructure", severity: 0.58, confidence: 0.65, claim: "positive", entities: ["road"], urgency: 0.62, reasoning: "Road blockage report requires access route assessment.", contradictionSignal: "none", isFallback: false },
  "Bridge collapsed": { type: "infrastructure", severity: 0.85, confidence: 0.55, claim: "positive", entities: ["bridge"], urgency: 0.88, reasoning: "Bridge collapse claim from crowd source. Needs verification.", contradictionSignal: "low", isFallback: false },
  "Shelter supplies running low": { type: "supply", severity: 0.55, confidence: 0.75, claim: "positive", entities: ["shelter"], urgency: 0.60, reasoning: "Supply shortage at shelter requiring resupply coordination.", contradictionSignal: "none", isFallback: false }
};
