# CrisisLens

CrisisLens is an AI-powered decision intelligence system for disaster response under uncertainty. For the Google Smart Hackathon demo, it is framed around a Chennai flood response scenario where incoming reports are triaged, trust-scored, checked for contradiction, and turned into live response recommendations.

## What this project does

- Runs a Chennai flood response demo in the frontend
- Streams reports through a visible trust pipeline
- Fuses crowd intelligence with NASA FIRMS signals
- Shows changing zones on a live Google Maps war-room view
- Supports `Raw Chaos` vs `Filtered Truth` comparison
- Updates decisions in real time with conflict-aware confidence
- Supports local Firebase emulators for full demo mode
- Exposes a GDACS-trigger endpoint as the reality layer for real alert ingestion
- Includes a NASA FIRMS hotspot layer for satellite-backed fire/heat anomaly signals
- Includes an OpenWeather flood-risk layer with rain, humidity, wind, and pressure signals
- Includes automated adversarial fusion tests with deterministic generators

## Tech stack

- Frontend: React + Vite
- Backend: Firebase Functions
- Data: Firestore
- Map: Google Maps
- AI layer: simulated triage structure, Gemini-ready config

## Project structure

```text
web/               React frontend
functions/         Firebase backend
shared/            Trust logic, decisions, demo data
firebase.json      Emulator + hosting config
firestore.rules    Local Firestore rules
```

## Before you start

You need these installed on your machine:

- Node.js
- npm
- Firebase CLI

You also need:

- a Firebase project
- your Firebase web app config
- a Google Maps API key
- a Gemini API key
- a NASA FIRMS MAP key
- an OpenWeather key with access to the requested weather endpoint

## One-time setup from scratch

### 1. Open the project folder

```powershell
cd C:\Users\Lenovo\OneDrive\Desktop\solution
```

### 2. Install all dependencies

```powershell
npm install
```

### 3. Make sure the frontend env file exists

The app expects:

[`web/.env`](C:\Users\Lenovo\OneDrive\Desktop\solution\web\.env)

It should contain:

```bash
VITE_FIREBASE_API_KEY=your_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
VITE_GOOGLE_MAPS_API_KEY=your_maps_key
VITE_GEMINI_API_KEY=your_gemini_key
VITE_GEMINI_MODEL=gemini-2.0-flash
VITE_USE_FIREBASE_EMULATORS=true
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1
VITE_FIRESTORE_EMULATOR_PORT=8085
```

Backend secrets are read from:

[`functions/.env`](C:\Users\Lenovo\OneDrive\Desktop\solution\functions\.env)

Expected:

```bash
NASA_FIRMS_MAP_KEY=your_firms_map_key
OPENWEATHER_API_KEY=your_openweather_key
```

## Exact run order

If you are starting fresh, run everything in this order.

### Step 1. Build the backend once

```powershell
npm run functions:build
```

### Step 2. Start the local Firebase backend

```powershell
firebase emulators:start
```

This starts:

- Functions emulator on `127.0.0.1:5005`
- Firestore emulator on `127.0.0.1:8085`
- Hosting emulator on `127.0.0.1:5000`
- Emulator UI on `127.0.0.1:4005`

Leave this terminal running.

### Step 3. Start the frontend in a second terminal

Open a new terminal in the same folder:

```powershell
cd C:\Users\Lenovo\OneDrive\Desktop\solution
npm run dev
```

Leave this terminal running too.

### Step 4. Open the app

Use the frontend URL shown by Vite.

For emulator inspection, use:

