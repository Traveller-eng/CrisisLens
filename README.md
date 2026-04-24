# CrisisLens — Decision Intelligence Under Uncertainty

> **CrisisLens resolves conflicting disaster information in real time.**
> It converts noisy, contradictory reports into **actionable, high-confidence decisions** using trust modeling, multi-signal fusion, and Google Cloud–aligned processing.

---

## 🔴 The Problem

During disasters, responders face a flood of **conflicting, unreliable, and rapidly evolving information**.

* **Rumors spread faster than verified updates**
* **Contradictory reports create hesitation**
* **Acting on false signals wastes critical time**

> A single incorrect report can misdirect rescue resources away from people in real danger.

---

## 🟢 The Solution

CrisisLens introduces a **conflict-aware decision system** that:

* Ingests reports from multiple sources (Crowd, NGO, IoT)
* Evaluates trust dynamically based on source history and signal corroboration
* Cross-verifies with satellite (NASA) and environmental signals
* Produces **clear, explainable decisions** for command staff

```text
Raw Chaos → Trust Modeling → Signal Fusion → Filtered Truth → Action
```

> CrisisLens doesn’t just collect data — it **resolves conflicting reality into actionable intelligence**.
> The system prioritizes correctness over speed, ensuring responders act on verified intelligence rather than raw data.

---

## ⚡ Core Capabilities

### 1. Conflict-Aware Trust Engine
Explicitly models contradictions between sources using a **weighted Bayesian updating model**.
* **Trust Calculation**: `Trust = f(source_weight, corroboration_density, temporal_decay, conflict_penalty)`.
* Supports both “event happening” and “event denied” signals to handle contradictory reports.
* Penalizes conflicting high-trust sources to flag uncertainty and prevent premature dispatch.
* Automatically isolates adversarial clusters using **semantic contradiction detection**.

### 2. Multi-Signal Fusion
Combines independent data streams into a unified operational picture, handling **spatio-temporal alignment** issues:
* **Crowd Reports** — Real-time, high-granularity, but noisy.
* **NASA FIRMS / Weather** — High reliability but inherent latency (3–12 hrs).
* **Alignment Logic**: Uses **8km spatial buffering** and **12-hour temporal windowing** to correlate old satellite hotspots with new crowd signals.
* Produces a **composite confidence score** where trust decays linearly over time unless corroborated by fresh signals.

### 3. Asynchronous AI Triage (3-Gate Architecture)
Designed for responsiveness and reliability under latency and network constraints:
* **Gate 1 — Instant Pattern Matching**: Precomputed responses for known patterns ensure zero-latency handling of common scenarios.
* **Gate 2 — Gemini (Vertex AI)**: Live semantic reasoning for new or complex reports using production-grade LLMs (Vertex AI / Gemini).
* **Gate 3 — Deterministic Offline Fallback**: Local rule-based classification guarantees continuity when cloud services are unavailable.
* **State Reconciliation**: When connectivity returns, **Cloud Truth (Vertex AI) serves as the authoritative state**, overwriting local predictions while preserving offline logs for audit accountability.

### 4. Real-Time Decision Layer
Each zone produces a dynamic state:
* **DISPATCH**: High trust, high urgency.
* **VERIFY**: High urgency, but conflicting or low-trust signals.
* **HOLD**: Suspected misinformation or low urgency.

All outputs are **explainable** via confidence decomposition (Audit Trail).

---

## 🧪 Enterprise Test Suite (91 Tests)

CrisisLens is backed by a comprehensive **Enterprise Test Suite** that validates every layer of the decision intelligence pipeline.

### Test Categories
*   **Unit Tests (79)**: 100% coverage of Bayesian trust math, Haversine spatial buffering, and 3-gate triage logic.
*   **Integration Tests (12)**: End-to-end validation of the ingestion pipeline under adversarial stress.
*   **Adversarial Stress Testing**: Automated simulation of bot swarms and Sybil attacks.

