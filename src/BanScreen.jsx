import React, { useState } from "react";
import { CheckCircle2, LogOut, MessageSquare, Send } from "lucide-react";
import { appealTicket } from "./support";

const when = (d) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(d);

/**
 * Shown over the app while the account is blocked or suspended. The only
 * things it allows: raising a ticket for the admin ("Contact admin") and
 * logging out.
 */
export default function BanScreen({ user, ban, onLogOut }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  async function send(e) {
    e.preventDefault();
    if (!message.trim() || state === "sending") return;
    setState("sending");
    setError("");
    try {
      await appealTicket(user, ban, message);
      setState("sent");
      setMessage("");
    } catch (err) {
      setState("error");
      setError(
        err?.code === "permission-denied"
          ? "The ticket could not be sent. Try again later."
          : err?.message || "The ticket could not be sent. Check your connection.",
      );
    }
  }

  return (
    <div className="ban-screen" role="alertdialog" aria-modal="true" aria-labelledby="ban-title">
      <section className="panel ban-card">
        <span className="eyebrow">STUDYMIND</span>
        <h1 id="ban-title">{ban.kind === "blocked" ? "Your account is blocked." : "Your account is suspended."}</h1>
        <p>
          {ban.kind === "blocked"
            ? "The StudyMind admin has blocked this account, so it can't be used."
            : `You can use StudyMind again on ${when(ban.until)}.`}
        </p>
        {ban.reason && (
          <p className="ban-reason">
            <strong>Reason:</strong> {ban.reason}
          </p>
        )}
        <p className="fine">Signed in as {user.email}. If you think this is a mistake, contact the admin.</p>

        {state === "sent" ? (
          <p className="ban-sent" role="status">
            <CheckCircle2 size={17} /> Ticket sent. The admin will review it; you'll see the reply here in StudyMind once
            your access is back.
          </p>
        ) : open ? (
          <form className="ban-contact" onSubmit={send} aria-label="Contact admin">
            <label htmlFor="ban-message">Message to the admin</label>
            <textarea
              id="ban-message"
              rows={4}
              maxLength={3000}
              value={message}
              placeholder="Explain why your access should be restored…"
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
            {state === "error" && (
              <p className="ban-error" role="alert">
                {error}
              </p>
            )}
            <div className="button-row">
              <button className="primary" disabled={!message.trim() || state === "sending"}>
                <Send size={16} /> {state === "sending" ? "Sending…" : "Raise ticket"}
              </button>
              <button type="button" className="secondary" disabled={state === "sending"} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <div className="button-row ban-actions">
          {!open && state !== "sent" && (
            <button className="primary" onClick={() => setOpen(true)}>
              <MessageSquare size={16} /> Contact admin
            </button>
          )}
          <button className={state === "sent" ? "primary" : "secondary"} onClick={onLogOut}>
            <LogOut size={16} /> Log out
          </button>
        </div>
      </section>
    </div>
  );
}
