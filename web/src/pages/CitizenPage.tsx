import "../citizen.css";
import { Suspense, lazy, useState } from "react";
import VoiceReporter from "../components/VoiceReporter";
import { db, firebaseEnabled } from "../lib/firebase";
import { addDoc, collection } from "firebase/firestore";
import { appConfig } from "../config";
import type { ShelterMarker } from "../components/LiveMap";

const LiveMap = lazy(() => import("../components/LiveMap"));

const shelterData: (ShelterMarker & { distance: string })[] = [
  {
    id: "shelter-adyar",
    name: "Adyar Relief Camp",
    distance: "0.8 km",
    address: "Sardar Patel Rd, Adyar, Chennai",
    capacity: "120 / 200",
    contact: "+91 44 2461 2201",
    lastUpdated: new Date().toISOString(),
    lat: 13.0063,
    lng: 80.2574
  },
  {
    id: "shelter-velachery",
    name: "Velachery Transit Shelter",
    distance: "2.1 km",
    address: "Velachery Main Rd, Chennai",
    capacity: "68 / 120",
    contact: "+91 44 2243 1880",
    lastUpdated: new Date().toISOString(),
    lat: 12.9815,
    lng: 80.2180
  },
  {
    id: "shelter-saidapet",
    name: "Saidapet Community Hall",
    distance: "3.4 km",
    address: "Jones Rd, Saidapet, Chennai",
    capacity: "144 / 180",
    contact: "+91 44 2435 0092",
    lastUpdated: new Date().toISOString(),
    lat: 13.0220,
    lng: 80.2300
  },
  {
    id: "shelter-tnagar",
    name: "T. Nagar Relief Center",
    distance: "4.2 km",
    address: "Usman Rd, T. Nagar, Chennai",
    capacity: "90 / 150",
    contact: "+91 44 2434 5500",
    lastUpdated: new Date().toISOString(),
    lat: 13.0418,
    lng: 80.2341
  },
  {
    id: "shelter-mylapore",
    name: "Mylapore Temple Grounds",
    distance: "1.6 km",
    address: "Kutchery Rd, Mylapore, Chennai",
    capacity: "200 / 300",
    contact: "+91 44 2464 1122",
    lastUpdated: new Date().toISOString(),
    lat: 13.0339,
    lng: 80.2676
  }
];

const updateSteps = [
  { label: "Received", time: "09:07 PM", state: "done" },
  { label: "AI Analyzed", time: "09:08 PM", state: "done" },
  { label: "Trust Scoring", time: "Live", state: "active" },
  { label: "Zone Assessment", time: "Pending", state: "idle" },
  { label: "Action Status", time: "Pending", state: "idle" }
] as const;

const incidentTypes = [
  "Flooding / Water rise",
  "Road or bridge blocked",
  "Medical emergency",
  "People trapped",
  "Power outage",
  "Need food or shelter"
];

