# CrisisLens: Decision Intelligence Under Uncertainty

## 🔴 The Problem

During disasters, responders face a flood of conflicting and unreliable information. **Acting on false reports wastes critical time and resources.** When every second counts, a single rumor can misdirect a rescue boat away from people in real danger.

## 🟢 The Solution

**CrisisLens filters noisy signals into high-confidence decisions.** 

By fusing ground-level reports with NASA satellite data and weather risk layers, it uses a conflict-aware trust engine to separate "Filtered Truth" from "Raw Chaos." The result is a prioritized list of actions that responders can trust, even in the middle of an information war.

---

## 🚀 Key Features

- **3-Gate AI Triage**: Ensures instant analysis while using deep AI only when needed for complex reports.
- **Trust Fusion Engine**: Fuses crowd signals with NASA FIRMS satellite data and weather risk using adversarial-aware algorithms.
- **🎙️ Voice Reporting**: Hold-to-speak voice input on the Citizen Dashboard using native Web Speech API.
- **Filtered Truth View**: One-click toggle between "Raw Chaos" (rumors) and "Filtered Truth" (operational reality).
- **Google Chat Alerts**: When a dispatch is confirmed, an automated alert fires to a Google Chat Space with full AI reasoning.
- **Audit-Ready Accountability**: Every recommendation includes a full "Confidence Decomposition" breakdown.

## 📊 Impact

In adversarial testing, **CrisisLens suppressed over 60% of false signals** while maintaining stable decision-making even during coordinated misinformation attacks.

---

## 🛠 How It Works: The Workflow

### 1. Intake
Reports arrive from simulation arcs, manual interventions (Crowd Waves/Misinfo), or live citizen submissions.

### 2. AI Analysis
The system uses a "smart triage" strategy to ensure the demo is always responsive:
- **Instant Recognition**: Matches known patterns immediately (zero latency).
- **Deep Triage**: Uses Gemini for real-time analysis of custom citizen reports.
- **Always-Up Fallback**: A local engine ensures the demo never stops, even if the internet fails.

### 3. Trust Fusion
Signals are scored based on source trust, cross-signal agreement, and satellite corroboration. If a verified source says "No flooding," the system automatically suppresses conflicting low-trust rumors.

### 4. Decision Authority
The system ranks zones:
- **Green (Dispatch)**: High trust, high urgency.
- **Amber (Partial)**: High urgency, but conflicting signals.
- **Red (Hold)**: Suspected misinformation.

---

## 🖥 The Dashboards

### [Operator Dashboard](http://localhost:5173)
The command center. Features interactive Google Maps, a "thinking console" event feed, mathematical confidence breakdowns, and **automated Google Chat alerts** on confirmed dispatches.

### [Citizen Dashboard](http://localhost:5173/citizen)
**Transforms citizens into real-time intelligence sources.**
- Submit ground reports instantly with one tap.
- **🎙️ Hold-to-speak voice input** for hands-free emergency reporting.
- Verify or deny flagged incidents in their immediate area.
- Feed trusted signals directly into the command center's AI system.

---

## 🖼 Demo Preview

![War Room](./assets/warroom.png)
*Placeholder for Operator View*

![Citizen View](./assets/citizen.png)
*Placeholder for Citizen View*

---

## ⚡ Quick Start

### 1. Configure Environment
Create `web/.env`:
```bash
VITE_GOOGLE_MAPS_API_KEY=your_key
VITE_GEMINI_API_KEY=your_key
VITE_GEMINI_MODEL=gemini-2.0-flash-lite
VITE_USE_FIREBASE_EMULATORS=true
VITE_GOOGLE_CHAT_WEBHOOK_URL=your_webhook_url   # Optional: enables auto-alerts
```

### 2. Run the Stack
**Terminal 1 (Backend):**
```powershell
npm run functions:build
firebase emulators:start
```

**Terminal 2 (Frontend):**
```powershell
cd web
npm run dev
```

## 📂 Project Structure
- `web/`: React + Vite Frontend (Maps, AI Queue, Voice Input)
- `functions/`: Firebase Functions (Sync layers, NASA API)
- `shared/`: Fusion logic, Demo data, Types
- `firebase.json`: Emulator configuration
