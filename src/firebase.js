// Firebase sign-in and Firestore (free Spark plan). Without VITE_FIREBASE_*
// values the landing page explains how to set it up. The SDK is loaded lazily
// so it never slows the first paint.
/**
 * Google sign-in runs its handler page (/__/auth/handler) on `authDomain`.
 * When that is another site (studymind-….firebaseapp.com) than the app,
 * phone browsers partition its storage and redirect sign-in fails with
 * "Unable to process request due to missing initial state". So the app's own
 * domain is used whenever it serves the handler: Firebase Hosting does this
 * for its .web.app / .firebaseapp.com domains, and render.yaml proxies
 * /__/auth/* to Firebase (set VITE_FIREBASE_AUTH_SAME_ORIGIN=true there).
 */
export function authDomainFor(
  configured,
  location = typeof window !== "undefined" ? window.location : null,
  sameOrigin = import.meta.env.VITE_FIREBASE_AUTH_SAME_ORIGIN === "true",
) {
  const host = location?.host;
  if (!host || !configured || location.protocol !== "https:") return configured;
  const project = configured.replace(/\.(firebaseapp\.com|web\.app)$/, "");
  const firebaseHosting =
    host === `${project}.web.app` || host === `${project}.firebaseapp.com`;
  return firebaseHosting || sameOrigin ? host : configured;
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: authDomainFor(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// App Check (free, reCAPTCHA v3): proves requests come from this website, so
// a copied config or AI Logic endpoint can't be abused from elsewhere.
const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || "";
async function startAppCheck(app) {
  if (!RECAPTCHA_SITE_KEY) return;
  try {
    if (import.meta.env.DEV) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // localhost testing
    const { initializeAppCheck, ReCaptchaV3Provider } =
      await import("firebase/app-check");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    console.warn("App Check could not start:", error);
  }
}

// Local testing only (`npm run dev:emulators`): talk to the Firebase emulators
// on this machine instead of the real project.
const useEmulators = import.meta.env.VITE_FIREBASE_EMULATORS === "true";

export const firebaseEnabled = Boolean(
  config.apiKey && config.projectId && config.appId,
);

let services;
export function firebase() {
  if (!firebaseEnabled)
    return Promise.reject(new Error("Firebase is not configured."));
  services ||= (async () => {
    const [{ initializeApp }, auth, firestore] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const app = initializeApp(config);
    await startAppCheck(app);
    let db;
    try {
      // Offline cache: the library opens instantly and survives reloads.
      db = firestore.initializeFirestore(app, {
        localCache: firestore.persistentLocalCache({
          tabManager: firestore.persistentMultipleTabManager(),
        }),
      });
    } catch {
      db = firestore.getFirestore(app);
    }
    const authService = auth.getAuth(app);
    if (useEmulators) {
      auth.connectAuthEmulator(authService, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
      firestore.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
    return {
      app,
      auth: authService,
      db,
      fns: { auth, firestore },
    };
  })();
  return services;
}
