export const appConfig = {
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
  },
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY,
  geminiModel: import.meta.env.VITE_GEMINI_MODEL || "gemini-2.0-flash",
  emulators: {
    enabled: import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true",
    firestoreHost: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1",
    firestorePort: Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || "8085")
  }
};

export const setupChecklist = {
  hasFirebaseConfig: Boolean(
    appConfig.firebase.apiKey &&
      appConfig.firebase.authDomain &&
      appConfig.firebase.projectId &&
      appConfig.firebase.storageBucket &&
      appConfig.firebase.messagingSenderId &&
      appConfig.firebase.appId
  ),
  hasMapsKey: Boolean(appConfig.googleMapsApiKey),
  hasGeminiKey: Boolean(appConfig.geminiApiKey)
};
