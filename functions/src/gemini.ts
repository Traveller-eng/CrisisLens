import { onCall } from "firebase-functions/v2/https";
import type { AIAnalysis, ClaimType, ContradictionSignal } from "../../shared/crisis";

const GEMINI_MODEL = "gemini-2.0-flash-lite";

function inferTypeFromText(text: string): AIAnalysis["type"] {
  const normalized = text.toLowerCase();

  if (/\b(water|flood|rain|drainage|submerged|overflow|rising|inundat)/.test(normalized)) {
    return "flood";
  }

  if (/\b(fire|smoke|burn|flame|heat)\b/.test(normalized)) {
    return "fire";
  }

  if (/\b(quake|earthquake|tremor|aftershock|seismic)\b/.test(normalized)) {
    return "earthquake";
  }

  if (/\b(collapse|bridge|road|debris|structural|building|infrastructure)\b/.test(normalized)) {
    return "infrastructure";
  }

  if (/\b(injury|injured|wound|medical|casualty|bleeding)\b/.test(normalized)) {
    return "injury";
  }

  if (/\b(shelter|evacuation|camp|homeless)\b/.test(normalized)) {
    return "shelter";
  }

  if (/\b(food|supply|supplies|ration|relief)\b/.test(normalized)) {
    return "supply";
  }

  return "unknown";
}

function fallbackAnalysis(text = ""): AIAnalysis {
  const inferredType = inferTypeFromText(text);
  return {
    type: inferredType === "unknown" ? "flood" : inferredType,
    severity: inferredType === "unknown" ? 0.4 : 0.62,
    confidence: inferredType === "unknown" ? 0.35 : 0.42,
    claim: "positive",
    entities: [],
    urgency: inferredType === "unknown" ? 0.4 : 0.58,
    reasoning:
      inferredType === "unknown"
        ? "Fallback heuristic used because Gemini did not return a valid classification."
        : `Fallback heuristic mapped the report to ${inferredType} from obvious crisis keywords.`,
    contradictionSignal: "none",
    isFallback: true
  };
}

function normalizeAnalysis(raw: unknown, sourceText: string): AIAnalysis {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const type =
    candidate.type === "flood" ||
    candidate.type === "fire" ||
    candidate.type === "earthquake" ||
    candidate.type === "infrastructure" ||
    candidate.type === "injury" ||
    candidate.type === "shelter" ||
    candidate.type === "supply" ||
    candidate.type === "unknown"
      ? candidate.type
      : "unknown";
  const inferredType = inferTypeFromText(sourceText);
  const finalType = type === "unknown" && inferredType !== "unknown" ? inferredType : type;
  const severity = Math.max(0, Math.min(1, Number(candidate.severity ?? (finalType === "unknown" ? 0.4 : 0.62))));
  const confidence = Math.max(
    0,
    Math.min(1, Number(candidate.confidence ?? (type === "unknown" && inferredType !== "unknown" ? 0.4 : 0.5)))
  );
  const claim: ClaimType =
    candidate.claim === "negative" || candidate.claim === "neutral" || candidate.claim === "positive"
      ? candidate.claim
      : "neutral";
  const entities = Array.isArray(candidate.entities) ? candidate.entities.filter((item): item is string => typeof item === "string") : [];
  const urgency = Math.max(0, Math.min(1, Number(candidate.urgency ?? severity)));
  const contradictionSignal: ContradictionSignal =
    candidate.contradictionSignal === "high" || candidate.contradictionSignal === "low" || candidate.contradictionSignal === "none"
      ? candidate.contradictionSignal
      : claim === "negative"
        ? "high"
        : "none";
  const reasoning =
    typeof candidate.reasoning === "string" && candidate.reasoning.trim()
      ? candidate.reasoning.trim()
      : type === "unknown" && inferredType !== "unknown"
        ? `Gemini returned unknown, so CrisisLens applied a ${inferredType} fallback based on disaster keywords in the report text.`
        : `Gemini classified this report as ${finalType} with ${claim} claim polarity.`;

  return {
    type: finalType === "unknown" ? "flood" : finalType,
    severity,
    confidence,
    claim,
    entities,
    urgency,
    reasoning,
    contradictionSignal,
    isFallback: false
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return fallbackAnalysis(text);
      }
    }
  }

  return fallbackAnalysis(text);
}

export async function analyzeReportText(text: string): Promise<AIAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const prompt = `You are a crisis report classifier for emergency response systems.
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
Output: {"type":"infrastructure","severity":0.36,"confidence":0.77,"claim":"negative","entities":["bridge"],"urgency":0.18,"reasoning":"The report denies prior collapse claims and should be treated as a negative contradiction to bridge-failure rumors.","contradictionSignal":"high"}

Report:
"${text}"`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 500
        }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return normalizeAnalysis(extractJson(raw), text);
}

export const analyzeReport = onCall(async (request) => {
  const text = typeof request.data?.text === "string" ? request.data.text : "";
  if (!text.trim()) {
    return fallbackAnalysis(text);
  }

  try {
    return await analyzeReportText(text);
  } catch {
    return fallbackAnalysis(text);
  }
});