- Emulator UI: [http://127.0.0.1:4005](http://127.0.0.1:4005)
- Local hosting: [http://127.0.0.1:5000](http://127.0.0.1:5000)

## How frontend and backend are integrated

The frontend is already configured to use the local Firestore emulator when this is set:

```bash
VITE_USE_FIREBASE_EMULATORS=true
```

That wiring lives in:

- [`web/src/lib/firebase.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\web\src\lib\firebase.ts)
- [`web/src/config.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\web\src\config.ts)

So when the emulator is running:

- frontend reads Firestore from `127.0.0.1:8085`
- frontend writes reports to local Firestore
- backend trigger `onReportWrite` reacts
- backend updates:
  - `/zones`
  - `/decisions/latest`
  - `/events`
- frontend listens to those collections and updates the UI

## Exact demo workflow

Once both terminals are running:

### 1. Open the app

You should see the CrisisLens control-room UI.

### 2. Pick a scenario

Use the top scenario selector:

- Flood
- Earthquake
- Cyclone
- Custom Scenario

### 3. Start or pause the simulation

Use:

- `Start`
- `Pause`
- speed controls `1x`, `2x`, `5x`

Notes:

- the demo now starts paused, so `Start` has a clear effect
- incoming reports update faster and arrive in bursts at higher speeds

### 4. Use the intervention buttons

These work in both local simulation mode and live emulator mode:

- `Crowd Wave`
  - injects noisy public reports
- `Verified Report`
  - injects a high-trust correction
- `Inject Misinformation`
  - injects contradiction-heavy reports

The intervention icons now trigger immediately when clicked, so the `+` verified action no longer feels inert.

### 5. Watch the full system react

What should change:

- map markers and zones
- trust state
- conflict zones
- decisions
- explainability panel
- live event feed

## Demo positioning

For the strongest pitch, present CrisisLens as:

`AI-powered decision intelligence for disaster response under uncertainty`

Not as:

`just a simulation dashboard`

The strongest differentiator is the trust engine:

- misinformation suppression
- contradiction handling
- human + satellite signal fusion
- trusted vs untrusted signals
- explicit `DO NOT DISPATCH` decisions

## Fusion logic

The backend now computes zone confidence from three parts:

1. crowd report confidence
2. NASA FIRMS confidence
3. conflict penalty

Conceptually:

```text
Final Confidence =
  alpha * reportConfidence +
  beta * nasaConfidence -
  gamma * conflictScore
```

The result drives:

- zone coloring
- decision authority
- conflict highlighting
- truth-vs-noise filtering

## Reality layer

The backend includes a GDACS-ready endpoint:

- [fetchGDACS](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchGDACS)

It now also includes a NASA FIRMS endpoint:

- [fetchFIRMS](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchFIRMS)

And a weather risk endpoint:

- [fetchWeatherSignals](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchWeatherSignals)

Use it in the story like this:

1. a real alert enters through GDACS
2. local noisy reports begin streaming
3. NASA FIRMS layer is toggled on
4. verified correction arrives
4. trust shifts
5. decisions reorder

## Killer metric used in the UI

The demo currently highlights:

`False-signal impact reduced by 40%`

This is framed as a simulated metric for Chennai flood conditions with contradiction-aware trust scoring and verified correction events.

## War-room layout

The UI is now organized like an operations center:

- Top bar:
  - scenario
  - start / pause
  - speed
  - raw chaos vs filtered truth
  - interventions
- Left:
  - emergency operations map
- Right top:
  - decision authority
- Right middle:
  - conflict + trust panel
- Right bottom:
  - live event feed
- Bottom:
  - timeline scrubber

## Useful local backend URLs

When emulators are running:

- Health:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/health](http://127.0.0.1:5005/crisislens-333ea/us-central1/health)
- Demo state:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/demoState](http://127.0.0.1:5005/crisislens-333ea/us-central1/demoState)
- GDACS fetch:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchGDACS](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchGDACS)
- NASA FIRMS fetch:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchFIRMS](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchFIRMS)
- Weather sync:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchWeatherSignals](http://127.0.0.1:5005/crisislens-333ea/us-central1/fetchWeatherSignals)
- Synthetic injection:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/injectSyntheticReports](http://127.0.0.1:5005/crisislens-333ea/us-central1/injectSyntheticReports)
- Verified correction:
  - [http://127.0.0.1:5005/crisislens-333ea/us-central1/injectVerifiedCorrection](http://127.0.0.1:5005/crisislens-333ea/us-central1/injectVerifiedCorrection)

## Automated validation

The repo now includes a deterministic adversarial test suite for the fusion engine.

Run it with:

```powershell
npm test
```

Covered scenarios:

- ideal dispatch path
- misinformation attack
- coordinated fake attack
- no NASA fallback
- sparse data
- conflict explosion
- high-noise stability
- time decay bias
- extreme NASA override
- zero input
- repeated-noise variance
- performance under load

Key test files:

- [`shared/zone-update.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\shared\zone-update.ts)
- [`tests/generator.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\tests\generator.ts)
- [`tests/fusion.test.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\tests\fusion.test.ts)
- [`jest.config.js`](C:\Users\Lenovo\OneDrive\Desktop\solution\jest.config.js)

## Firestore-triggered pipeline

The main backend trigger is:

- [`functions/src/index.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\functions\src\index.ts)

When a report is written:

1. Firestore receives a report
2. `onReportWrite` runs
3. zones are recalculated
4. decisions are regenerated
5. events are appended
6. frontend reflects the changes live

## If something does not work

### Backend does not start

Run:

```powershell
npm run functions:build
firebase emulators:start
```

### Frontend opens but no live data appears

Check:

1. `VITE_USE_FIREBASE_EMULATORS=true`
2. Firestore emulator is running on `8085`
3. frontend was restarted after `.env` changes

### Weather layer returns 401

This means the upstream OpenWeather key is not authorized for the requested endpoint yet.

Check:

1. `OPENWEATHER_API_KEY` is present in [`functions/.env`](C:\Users\Lenovo\OneDrive\Desktop\solution\functions\.env)
2. the functions emulator was restarted after editing `.env`
3. the key has access to the weather endpoint being used

### Buttons look clickable but do nothing

They now work in both modes:

- live emulator mode
- local simulation mode

If they still do nothing, restart:

```powershell
npm run dev
```

### Want to reset the demo state

Stop both terminals and start again:

```powershell
npm run functions:build
firebase emulators:start
npm run dev
```

## Optional helpers

### Seed Firestore with many reports

If you want many local reports:

```powershell
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\service-account.json
npm run seed:firestore
```

### Build frontend only

```powershell
npm run build
```

### Build backend only

```powershell
npm run functions:build
```

## Most important files

- Frontend app:
  - [`web/src/App.tsx`](C:\Users\Lenovo\OneDrive\Desktop\solution\web\src\App.tsx)
- Frontend Firebase wiring:
  - [`web/src/lib/firebase.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\web\src\lib\firebase.ts)
- Backend functions:
  - [`functions/src/index.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\functions\src\index.ts)
- Shared trust logic:
  - [`shared/trust.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\shared\trust.ts)
- Shared decision logic:
  - [`shared/decision.ts`](C:\Users\Lenovo\OneDrive\Desktop\solution\shared\decision.ts)
