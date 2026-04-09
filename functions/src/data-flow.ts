import axios from "axios";

type SourceType = "anonymous" | "ngo" | "verified_org" | "unknown";

type GeneratedReport = {
  text: string;
  source: string;
  sourceType: SourceType;
  lat: number;
  lng: number;
  zone: string;
  timestamp: string;
  triage: {
    type: "flood" | "injury" | "infrastructure" | "shelter";
    urgency: number;
    needs: string[];
    tone: "factual" | "emotional" | "exaggerated";
    location: string;
  };
  conflicts: string[];
};

const crowdMessages = [
  "Water rising fast near homes",
  "People stuck here and waiting for rescue",
  "Road blocked by flood water",
  "Bridge collapsed according to locals",
  "Medical help needed for injured residents",
  "Shelter camp running low on supplies"
];

const verifiedCorrections = [
  "Bridge is operational, no structural failure confirmed",
  "Airport operations continuing with no major flooding",
  "Road partially blocked but passable for emergency vehicles"
];

function randomFrom<T>(items: T[], index: number): T {
  return items[index % items.length];
}

function jitter(base: number, spread: number, index: number): number {
  return Number((base + (((index % 7) - 3) * spread)).toFixed(6));
}

export async function fetchGDACSFeed() {
  const response = await axios.get("https://www.gdacs.org/xml/rss.xml", {
    timeout: 15000,
    responseType: "text"
  });

  return response.data as string;
}

type GdacsGeometry = {
  coordinates?: unknown;
};

type GdacsProperties = {
  eventid?: unknown;
  episodeid?: unknown;
  eventtype?: unknown;
  alertlevel?: unknown;
  name?: unknown;
  description?: unknown;
};

type GdacsFeature = {
  geometry?: GdacsGeometry;
  properties?: GdacsProperties;
};

type GdacsResponse = {
  features?: GdacsFeature[];
};

export type GdacsSignal = {
  eventId: string;
  source: "GDACS";
  type: string;
  severity: string;
  confidence: number;
  intensity: number;
  lat: number;
  lng: number;
  description: string;
  timestamp: number;
};

type WeatherApiCurrent = {
  humidity?: unknown;
  wind_speed?: unknown;
  wind_deg?: unknown;
  pressure?: unknown;
  rain?: {
    "1h"?: unknown;
  };
};

type WeatherApiHourly = Array<{
  rain?: unknown;
  pop?: unknown;
}>;

type WeatherApiResponse = {
  current?: WeatherApiCurrent;
  hourly?: WeatherApiHourly;
};

export type WeatherRiskSignal = {
  source: "WEATHER";
  type: "flood_risk";
  rain: number;
  humidity: number;
  wind: number;
  pressure: number;
  pop: number;
  riskScore: number;
  lat: number;
  lng: number;
  timestamp: number;
  windDeg: number;
};

const GDACS_EVENTS_URL =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=FL&alertlevel=red;orange";

export function severityToConfidence(severity: string): number {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "red") {
    return 0.9;
  }

  if (normalized === "orange") {
    return 0.7;
  }

  if (normalized === "green") {
    return 0.4;
  }

  return 0.4;
}

export async function fetchGdacsSignals(): Promise<GdacsSignal[]> {
  const response = await fetch(GDACS_EVENTS_URL, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GDACS request failed: ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
  }

  const payload = (await response.json()) as GdacsResponse;
  const features = Array.isArray(payload.features) ? payload.features : [];

  return features
    .map((feature): GdacsSignal | null => {
      const properties = feature.properties ?? {};
      const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry?.coordinates : [];
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      const severity = String(properties.alertlevel ?? "green").toLowerCase();
      const eventId = String(properties.eventid ?? properties.episodeid ?? "").trim();
      const type = String(properties.eventtype ?? "flood").trim().toLowerCase() || "flood";
      const description = String(properties.description ?? properties.name ?? "GDACS disaster event").trim();

      if (!eventId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      const confidence = severityToConfidence(severity);

      return {
        eventId,
        source: "GDACS",
        type,
        severity,
        confidence,
        intensity: confidence,
        lat,
        lng,
        description,
        timestamp: Date.now()
      };
    })
    .filter((signal): signal is GdacsSignal => signal !== null);
}

function normalizeMetric(value: number, max: number): number {
  return Math.max(0, Math.min(1, value / max));
}

export function computeWeatherRiskScore(input: { rain: number; humidity: number; pop: number; wind: number }): number {
  const score =
    0.5 * normalizeMetric(input.rain, 30) +
    0.2 * normalizeMetric(input.humidity, 100) +
    0.2 * normalizeMetric(input.pop, 1) +
    0.1 * normalizeMetric(input.wind, 20);

  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export async function fetchWeatherRiskSignal(lat: number, lng: number): Promise<WeatherRiskSignal> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENWEATHER_API_KEY is missing");
  }
  const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenWeather request failed: ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
  }

  const payload = (await response.json()) as WeatherApiResponse;
  const current = payload.current ?? {};
  const hourly = Array.isArray(payload.hourly) ? payload.hourly : [];
  const firstHourly = hourly[0] ?? {};

  const rain = Number(current.rain?.["1h"] ?? firstHourly.rain ?? 0);
  const humidity = Number(current.humidity ?? 0);
  const wind = Number(current.wind_speed ?? 0);
  const pressure = Number(current.pressure ?? 0);
  const pop = Number(firstHourly.pop ?? 0);
  const windDeg = Number(current.wind_deg ?? 0);
  const riskScore = computeWeatherRiskScore({ rain, humidity, pop, wind });

  return {
    source: "WEATHER",
    type: "flood_risk",
    rain,
    humidity,
    wind,
    pressure,
    pop,
    riskScore,
    lat,
    lng,
    timestamp: Date.now(),
    windDeg
  };
}

