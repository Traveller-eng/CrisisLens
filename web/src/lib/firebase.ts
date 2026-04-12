import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { appConfig, setupChecklist } from "../config";

const firebaseEnabled = setupChecklist.hasFirebaseConfig;

const firebaseApp = firebaseEnabled ? initializeApp(appConfig.firebase) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;
const functionsClient = firebaseApp ? getFunctions(firebaseApp) : null;

if (db && appConfig.emulators.enabled && typeof window !== "undefined") {
  connectFirestoreEmulator(db, appConfig.emulators.firestoreHost, appConfig.emulators.firestorePort);
}

if (functionsClient && appConfig.emulators.enabled && typeof window !== "undefined") {
  connectFunctionsEmulator(functionsClient, appConfig.emulators.firestoreHost, 5005);
}

if (firebaseApp && typeof window !== "undefined") {
  isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(firebaseApp);
      }
    })
    .catch(() => undefined);
}

export { db, firebaseEnabled, functionsClient };
