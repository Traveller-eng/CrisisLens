import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";

const reporterCount = Number(process.env.SEED_REPORT_COUNT ?? 72);
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!serviceAccountPath) {
  console.error("Missing GOOGLE_APPLICATION_CREDENTIALS. Point it to your Firebase service account JSON file.");
  process.exit(1);
}

const resolvedPath = path.resolve(serviceAccountPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Service account file not found: ${resolvedPath}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));

initializeApp({
  credential: serviceAccount ? cert(serviceAccount) : applicationDefault()
});

const db = getFirestore();

const zones = [
  { id: "Zone A", lat: 13.0827, lng: 80.2707, mode: "flood" },
  { id: "Zone B", lat: 13.1986, lng: 80.1692, mode: "conflict" },
  { id: "Zone C", lat: 13.056, lng: 80.245, mode: "shelter" },
  { id: "Zone D", lat: 13.145, lng: 80.293, mode: "medical" }
];

const sourceProfiles = [
  { sourceType: "verified_org", source: "GDACS", trust: "high" },
  { sourceType: "ngo", source: "ReliefWeb Partner", trust: "medium" },
  { sourceType: "anonymous", source: "Social Stream", trust: "low" },
  { sourceType: "unknown", source: "Field Agent", trust: "medium" }
];

function pick(array, index) {
  return array[index % array.length];
}

function triageFor(zoneMode, index) {
  if (zoneMode === "flood") {
    return {
      type: "flood",
      urgency: 0.72 + (index % 20) / 100,
      needs: ["rescue", "medical"],
      tone: index % 5 === 0 ? "emotional" : "factual",
      location: "Zone A"
    };
  }

  if (zoneMode === "conflict") {
    return {
      type: index % 3 === 0 ? "infrastructure" : "flood",
      urgency: 0.48 + (index % 25) / 100,
      needs: ["rescue"],
      tone: index % 2 === 0 ? "exaggerated" : "emotional",
      location: "Zone B"
    };
  }

  if (zoneMode === "shelter") {
    return {
      type: "shelter",
      urgency: 0.58 + (index % 15) / 100,
      needs: ["shelter", "food"],
      tone: "factual",
      location: "Zone C"
    };
  }

  return {
    type: "injury",
    urgency: 0.62 + (index % 12) / 100,
    needs: ["medical"],
    tone: index % 4 === 0 ? "emotional" : "factual",
    location: "Zone D"
  };
}

function contentFor(zone, profile, index) {
  if (zone.mode === "conflict" && profile.sourceType === "anonymous") {
    return `Airport flood alert ${index}: severe disruption reported near ${zone.id}.`;
  }

  if (zone.mode === "conflict") {
    return `Infrastructure status update ${index}: operational checks underway around ${zone.id}.`;
  }

  if (zone.mode === "flood") {
    return `Flood report ${index}: water levels rising in ${zone.id}, families requesting rescue support.`;
  }

  if (zone.mode === "shelter") {
    return `Displacement report ${index}: shelter and food support needed in ${zone.id}.`;
  }

  return `Medical report ${index}: injuries reported near ${zone.id}, field response requested.`;
}

async function seed() {
  const now = Date.now();
  const batch = db.batch();

  const oldReports = await db.collection("reports").get();
  oldReports.docs.forEach((doc) => batch.delete(doc.ref));

  const oldEvents = await db.collection("events").get();
  oldEvents.docs.forEach((doc) => batch.delete(doc.ref));

  const oldZones = await db.collection("zones").get();
  oldZones.docs.forEach((doc) => batch.delete(doc.ref));

  batch.delete(db.collection("decisions").doc("latest"));
  batch.delete(db.collection("system_state").doc("latest"));

  for (let index = 0; index < reporterCount; index += 1) {
    const zone = pick(zones, index);
    const profile = pick(sourceProfiles, index + (index % 3));
    const triage = triageFor(zone.mode, index);
    const timestamp = new Date(now - (reporterCount - index) * 45000).toISOString();
    const latJitter = ((index % 7) - 3) * 0.0035;
    const lngJitter = ((index % 5) - 2) * 0.0035;
    const reportRef = db.collection("reports").doc();

    batch.set(reportRef, {
      text: contentFor(zone, profile, index + 1),
      source: `${profile.source} ${Math.floor(index / 4) + 1}`,
      sourceType: profile.sourceType,
      lat: Number((zone.lat + latJitter).toFixed(6)),
      lng: Number((zone.lng + lngJitter).toFixed(6)),
      zone: zone.id,
      timestamp,
      triage,
      conflicts: zone.mode === "conflict" ? [`signal-${index % 4}`] : []
    });
  }

  await batch.commit();
  console.log(`Seeded ${reporterCount} reports into Firestore.`);
  console.log("Firestore triggers should now derive zones, events, decisions, and system_state.");
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