export function generateSyntheticReports(count = 20, zone = "Zone A"): GeneratedReport[] {
  const baseCoords =
    zone === "Zone B"
      ? { lat: 13.1986, lng: 80.1692 }
      : zone === "Zone C"
        ? { lat: 13.056, lng: 80.245 }
        : zone === "Zone D"
          ? { lat: 13.145, lng: 80.293 }
          : { lat: 13.0827, lng: 80.2707 };

  return Array.from({ length: count }, (_, index) => {
    const text = randomFrom(crowdMessages, index);
    const type =
      text.includes("Bridge") || text.includes("Road")
        ? "infrastructure"
        : text.includes("Medical")
          ? "injury"
          : text.includes("Shelter")
            ? "shelter"
            : "flood";

    return {
      text,
      source: `Synthetic Reporter ${index + 1}`,
      sourceType: "anonymous",
      lat: jitter(baseCoords.lat, 0.0024, index),
      lng: jitter(baseCoords.lng, 0.0021, index + 2),
      zone,
      timestamp: new Date(Date.now() + index * 4000).toISOString(),
      triage: {
        type,
        urgency: Number((0.55 + ((index % 5) * 0.08)).toFixed(2)),
        needs:
          type === "injury"
            ? ["medical"]
            : type === "shelter"
              ? ["shelter", "food"]
              : ["rescue"],
        tone: index % 3 === 0 ? "emotional" : index % 4 === 0 ? "exaggerated" : "factual",
        location: zone
      },
      conflicts: type === "infrastructure" ? [`synthetic-conflict-${index % 3}`] : []
    };
  });
}

export function generateVerifiedCorrection(zone = "Zone B", index = 0): GeneratedReport {
  const coords =
    zone === "Zone B" ? { lat: 13.1994, lng: 80.1718 } : { lat: 13.0827, lng: 80.2707 };
  const text = randomFrom(verifiedCorrections, index);

  return {
    text,
    source: `Verified Command ${index + 1}`,
    sourceType: "verified_org",
    lat: coords.lat,
    lng: coords.lng,
    zone,
    timestamp: new Date().toISOString(),
    triage: {
      type: text.includes("Bridge") || text.includes("Road") ? "infrastructure" : "flood",
      urgency: 0.38,
      needs: ["medical"],
      tone: "factual",
      location: zone
    },
    conflicts: []
  };
}

type FirmsHotspot = {
  latitude: number;
  longitude: number;
  confidence: string;
  frp: number;
  acq_date: string;
  acq_time: string;
  daynight: string;
  source: string;
};

function parseCsvRow(row: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

export async function fetchFirmsHotspots() {
  const mapKey = process.env.NASA_FIRMS_MAP_KEY;
  if (!mapKey) {
    throw new Error("NASA_FIRMS_MAP_KEY is missing");
  }

  const chennaiArea = "79.95,12.85,80.35,13.25";
  const source = "VIIRS_SNPP_NRT";
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/${chennaiArea}/1`;
  const response = await axios.get(url, {
    timeout: 20000,
    responseType: "text"
  });

  const lines = String(response.data).trim().split(/\r?\n/);
  if (lines.length <= 1) {
    return [] as FirmsHotspot[];
  }

  const headers = parseCsvRow(lines[0]);
  return lines.slice(1, 41).map((line) => {
    const values = parseCsvRow(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    return {
      latitude: Number(row.latitude ?? 0),
      longitude: Number(row.longitude ?? 0),
      confidence: String(row.confidence ?? "unknown"),
      frp: Number(row.frp ?? 0),
      acq_date: String(row.acq_date ?? ""),
      acq_time: String(row.acq_time ?? ""),
      daynight: String(row.daynight ?? ""),
      source
    };
  });
}
