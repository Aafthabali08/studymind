import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { firebase, firebaseEnabled } from "./firebase";

const AuthContext = createContext({ enabled: false, ready: true, user: null });
export const useAuth = () => useContext(AuthContext);

const MESSAGES = {
  "auth/invalid-credential": "Email or password is incorrect.",
  "auth/wrong-password": "Email or password is incorrect.",
  "auth/user-not-found": "No account uses this email. Create one instead.",
  "auth/email-already-in-use":
    "An account already uses this email. Sign in or reset your password.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/weak-password": "Use at least 6 characters for your password.",
  "auth/missing-password": "Enter your password.",
  "auth/too-many-requests":
    "Too many attempts. Wait a moment or reset your password.",
  "auth/network-request-failed":
    "You appear to be offline. Check your connection.",
  "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
  "auth/cancelled-popup-request": "Google sign-in was closed before finishing.",
  "auth/unauthorized-domain":
    "This domain is not authorized in Firebase Authentication settings.",
  "auth/operation-not-allowed":
    "This sign-in method is not enabled in the Firebase console.",
};
const snapshot = (u) =>
  u && {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
    emailVerified: u.emailVerified,
  };

export const authMessage = (error) =>
  MESSAGES[error?.code] ||
  error?.message ||
  "Something went wrong. Please try again.";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(!firebaseEnabled);
  useEffect(() => {
    if (!firebaseEnabled) return;
    let unsubscribe,
      live = true;
    firebase()
      .then(({ auth, fns }) => {
        if (!live) return;
        fns.auth.getRedirectResult(auth).catch(() => {});
        unsubscribe = fns.auth.onAuthStateChanged(auth, (u) => {
          setUser(snapshot(u));
          setReady(true);
        });
      })
      .catch(() => setReady(true));
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);
  const actions = useMemo(
    () => ({
      async google() {
        const { auth, fns } = await firebase();
        const provider = new fns.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        try {
          await fns.auth.signInWithPopup(auth, provider);
        } catch (error) {
          // Some mobile browsers block popups: fall back to a full redirect.
          if (error.code === "auth/popup-blocked")
            await fns.auth.signInWithRedirect(auth, provider);
          else throw error;
        }
      },
      async signIn(email, password) {
        const { auth, fns } = await firebase();
        await fns.auth.signInWithEmailAndPassword(auth, email.trim(), password);
      },
      async signUp(name, email, password) {
        const { auth, fns } = await firebase();
        const { user } = await fns.auth.createUserWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        if (name.trim())
          await fns.auth.updateProfile(user, { displayName: name.trim() });
        await fns.auth.sendEmailVerification(user).catch(() => {});
        setUser(snapshot(user));
      },
      async reset(email) {
        const { auth, fns } = await firebase();
        await fns.auth.sendPasswordResetEmail(auth, email.trim());
      },
      async signOut() {
        const { auth, fns } = await firebase();
        await fns.auth.signOut(auth);
      },
    }),
    [],
  );
  const value = useMemo(
    () => ({ enabled: firebaseEnabled, ready, user, ...actions }),
    [ready, user, actions],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
