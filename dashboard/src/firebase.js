// Initializes the Firebase CLIENT SDK for the admin dashboard.
//
// IMPORTANT: In this project the dashboard uses Firebase ONLY for
// authentication (admins logging in). All DATA — employees, locations,
// attendance — goes through the NestJS backend, which is the trusted layer
// that talks to Firestore via the Admin SDK. See src/services/* for that.
//
// The values below are read from environment variables (see .env). The web
// config is NOT secret — it's safe to expose in the browser — but we keep it
// in .env so each teammate can point at their own Firebase project.
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Exported (not just used locally) so an optional add-on like
// push-notifications.js.example can reuse this same initialized app instead
// of calling initializeApp() a second time, which Firebase disallows.
export const app = initializeApp(firebaseConfig)

// The auth instance is used by AuthContext to sign in/out and watch the
// logged-in user.
export const auth = getAuth(app)

// Firestore instance for REALTIME reads only (onSnapshot listeners), so the
// dashboard updates the instant a check-in/out happens without polling. All
// WRITES still go through the NestJS backend (the trusted Admin-SDK layer).
export const db = getFirestore(app)