export default function CitizenPage() {
  const [reportText, setReportText] = useState("Bridge collapse reported near Adyar check-post. Water is rising and traffic is stopped.");
  const [submitted, setSubmitted] = useState(false);
  const [selectedShelterId, setSelectedShelterId] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("Serious");

  const selectedShelter = shelterData.find(s => s.id === selectedShelterId) ?? null;

  async function handleSubmitReport(text: string) {
    if (!text.trim()) return;

    if (firebaseEnabled && db) {
      try {
        await addDoc(collection(db, "reports"), {
          text,
          source: "Citizen App",
          sourceType: "citizen",
          lat: 13.0827,
          lng: 80.2707,
          zone: "Zone A",
          timestamp: new Date().toISOString(),
          triage: { type: "flood", urgency: 0.7, needs: ["rescue"], tone: "factual", location: "Zone A" },
          conflicts: []
        });
      } catch (err) {
        console.error("Failed to submit citizen report:", err);
      }
    }

    console.log("Citizen report submitted:", text);
    setSubmitted(true);
    window.setTimeout(() => setSubmitted(false), 3000);
  }

  const hasMapsKey = Boolean(appConfig.googleMapsApiKey);

  return (
    <div className="citizen-page">
      <div className="citizen-page__glow citizen-page__glow--left" />
      <div className="citizen-page__glow citizen-page__glow--right" />

      <header className="citizen-hero">
        <div className="citizen-hero__eyebrow">Citizen Mode</div>
        <h1>Report what you see. Get help moving faster.</h1>
        <p>
          CrisisLens turns people on the ground into trusted signals for the response team. One report
          can confirm a hotspot, expose misinformation, or speed up dispatch.
        </p>

        <div className="citizen-hero__actions">
          <a className="citizen-button citizen-button--primary" href="#report">
            Submit Report
          </a>
          <a className="citizen-button citizen-button--ghost" href="#shelters">
            Find Shelter
          </a>
        </div>

        <div className="citizen-hero__chips">
          <span>GPS-assisted</span>
          <span>No login</span>
          <span>Live coordinator sync</span>
          <span>🎙️ Voice input</span>
        </div>
      </header>

      <main className="citizen-layout">
        <section className="citizen-card citizen-card--report" id="report">
          <div className="citizen-card__heading">
            <span className="citizen-card__label">Quick Report</span>
            <h2>What is happening near you?</h2>
            <p>Keep it fast. The team only needs the essentials to start triage.</p>
          </div>

          <div className="citizen-type-grid">
            {incidentTypes.map((item) => (
              <button
                key={item}
                className={`citizen-type-pill${selectedIncident === item ? " citizen-type-pill--active" : ""}`}
                type="button"
                onClick={() => setSelectedIncident(selectedIncident === item ? null : item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="citizen-severity">
            <span className="citizen-section-title">How serious is it?</span>
            <div className="citizen-severity__row">
              <button
                className={`citizen-severity__pill${selectedSeverity === "Low" ? " citizen-severity__pill--active" : ""}`}
                type="button"
                onClick={() => setSelectedSeverity("Low")}
              >
                Low
              </button>
              <button
                className={`citizen-severity__pill${selectedSeverity === "Serious" ? " citizen-severity__pill--active" : ""}`}
                type="button"
                onClick={() => setSelectedSeverity("Serious")}
              >
                Serious
              </button>
              <button
                className={`citizen-severity__pill${selectedSeverity === "Critical" ? " citizen-severity__pill--critical" : ""}`}
                type="button"
                onClick={() => setSelectedSeverity("Critical")}
              >
                Critical
              </button>
            </div>
          </div>

          <label className="citizen-input">
            <span className="citizen-section-title">Details</span>
            <textarea
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              rows={5}
            />
          </label>

          <div className="citizen-meta-grid">
            <div className="citizen-meta-box">
              <span className="citizen-section-title">Location</span>
              <strong>Adyar, Chennai</strong>
              <small>GPS detected 20 seconds ago</small>
            </div>

            <div className="citizen-meta-box">
              <span className="citizen-section-title">Photo</span>
              <strong>Optional evidence</strong>
              <small>Boosts confidence when available</small>
            </div>
          </div>

          <button
            className="citizen-button citizen-button--primary citizen-button--full"
            type="button"
            onClick={() => handleSubmitReport(reportText)}
          >
            {submitted ? "✓ Report Sent to AI" : "Submit Report"}
          </button>

          <VoiceReporter onSubmitReport={handleSubmitReport} />
        </section>

        <section className="citizen-column">
          {/* ── Shelter Map ── */}
          <section className="citizen-card" id="shelter-map">
            <div className="citizen-card__heading">
              <span className="citizen-card__label">Shelter Map</span>
              <h2>Navigate to safety</h2>
              <p style={{ margin: 0, color: '#a9bfd1', fontSize: '0.9rem' }}>
                Tap a shelter marker on the map to see its details below.
              </p>
            </div>

            <div className="citizen-map-container" style={{ marginTop: '14px', borderRadius: '18px', overflow: 'hidden', border: '1px solid rgba(115,185,245,0.12)' }}>
              {hasMapsKey ? (
                <Suspense fallback={<div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1f2e', color: '#7cc6ff' }}>Loading map…</div>}>
                  <LiveMap
                    apiKey={appConfig.googleMapsApiKey}
                    zones={[]}
                    shelters={shelterData}
                    selectedZoneId={null}
                    onSelectZone={() => {}}
                    onSelectShelter={(id) => setSelectedShelterId(id)}
                  />
                </Suspense>
              ) : (
                <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b1f2e', color: '#a9bfd1', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>
                  Google Maps API key not configured.<br />
                  Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>web/.env</code>
                </div>
              )}
            </div>

            {selectedShelter && (
              <div className="citizen-highlight" style={{ marginTop: '14px' }}>
                <span className="citizen-section-title">Selected Shelter</span>
                <strong>{selectedShelter.name}</strong>
                <small>{selectedShelter.address}</small>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.9rem', color: '#d8e7f4' }}>
                  <span>📍 {selectedShelter.distance}</span>
                  <span>🏠 Capacity {selectedShelter.capacity}</span>
                </div>
                <div style={{ marginTop: '8px' }}>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedShelter.lat},${selectedShelter.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="citizen-button citizen-button--primary"
                    style={{ display: 'inline-block', padding: '10px 16px', fontSize: '0.85rem', textDecoration: 'none', marginTop: '4px' }}
                  >
                    🧭 Get Directions
                  </a>
                </div>
              </div>
            )}
          </section>

          {/* ── Live Status ── */}
          <section className="citizen-card" id="status">
            <div className="citizen-card__heading">
              <span className="citizen-card__label">Live Status</span>
              <h2>Your report journey</h2>
            </div>

            <div className="citizen-status">
              {updateSteps.map((step) => (
                <div key={step.label} className={`citizen-status__row citizen-status__row--${step.state}`}>
                  <span className="citizen-status__dot" />
                  <div className="citizen-status__text">
                    <strong>{step.label}</strong>
                    <small>{step.time}</small>
                  </div>
                </div>
              ))}
            </div>

            <div className="citizen-highlight">
              <span className="citizen-section-title">Zone Assignment</span>
              <strong>Zone A - Adyar Basin</strong>
              <small>6 nearby reports agree on the same flood signal</small>
            </div>
          </section>

          {/* ── Shelter List ── */}
          <section className="citizen-card" id="shelters">
            <div className="citizen-card__heading">
              <span className="citizen-card__label">Shelter Finder</span>
              <h2>Nearby safe locations</h2>
            </div>

            <div className="citizen-shelter-list">
              {shelterData.map((shelter) => (
                <article
                  key={shelter.name}
                  className={`citizen-shelter${selectedShelterId === shelter.id ? ' citizen-shelter--selected' : ''}`}
                  onClick={() => setSelectedShelterId(shelter.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="citizen-shelter__top">
                    <strong>{shelter.name}</strong>
                    <span>{shelter.distance}</span>
                  </div>
                  <p>{shelter.address}</p>
                  <div className="citizen-shelter__meta">
                    <span>Capacity {shelter.capacity}</span>
                    <span>{shelter.contact}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
