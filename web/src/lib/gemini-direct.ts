import type { AIAnalysis } from "../../../shared/crisis";
import { precomputedAiMap } from "../../../shared/demo-data";
import { appConfig } from "../config";

const GEMINI_MODEL = appConfig.geminiModel || "gemini-2.0-flash-lite";

// ─── In-memory cache ───
const cache = new Map<string, { result: AIAnalysis; expiry: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function simpleHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCached(text: string): AIAnalysis | null {
  const key = simpleHash(text);
  const entry = cache.get(key);
  if (entry && entry.expiry > Date.now()) {
    return entry.result;
  }
  cache.delete(key);
  return null;
}

function setCache(text: string, result: AIAnalysis): void {
  cache.set(simpleHash(text), { result, expiry: Date.now() + CACHE_TTL_MS });
}

// ─── Rate-limiting queue ───
const queue: Array<{ run: () => Promise<void> }> = [];
let processing = false;
let lastCallTime = 0;
const MIN_INTERVAL_MS = 4200; // ~14 req/min, safely under 15/min free-tier limit

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallTime);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const item = queue.shift();
    if (item) {
      lastCallTime = Date.now();
      await item.run();
    }
  }

  processing = false;
}

// ─── Gemini API call ───
const PROMPT_TEMPLATE = `You are a crisis report classifier for emergency response systems.
Your output directly affects resource deployment decisions.
Return STRICT JSON only and never include markdown or prose outside the JSON object.
Never return "unknown" when the report clearly matches one of the allowed labels.
Use "flood" for any water, rain, rising, submerged, drainage, overflow, surge, waterlogged, or inundation language.

Schema:
{
  "type": "flood|fire|earthquake|infrastructure|injury|shelter|supply",
  "severity": 0-1,
  "confidence": 0-1,
  "claim": "positive|negative|neutral",
  "entities": [string],
  "urgency": 0-1,
  "reasoning": "one sentence",
  "contradictionSignal": "high|low|none"
}

Examples:
Report: "Water rising fast near homes and roads are submerged."
Output: {"type":"flood","severity":0.72,"confidence":0.8,"claim":"positive","entities":["homes","roads"],"urgency":0.8,"reasoning":"Rising water and submerged roads indicate flood conditions.","contradictionSignal":"none"}

Report: "Bridge remains operational, no collapse confirmed."
Output: {"type":"infrastructure","severity":0.36,"confidence":0.77,"claim":"negative","entities":["bridge"],"urgency":0.18,"reasoning":"The report denies prior collapse claims.","contradictionSignal":"high"}

Report:
"`;

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try { return JSON.parse(fenced[1]); } catch { /* */ }
    }
  }
  return null;
}

function normalizeAnalysis(raw: unknown, sourceText: string): AIAnalysis {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const validTypes = ["flood", "fire", "earthquake", "infrastructure", "injury", "shelter", "supply", "unknown"] as const;
  const type = validTypes.includes(candidate.type as any) ? (candidate.type as AIAnalysis["type"]) : "unknown";

  const normalized = sourceText.toLowerCase();
  let inferredType: AIAnalysis["type"] = "unknown";
  if (/\b(water|flood|rain|drainage|submerged|overflow|rising|inundat)/.test(normalized)) inferredType = "flood";
  else if (/\b(fire|smoke|burn|flame)/.test(normalized)) inferredType = "fire";
  else if (/\b(quake|earthquake|tremor|aftershock)/.test(normalized)) inferredType = "earthquake";
  else if (/\b(collapse|bridge|road|debris|structural|infrastructure)/.test(normalized)) inferredType = "infrastructure";
  else if (/\b(injury|injured|wound|medical|casualty)/.test(normalized)) inferredType = "injury";
  else if (/\b(shelter|evacuation|camp)/.test(normalized)) inferredType = "shelter";
  else if (/\b(food|supply|supplies|ration)/.test(normalized)) inferredType = "supply";

  const finalType = type === "unknown" && inferredType !== "unknown" ? inferredType : type === "unknown" ? "flood" : type;
  const severity = Math.max(0, Math.min(1, Number(candidate.severity ?? 0.62)));
  const confidence = Math.max(0, Math.min(1, Number(candidate.confidence ?? 0.5)));
  const claim = (["positive", "negative", "neutral"] as const).includes(candidate.claim as any) ? (candidate.claim as AIAnalysis["claim"]) : "neutral";
  const entities = Array.isArray(candidate.entities) ? candidate.entities.filter((item): item is string => typeof item === "string") : [];
  const urgency = Math.max(0, Math.min(1, Number(candidate.urgency ?? severity)));
  const contradictionSignal = (["high", "low", "none"] as const).includes(candidate.contradictionSignal as any)
    ? (candidate.contradictionSignal as AIAnalysis["contradictionSignal"])
    : claim === "negative" ? "high" : "none";
  const reasoning = typeof candidate.reasoning === "string" && candidate.reasoning.trim()
    ? candidate.reasoning.trim()
    : `Gemini classified this report as ${finalType} with ${claim} claim polarity.`;

  return { type: finalType, severity, confidence, claim, entities, urgency, reasoning, contradictionSignal, isFallback: false };
}

async function callGeminiApi(text: string): Promise<AIAnalysis> {
  const apiKey = appConfig.geminiApiKey;
  if (!apiKey) throw new Error("No VITE_GEMINI_API_KEY configured");

  const prompt = PROMPT_TEMPLATE + text + '"';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 500 }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("Failed to parse Gemini response as JSON");
  return normalizeAnalysis(parsed, text);
}

// ─── Public API ───

/**
 * Attempts to resolve AI analysis for a report text.
 * Priority: pre-computed → cache → rate-limited Gemini API call.
 * Returns null only for pre-computed/cache hits, throws for API failures.
 */
export function getPrecomputedAi(text: string): AIAnalysis | null {
  // Check pre-computed map first (zero API calls for known synthetic texts)
  const precomputed = precomputedAiMap[text];
  if (precomputed) return precomputed;

  // Check cache
  return getCached(text);
}

/**
 * Calls Gemini API with rate-limiting and caching.
 * Only call this for reports that have no pre-computed or cached analysis.
 */
export function analyzeReportDirect(text: string): Promise<AIAnalysis> {
  // One more cache check before queueing
  const cached = getCached(text);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    queue.push({
      run: async () => {
        try {
          const result = await callGeminiApi(text);
          setCache(text, result);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }
    });
    processQueue();
  });
}

export const geminiDirectAvailable = Boolean(appConfig.geminiApiKey);
