import React, { useState } from "react";
import { ArrowRight, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { authMessage, useAuth } from "./auth";

const TITLES = {
  signin: [
    "Welcome back.",
    "Sign in to sync your library, notes, resume and practice sessions.",
  ],
  signup: [
    "Create your account.",
    "Keep every document and interview session safe across devices.",
  ],
  reset: [
    "Reset your password.",
    "Enter your account email and we'll send you a secure reset link.",
  ],
};

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.57-2.47C16.68 3.72 14.53 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51Z"
      />
    </svg>
  );
}

export default function AuthPanel({ onDone, notify, initialMode = "signin" }) {
  const auth = useAuth();
  const [mode, setMode] = useState(initialMode),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  const [title, subtitle] = TITLES[mode];
  function switchMode(next) {
    setMode(next);
    setError("");
    setSent(false);
  }
  async function run(action, success) {
    setBusy(true);
    setError("");
    try {
      await action();
      success?.();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function submit(e) {
    e.preventDefault();
    if (mode === "reset")
      return run(
        () => auth.reset(email),
        () => setSent(true),
      );
    if (mode === "signup" && password.length < 6)
      return setError("Use at least 6 characters for your password.");
    run(
      () =>
        mode === "signin"
          ? auth.signIn(email, password)
          : auth.signUp(name, email, password),
      () => {
        notify(
          mode === "signup"
            ? "Account created. We sent a verification email."
            : "Signed in. Your library now syncs to your account.",
        );
        onDone();
      },
    );
  }
  return (
    <div className="auth-panel">
      {mode === "reset" && (
        <button className="text-button" onClick={() => switchMode("signin")}>
          <ChevronLeft size={15} /> Back to sign in
        </button>
      )}
      <h2 id="dialog-title">{title}</h2>
      <p>{subtitle}</p>
      {mode !== "reset" && (
        <>
          <button
            className="secondary google"
            disabled={busy}
            onClick={() =>
              run(auth.google, () => {
                notify("Signed in with Google. Your library now syncs.");
                onDone();
              })
            }
          >
            <GoogleMark /> Continue with Google
          </button>
          <div className="divider">
            <span>or with email</span>
          </div>
        </>
      )}
      {sent ? (
        <div className="feedback" role="status">
          <strong>Check your inbox.</strong>
          <p>
            If an account exists for {email.trim()}, a password reset link is on
            its way. It can take a minute; check spam too.
          </p>
          <button className="primary" onClick={() => switchMode("signin")}>
            Back to sign in <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          {mode === "signup" && (
            <label>
              Name
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {mode !== "reset" && (
            <label>
              <span className="label-row">
                Password
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => switchMode("reset")}
                  >
                    Forgot password?
                  </button>
                )}
              </span>
              <span className="password-field">
                <input
                  type={show ? "text" : "password"}
                  required
                  value={password}
                  minLength={mode === "signup" ? 6 : undefined}
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "signup"
                      ? "At least 6 characters"
                      : "Your password"
                  }
                />
                <button
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow((v) => !v)}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
            <ArrowRight size={16} />
          </button>
        </form>
      )}
      {mode !== "reset" && (
        <p className="switch-mode">
          {mode === "signin" ? "New to StudyMind?" : "Already have an account?"}{" "}
          <button
            className="text-button"
            onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      )}
    </div>
  );
}
