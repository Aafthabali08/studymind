import React, { useCallback, useEffect, useState } from "react";
import AttachmentPicker from "./AttachmentPicker";
import { Lightbox } from "./Markdown";
import {
  MAX_ATTACHMENTS,
  compressImage,
  imagesFromClipboard,
} from "./imageUtils";
import { ArrowRight, ChevronLeft, LifeBuoy, Send } from "lucide-react";
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  createTicket,
  loadAttachments,
  markTicketRead,
  myTickets,
  replyToTicket,
} from "./support";

export const pictureCount = (t) =>
  (t.messages || []).reduce((n, m) => n + (m.attachments?.length || 0), 0);
export const StatusChip = ({ status }) => (
  <span className={`status-chip status-${status}`}>
    {TICKET_STATUSES[status] || status}
  </span>
);
const when = (d) =>
  d
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d)
    : "just now";

/** Loads a ticket's pictures (only when its messages have any). */
export function useTicketAttachments(ticket) {
  const [attachments, setAttachments] = useState({});
  const ids = (ticket?.messages || []).flatMap((m) => m.attachments || []);
  const key = `${ticket?.id}:${ids.join(",")}`;
  useEffect(() => {
    if (!ticket || !ids.length) return setAttachments({});
    let live = true;
    loadAttachments(ticket.id)
      .then((a) => live && setAttachments(a))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return attachments;
}

/** Adds pasted screenshots to a picker's list (⌘V in a text box). */
export function usePasteImages(images, setImages, notify) {
  return useCallback(
    async (e) => {
      const files = imagesFromClipboard(e);
      if (!files.length) return;
      e.preventDefault();
      const room = MAX_ATTACHMENTS - images.length;
      if (room <= 0)
        return notify(`You can attach up to ${MAX_ATTACHMENTS} pictures.`);
      const added = [];
      for (const file of files.slice(0, room)) {
        try {
          added.push(await compressImage(file));
        } catch (err) {
          notify(err.message);
        }
      }
      if (added.length)
        setImages((list) => [...list, ...added].slice(0, MAX_ATTACHMENTS));
    },
    [images.length, setImages, notify],
  );
}

/** Message thread shared by the user's and the admin's ticket views. */
export function TicketThread({ ticket, viewer }) {
  const attachments = useTicketAttachments(ticket);
  const [zoom, setZoom] = useState(null);
  const close = useCallback(() => setZoom(null), []);
  return (
    <>
      <ol className="ticket-thread" aria-label="Messages">
        {(ticket.messages || []).map((m, i) => (
          <li
            key={i}
            className={
              `bubble from-${m.from}` + (m.from === viewer ? " mine" : "")
            }
          >
            <small>
              {m.from === "admin"
                ? "StudyMind team"
                : ticket.name || ticket.email || "You"}{" "}
              · {when(new Date(m.at))}
            </small>
            {m.text && <p>{m.text}</p>}
            {m.attachments?.length > 0 && (
              <div className="bubble-pictures">
                {m.attachments.map((id, n) =>
                  attachments[id] ? (
                    <button
                      key={id}
                      type="button"
                      className="bubble-picture"
                      aria-label={`View picture ${n + 1} full screen`}
                      onClick={() =>
                        setZoom({
                          src: attachments[id].dataUrl,
                          alt: attachments[id].name || `Picture ${n + 1}`,
                        })
                      }
                    >
                      <img
                        src={attachments[id].dataUrl}
                        alt={attachments[id].name || `Picture ${n + 1}`}
                      />
                    </button>
                  ) : (
                    <span
                      key={id}
                      className="bubble-picture loading"
                      aria-label="Loading picture"
                    />
                  ),
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <Lightbox image={zoom} onClose={close} />
    </>
  );
}

/** Complaint box: raise a ticket, follow its status, reply to the team. */
export default function Support({
  active,
  user,
  notify,
  openTicketId,
  onOpened,
}) {
  const [tickets, setTickets] = useState([]),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState(null),
    [form, setForm] = useState({
      category: TICKET_CATEGORIES[0],
      subject: "",
      message: "",
    }),
    [reply, setReply] = useState(""),
    [ticketImages, setTicketImages] = useState([]),
    [replyImages, setReplyImages] = useState([]),
    [busy, setBusy] = useState(false);

  async function refresh(focusId) {
    setLoading(true);
    try {
      const list = await myTickets(user.uid);
      setTickets(list);
      if (focusId) setSelected(list.find((t) => t.id === focusId) || null);
      else
        setSelected((s) =>
          s ? list.find((t) => t.id === s.id) || null : null,
        );
    } catch {
      notify("Could not load your tickets. Check your connection.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (active && user) refresh(openTicketId);
    if (openTicketId) onOpened?.();
  }, [active, user?.uid, openTicketId]);
  useEffect(() => {
    if (selected?.unreadForUser)
      markTicketRead(selected, "user").catch(() => {});
  }, [selected?.id]);

  const pasteTicket = usePasteImages(ticketImages, setTicketImages, notify);
  const pasteReply = usePasteImages(replyImages, setReplyImages, notify);
  async function submit(e) {
    e.preventDefault();
    if (!form.subject.trim() || form.message.trim().length < 10)
      return notify(
        "Add a subject and describe the problem (at least 10 characters).",
      );
    setBusy(true);
    try {
      const id = await createTicket(user, { ...form, images: ticketImages });
      setForm({ category: TICKET_CATEGORIES[0], subject: "", message: "" });
      setTicketImages([]);
      notify(
        ticketImages.length
          ? `Ticket sent with ${ticketImages.length} picture${ticketImages.length === 1 ? "" : "s"}. You'll get a notification when the team replies.`
          : "Ticket sent. You'll get a notification when the team replies.",
      );
      await refresh(id);
    } catch {
      notify("Could not send your ticket. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim() && !replyImages.length) return;
    setBusy(true);
    try {
      await replyToTicket(selected, "user", reply, replyImages);
      setReply("");
      setReplyImages([]);
      await refresh(selected.id);
    } catch {
      notify("Could not send your reply.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div hidden={!active}>
      <section className="page-title">
        <div className="eyebrow">HELP & SUPPORT</div>
        <h1>We're listening.</h1>
        <p>
          Report a problem or a wrong answer. You'll be notified when the status
          changes.
        </p>
      </section>
      <div className="plan-layout">
        <form className="panel setup" onSubmit={submit}>
          <h2>
            <LifeBuoy size={20} /> New ticket
          </h2>
          <label>
            Category
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input
              value={form.subject}
              maxLength={140}
              placeholder="e.g. 8-mark answer on page 4 is wrong"
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </label>
          <label>
            What happened?
            <textarea
              value={form.message}
              maxLength={3000}
              rows={6}
              placeholder="Describe the problem, the document and the steps."
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              onPaste={pasteTicket}
            />
          </label>
          <AttachmentPicker
            images={ticketImages}
            onChange={setTicketImages}
            notify={notify}
            disabled={busy}
          />
          <button className="primary" disabled={busy}>
            {busy ? "Sending…" : "Send ticket"} <ArrowRight size={16} />
          </button>
        </form>
        <section className="panel setup">
          {selected ? (
            <>
              <button className="text-button" onClick={() => setSelected(null)}>
                <ChevronLeft size={16} /> All my tickets
              </button>
              <div className="ticket-head">
                <h2>{selected.subject}</h2>
                <StatusChip status={selected.status} />
              </div>
              <p className="fine">
                {selected.category} · opened {when(selected.createdAt)}
              </p>
              <TicketThread ticket={selected} viewer="user" />
              {selected.status !== "closed" && (
                <form className="reply-form" onSubmit={sendReply}>
                  <div className="chat-form">
                    <input
                      aria-label="Reply to the team"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onPaste={pasteReply}
                      placeholder="Add more details…"
                    />
                    <button
                      className="icon-dark"
                      aria-label="Send reply"
                      disabled={busy || (!reply.trim() && !replyImages.length)}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                  <AttachmentPicker
                    images={replyImages}
                    onChange={setReplyImages}
                    notify={notify}
                    disabled={busy}
                  />
                </form>
              )}
            </>
          ) : (
            <>
              <h2>My tickets</h2>
              {loading && !tickets.length ? (
                <p className="fine">Loading…</p>
              ) : tickets.length ? (
                <ul className="ticket-list">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button
                        className="ticket-row"
                        onClick={() => setSelected(t)}
                      >
                        {t.unreadForUser && (
                          <i className="unread-dot" aria-label="New reply" />
                        )}
                        <span>
                          <strong>
                            {t.subject}
                            {pictureCount(t) > 0 && (
                              <span
                                className="pic-count"
                                aria-label={`${pictureCount(t)} pictures`}
                              >
                                {" "}
                                🖼 {pictureCount(t)}
                              </span>
                            )}
                          </strong>
                          <small>
                            {t.category} · updated {when(t.updatedAt)}
                          </small>
                        </span>
                        <StatusChip status={t.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No tickets yet. If something looks wrong, tell us on the left.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