### Key Validations
*   ✅ **60%+ Suppression**: Verified that 3:1 adversarial ratios (45 bots vs 15 humans) cannot force a false dispatch.
*   ✅ **Sybil Resistance**: Coordinated reports from shared subnets are automatically down-weighted.
*   ✅ **Zero Latency**: Verified that the Pub/Sub "Shock Absorber" acknowledges ingestion in <100ms.
*   ✅ **Conflict Resilience**: 40 bots denying a real fire cannot suppress a dispatch if corroborated by high-trust signals.

### Run the Suite
```bash
npm test                # Run all 91 tests
npm run test:unit       # Unit tests (math & logic)
npm run test:integration  # Integration & Pipeline tests
npm run test:adversarial  # Adversarial stress tests (verbose)
```

---

## 🧱 Architecture (Google Cloud–Aligned)

CrisisLens uses production-aligned design patterns with Google Cloud services:

### Ingestion & Security
* **"The Shock Absorber"**: Reports are accepted via HTTP endpoints and instantly queued to **Google Cloud Pub/Sub**.
* **Bot/Sybil Mitigation**: Implements **source-type weighting** (Verified > NGO > Citizen > Anonymous) and **ingestion rate-limiting** to prevent coordinated bot swarms from gaming trust scores.
* Decoupling ingestion from processing ensures the system remains responsive even under high-frequency burst traffic.

### Privacy Layer
* **Google Cloud DLP**: Masks personally identifiable information (PII) before it ever reaches the AI reasoning layer.

### AI Reasoning
* **Vertex AI / Gemini**: Extracts structured meaning and semantic risk flags from anonymized reports.
* Runs asynchronously as background workers triggered by Pub/Sub events.

---

## 🖥 System Views

### Operator Dashboard (War Room)
* Live Map with multi-layer overlays (Satellite, Weather, Reports)
* **Horizontal Intel Stream**: Compact, real-time scrolling view of incoming reports
* **Trust + Conflict Visualization**: Real-time shift in zone confidence
* **Adversarial Control**: "Simulate Attack" button to test system resilience live

### Citizen Interface
Citizens act as **real-time sensors**:
* Submit reports via **Text or Voice** (Native Web Speech API)
* Verify or deny flagged incidents in their vicinity
* **Offline-Ready (PWA)**: UI shell caches locally for "Towers Are Down" scenarios

---

## 🔄 System Flow

```
Citizen / Simulation Input
        ↓
Pub/Sub Queue (Shock Absorber)
        ↓
DLP Sanitization (Privacy Shield)
        ↓
AI Triage (Pattern / Gemini / Fallback)
        ↓
Trust + Conflict Fusion (NASA + Weather)
        ↓
Zone Confidence Update
        ↓
Decision Output (Dispatch / Verify / Hold)
```

---

## 📊 Impact Metrics

From rigorous adversarial stress testing:
* **60%+ False Signal Suppression**: Tested under high conflict density (50+ reports/hr, 3:1 adversarial-to-legitimate ratio).
* **Near-Instant Frontend Response**: Pub/Sub decoupling ensures immediate user feedback while AI processing happens asynchronously.
* **100% UI Availability**: PWA shell provides dashboard access during simulated network blackouts.

---

## 🎬 Demo Flow

1. **Start in Raw Chaos**: Show the flood of conflicting reports.
2. **Inject Misinformation**: Use the "Attack" button to trigger bot reports.
3. **AI Triage**: Watch the background workers process reports in the event feed.
4. **Switch to Filtered Truth**: See the map clear as the trust engine isolates the fake signals.
5. **Observe Decision**: See CrisisLens prevent a false dispatch through conflict detection.

---

## ⚙️ Local Setup

### Requirements
* Node.js (v18+)
* Firebase CLI
* Google Cloud SDK (for Vertex AI / DLP)
* API Keys: Google Maps, Gemini, NASA FIRMS, OpenWeather

### Run the Stack
```bash
# Terminal 1: Backend Emulators
npm run functions:build
firebase emulators:start

# Terminal 2: Web Frontend
cd web
npm run dev
```

---

## 🎯 Positioning

> **CrisisLens bridges the gap between data overload and decision clarity — enabling responders to act faster, with higher confidence, under extreme uncertainty.**

---

*Built for the Google Smart Hackathon — Leveraging Google Cloud for Resilient Disaster Response.*
