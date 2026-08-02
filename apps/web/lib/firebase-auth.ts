import { getApp, getApps, initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signOut,
} from "firebase/auth";

export async function createGoogleSession() {
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: required("NEXT_PUBLIC_FIREBASE_API_KEY"),
        authDomain: required("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
        projectId: required("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
        appId: required("NEXT_PUBLIC_FIREBASE_APP_ID"),
      });
  const auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: await credential.user.getIdToken() }),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error("FIREBASE_SESSION_EXCHANGE_FAILED");
    return body as { user: { tenantId: string } };
  } finally {
    await signOut(auth);
  }
}

function required(name: FirebasePublicEnvironmentName) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const environment = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

type FirebasePublicEnvironmentName = keyof typeof environment;
