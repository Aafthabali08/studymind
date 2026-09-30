import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  Inbox,
  MessageSquareWarning,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  FEEDBACK_KINDS,
  TICKET_STATUSES,
  adminFeedback,
  adminTickets,
  adminUsers,
  loadGuidance,
  markFeedbackReviewed,
  markTicketRead,
  notifyUser,
  replyToTicket,
  saveGuidance,
  setTicketStatus,
} from "./support";
import {
  StatusChip,
  TicketThread,
  pictureCount,
  usePasteImages,
} from "./SupportPage";
import AttachmentPicker from "./AttachmentPicker";
import { setLearning } from "./ai/memory";

/** Feedback items are Markdown; show them as readable plain text. */
const plain = (md) =>
  String(md ?? "")
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/^\s{0,3}(#{1,6}|[-*+])\s+/gm, "• ")
    .replace(/[*_`]/g, "")
    .trim();

const SECTIONS = [
  ["overview", "Overview", BarChart3],
  ["users", "Users", Users],
  ["tickets", "Tickets", Inbox],
  ["feedback", "Feedback", MessageSquareWarning],
  ["guidance", "AI guidance", Sparkles],
];
const date = (d) =>
  d ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(d) : "—";
const dateTime = (d) =>
  d
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d)
    : "—";

/** Admin dashboard: users, documents, tickets, feedback and AI guidance. */
export default function AdminPage({ active, notify }) {
  const [section, setSection] = useState("overview"),
    [users, setUsers] = useState([]),
    [tickets, setTickets] = useState([]),
    [feedback, setFeedback] = useState([]),
    [guidance, setGuidance] = useState([]),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState(null),
    [userDetail, setUserDetail] = useState(null),
    [ticketFilter, setTicketFilter] = useState("active"),
    [ticket, setTicket] = useState(null),
    [reply, setReply] = useState(""),
    [replyImages, setReplyImages] = useState([]),
    [fbFilter, setFbFilter] = useState({
      verdict: "wrong",
      kind: "all",
      reviewed: "open",
    }),
    [newRule, setNewRule] = useState("");
  const searchTimer = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const [u, t, f, g] = await Promise.all([
        adminUsers(),
        adminTickets(),
        adminFeedback(),
        loadGuidance(),
      ]);
      setUsers(u);
      setTickets(t);
      setFeedback(f);
      setGuidance(g);
    } catch (e) {
      notify(
        e?.code === "permission-denied"
          ? "Admin access denied. Publish the new firestore.rules and sign in with the admin email."
          : "Could not load admin data. Check your connection.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (active) load();
  }, [active]);

  // Search users by email (prefix), debounced.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!search.trim()) return setSearchResults(null);
    searchTimer.current = setTimeout(
      () =>
        adminUsers({ search })
          .then(setSearchResults)
          .catch(() => notify("User search failed.")),
      300,
    );
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const stats = useMemo(() => {
    const docs = users.reduce((n, u) => n + (u.docCount || 0), 0);
    const open = tickets.filter(
      (t) => t.status === "open" || t.status === "in_progress",
    ).length;
    const correct = feedback.filter((f) => f.verdict === "correct").length;
    const byKind = Object.keys(FEEDBACK_KINDS).map((kind) => {
      const list = feedback.filter((f) => f.kind === kind);
      return {
        kind,
        correct: list.filter((f) => f.verdict === "correct").length,
        wrong: list.filter((f) => f.verdict === "wrong").length,
      };
    });
    const weekAgo = Date.now() - 7 * 864e5;
    const byStatus = Object.fromEntries(
      Object.keys(TICKET_STATUSES).map((k) => [
        k,
        tickets.filter((t) => t.status === k).length,
      ]),
    );
    return {
      tickets: tickets.length,
      byStatus,
      correct,
      wrong: feedback.length - correct,
      comments: feedback.filter((f) => f.comment).length,
      users: users.length,
      activeWeek: users.filter(
        (u) => u.lastActive && u.lastActive.getTime() > weekAgo,
      ).length,
      docs,
      open,
      unread: tickets.filter((t) => t.unreadForAdmin).length,
      feedback: feedback.length,
      accuracy: feedback.length
        ? Math.round((correct / feedback.length) * 100)
        : null,
      byKind,
    };
  }, [users, tickets, feedback]);

  const ticketsFor = (uid) => tickets.filter((t) => t.uid === uid);
  const feedbackFor = (uid) => feedback.filter((f) => f.uid === uid);
  const shownTickets = tickets.filter((t) =>
    ticketFilter === "all"
      ? true
      : ticketFilter === "active"
        ? t.status === "open" || t.status === "in_progress"
        : t.status === ticketFilter,
  );
  const shownFeedback = feedback.filter(
    (f) =>
      (fbFilter.verdict === "all" || f.verdict === fbFilter.verdict) &&
      (fbFilter.kind === "all" || f.kind === fbFilter.kind) &&
      (fbFilter.reviewed === "all" ||
        (fbFilter.reviewed === "open" ? !f.reviewed : f.reviewed)),
  );

  function showTickets(filter) {
    setTicket(null);
    setTicketFilter(filter);
    setSection("tickets");
  }
  function openTicket(t) {
    setTicket({ ...t, unreadForAdmin: false });
    setReply("");
    setSection("tickets");
    if (t.unreadForAdmin)
      markTicketRead(t, "admin")
        .then(() =>
          setTickets((all) =>
            all.map((x) =>
              x.id === t.id ? { ...x, unreadForAdmin: false } : x,
            ),
          ),
        )
        .catch(() => {});
  }
  const pasteReply = usePasteImages(replyImages, setReplyImages, notify);
  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim() && !replyImages.length) return;
    try {
      const message = await replyToTicket(ticket, "admin", reply, replyImages);
      await notifyUser(ticket.uid, {
        title: `New reply on "${ticket.subject}"`,
        body:
          reply.trim() ||
          `The team sent ${replyImages.length} picture${replyImages.length === 1 ? "" : "s"}.`,
        ticketId: ticket.id,
      });
      setReplyImages([]);
      const next = {
        ...ticket,
        messages: [...(ticket.messages || []), message],
        unreadForUser: true,
        unreadForAdmin: false,
      };
      setTicket(next);
      setTickets((all) => all.map((t) => (t.id === next.id ? next : t)));
      setReply("");
      notify("Reply sent and the user was notified.");
    } catch {
      notify("Could not send the reply.");
    }
  }
  async function updateStatus(status) {
    try {
      await setTicketStatus(ticket, status, reply);
      const next = {
        ...ticket,
        status,
        unreadForAdmin: false,
        messages: reply.trim()
          ? [
              ...(ticket.messages || []),
              {
                from: "admin",
                text: reply.trim(),
                at: new Date().toISOString(),
              },
            ]
          : ticket.messages,
      };
      setTicket(next);
      setTickets((all) => all.map((t) => (t.id === next.id ? next : t)));
      setReply("");
      notify(
        `Status set to ${TICKET_STATUSES[status]}; the user was notified.`,
      );
    } catch {
      notify("Could not update the ticket.");
    }
  }
  async function toggleReviewed(f) {
    try {
      await markFeedbackReviewed(f.id, !f.reviewed);
      setFeedback((all) =>
        all.map((x) => (x.id === f.id ? { ...x, reviewed: !f.reviewed } : x)),
      );
    } catch {
      notify("Could not update the feedback.");
    }
  }
  async function storeGuidance(next, message) {
    try {
      await saveGuidance(next);
      setGuidance(next);
      setLearning({ guidance: next });
      notify(message);
    } catch {
      notify("Could not save guidance.");
    }
  }
  const ruleFrom = (f) =>
    f.comment
      ? `In ${FEEDBACK_KINDS[f.kind] || f.kind}: ${f.comment}`
      : `In ${FEEDBACK_KINDS[f.kind] || f.kind}, avoid output like: "${plain(f.item).slice(0, 120)}"`;
  // Turning feedback into a rule also marks it reviewed; the same rule is
  // never added twice.
  async function addRuleFrom(f) {
    const rule = ruleFrom(f);
    if (guidance.includes(rule))
      notify("This rule is already in AI guidance.");
    else
      await storeGuidance(
        [...guidance, rule],
        "Added to AI guidance for all users.",
      );
    if (!f.reviewed) await toggleReviewed(f);
  }

  const userRows = searchResults ?? users;

  return (
    <div hidden={!active}>
      <section className="page-title">
        <div className="eyebrow">
          <ShieldCheck size={14} /> ADMIN
        </div>
        <h1>Admin dashboard.</h1>
        <p>
          Users, documents, complaints and feedback, all on the free Firebase
          plan.
        </p>
      </section>
      <div className="admin-layout">
        <nav className="admin-nav panel" aria-label="Admin sections">
          {SECTIONS.map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={17} />
              {label}
              {id === "tickets" && stats.unread > 0 && (
                <span className="count">{stats.unread}</span>
              )}
              {id === "feedback" &&
                feedback.some((f) => !f.reviewed && f.verdict === "wrong") && (
                  <span className="count">
                    {
                      feedback.filter(
                        (f) => !f.reviewed && f.verdict === "wrong",
                      ).length
                    }
                  </span>
                )}
            </button>
          ))}
          <button onClick={load} disabled={loading} className="admin-refresh">
            <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
          </button>
        </nav>

        <section className="panel admin-main">
          {section === "overview" && (
            <>
              <h2>Overview</h2>
              <h3 className="admin-group">People & content</h3>
              <div className="admin-stats">
                <div>
                  <strong>{stats.users}</strong>
                  <small>users</small>
                </div>
                <div>
                  <strong>{stats.activeWeek}</strong>
                  <small>active this week</small>
                </div>
                <div>
                  <strong>{stats.docs}</strong>
                  <small>documents</small>
                </div>
                <div>
                  <strong>{stats.feedback}</strong>
                  <small>
                    feedback · {stats.comments} with comments
                  </small>
                </div>
                <div>
                  <strong>
                    {stats.accuracy == null ? "—" : `${stats.accuracy}%`}
                  </strong>
                  <small>
                    AI marked correct (✓ {stats.correct} · ✗ {stats.wrong})
                  </small>
                </div>
              </div>
              <h3 className="admin-group">Tickets</h3>
              <div className="admin-stats tickets">
                <button onClick={() => showTickets("all")}>
                  <strong>{stats.tickets}</strong>
                  <small>received</small>
                </button>
                <button onClick={() => showTickets("open")}>
                  <strong>{stats.byStatus.open}</strong>
                  <small>open</small>
                </button>
                <button onClick={() => showTickets("in_progress")}>
                  <strong>{stats.byStatus.in_progress}</strong>
                  <small>in progress</small>
                </button>
                <button onClick={() => showTickets("resolved")}>
                  <strong>{stats.byStatus.resolved}</strong>
                  <small>fixed</small>
                </button>
                <button onClick={() => showTickets("closed")}>
                  <strong>{stats.byStatus.closed}</strong>
                  <small>closed</small>
                </button>
                <button onClick={() => showTickets("active")}>
                  <strong>{stats.unread}</strong>
                  <small>unread replies</small>
                </button>
              </div>
              {stats.tickets > 0 && (
                <div
                  className="status-bar"
                  aria-label={Object.entries(stats.byStatus)
                    .map(([k, n]) => `${n} ${TICKET_STATUSES[k]}`)
                    .join(", ")}
                >
                  {Object.entries(stats.byStatus).map(([k, n]) =>
                    n ? (
                      <i
                        key={k}
                        className={`s-${k}`}
                        style={{ flexGrow: n }}
                        title={`${TICKET_STATUSES[k]}: ${n}`}
                      />
                    ) : null,
                  )}
                </div>
              )}
              <h3>Feedback by feature</h3>
              <div className="kind-bars">
                {stats.byKind.map(({ kind, correct, wrong }) => {
                  const total = correct + wrong || 1;
                  return (
                    <div key={kind} className="kind-bar">
                      <span>{FEEDBACK_KINDS[kind]}</span>
                      <span
                        className="bar"
                        aria-label={`${correct} correct, ${wrong} wrong`}
                      >
                        <i
                          className="good"
                          style={{ width: `${(correct / total) * 100}%` }}
                        />
                        <i
                          className="bad"
                          style={{ width: `${(wrong / total) * 100}%` }}
                        />
                      </span>
                      <small>
                        ✓ {correct} · ✗ {wrong}
                      </small>
                    </div>
                  );
                })}
              </div>
              <h3>Latest tickets</h3>
              <ul className="ticket-list">
                {tickets.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <button
                      className="ticket-row"
                      onClick={() => openTicket(t)}
                    >
                      {t.unreadForAdmin && (
                        <i className="unread-dot" aria-label="Unread" />
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
                          {t.email} · {dateTime(t.updatedAt)}
                        </small>
                      </span>
                      <StatusChip status={t.status} />
                    </button>
                  </li>
                ))}
                {!tickets.length && <p className="fine">No tickets yet.</p>}
              </ul>
            </>
          )}

          {section === "users" && (
            <>
              <h2>Users</h2>
              <label className="search admin-search">
                <Search size={17} />
                <input
                  aria-label="Search users by email"
                  placeholder="Search users by email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              {userDetail ? (
                <div className="user-detail">
                  <button
                    className="text-button"
                    onClick={() => setUserDetail(null)}
                  >
                    ← All users
                  </button>
                  <h3>{userDetail.name || userDetail.email}</h3>
                  <p className="fine">{userDetail.email}</p>
                  <div className="admin-stats">
                    <div>
                      <strong>{userDetail.docCount || 0}</strong>
                      <small>documents</small>
                    </div>
                    <div>
                      <strong>{ticketsFor(userDetail.id).length}</strong>
                      <small>tickets</small>
                    </div>
                    <div>
                      <strong>{feedbackFor(userDetail.id).length}</strong>
                      <small>feedback</small>
                    </div>
                    <div>
                      <strong>{date(userDetail.createdAt)}</strong>
                      <small>joined</small>
                    </div>
                    <div>
                      <strong>{date(userDetail.lastActive)}</strong>
                      <small>last active</small>
                    </div>
                  </div>
                  <h3>Tickets</h3>
                  <ul className="ticket-list">
                    {ticketsFor(userDetail.id).map((t) => (
                      <li key={t.id}>
                        <button
                          className="ticket-row"
                          onClick={() => openTicket(t)}
                        >
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
                            <small>{dateTime(t.updatedAt)}</small>
                          </span>
                          <StatusChip status={t.status} />
                        </button>
                      </li>
                    ))}
                    {!ticketsFor(userDetail.id).length && (
                      <p className="fine">No tickets.</p>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="md-table">
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Documents</th>
                        <th>Tickets</th>
                        <th>Joined</th>
                        <th>Last active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userRows.map((u) => (
                        <tr
                          key={u.id}
                          className="user-row"
                          onClick={() => setUserDetail(u)}
                        >
                          <td>
                            <button
                              className="user-cell"
                              aria-label={`Open ${u.email}`}
                            >
                              <strong>{u.name || "—"}</strong>
                              <small>{u.email}</small>
                            </button>
                          </td>
                          <td>{u.docCount || 0}</td>
                          <td>{ticketsFor(u.id).length}</td>
                          <td>{date(u.createdAt)}</td>
                          <td>{date(u.lastActive)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!userRows.length && <p className="fine">No users found.</p>}
                </div>
              )}
            </>
          )}

          {section === "tickets" && (
            <>
              <h2>Tickets</h2>
              {ticket ? (
                <>
                  <button
                    className="text-button"
                    onClick={() => setTicket(null)}
                  >
                    ← All tickets
                  </button>
                  <div className="ticket-head">
                    <h3>{ticket.subject}</h3>
                    <StatusChip status={ticket.status} />
                  </div>
                  <p className="fine">
                    {ticket.email} · {ticket.category} · opened{" "}
                    {dateTime(ticket.createdAt)}
                  </p>
                  <TicketThread ticket={ticket} viewer="admin" />
                  <form className="admin-reply" onSubmit={sendReply}>
                    <textarea
                      aria-label="Message to the user"
                      rows={3}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Write to the user…"
                      onPaste={pasteReply}
                    />
                    <AttachmentPicker
                      images={replyImages}
                      onChange={setReplyImages}
                      notify={notify}
                      hint="Show the user a screenshot of the fix or the steps."
                    />
                    <div className="button-row">
                      <button
                        className="secondary"
                        disabled={!reply.trim() && !replyImages.length}
                      >
                        Send reply
                      </button>
                    </div>
                    <div
                      className="status-actions"
                      role="group"
                      aria-label="Ticket status"
                    >
                      <span className="fine">
                        Set status (the message above is sent with it):
                      </span>
                      {[
                        ["in_progress", "In progress"],
                        ["resolved", "✓ Mark fixed"],
                        ["closed", "Close ticket"],
                        ["open", "Reopen"],
                      ].map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          className={v === "resolved" ? "primary" : "secondary"}
                          disabled={ticket.status === v}
                          onClick={() => updateStatus(v)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <div
                    className="chips"
                    role="group"
                    aria-label="Ticket filter"
                  >
                    {[
                      ["active", "Open & in progress"],
                      ...Object.entries(TICKET_STATUSES),
                      ["all", "All"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        className={
                          "chip" + (ticketFilter === v ? " active" : "")
                        }
                        aria-pressed={ticketFilter === v}
                        onClick={() => setTicketFilter(v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <ul className="ticket-list">
                    {shownTickets.map((t) => (
                      <li key={t.id}>
                        <button
                          className="ticket-row"
                          onClick={() => openTicket(t)}
                        >
                          {t.unreadForAdmin && (
                            <i className="unread-dot" aria-label="Unread" />
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
                              {t.email} · {t.category} · {dateTime(t.updatedAt)}
                            </small>
                          </span>
                          <StatusChip status={t.status} />
                        </button>
                      </li>
                    ))}
                    {!shownTickets.length && (
                      <p className="fine">No tickets here.</p>
                    )}
                  </ul>
                </>
              )}
            </>
          )}

          {section === "feedback" && (
            <>
              <h2>Feedback</h2>
              <p className="fine">
                What users marked correct or wrong. Turn a pattern into an AI
                guidance rule and Gemini follows it for everyone.
              </p>
              <div className="admin-filters">
                <select
                  aria-label="Verdict"
                  value={fbFilter.verdict}
                  onChange={(e) =>
                    setFbFilter({ ...fbFilter, verdict: e.target.value })
                  }
                >
                  <option value="wrong">✗ Wrong</option>
                  <option value="correct">✓ Correct</option>
                  <option value="all">All verdicts</option>
                </select>
                <select
                  aria-label="Feature"
                  value={fbFilter.kind}
                  onChange={(e) =>
                    setFbFilter({ ...fbFilter, kind: e.target.value })
                  }
                >
                  <option value="all">All features</option>
                  {Object.entries(FEEDBACK_KINDS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Reviewed"
                  value={fbFilter.reviewed}
                  onChange={(e) =>
                    setFbFilter({ ...fbFilter, reviewed: e.target.value })
                  }
                >
                  <option value="open">Not reviewed</option>
                  <option value="done">Reviewed</option>
                  <option value="all">All</option>
                </select>
              </div>
              <ul className="feedback-list">
                {shownFeedback.map((f) => (
                  <li
                    key={f.id}
                    className={
                      `feedback-item ${f.verdict}` +
                      (f.reviewed ? " reviewed" : "")
                    }
                  >
                    <div className="feedback-item-head">
                      <span className={`verdict ${f.verdict}`}>
                        {f.verdict === "wrong" ? "✗ Wrong" : "✓ Correct"}
                      </span>
                      <span className="tag">
                        {FEEDBACK_KINDS[f.kind] || f.kind}
                      </span>
                      <small>
                        {f.email} · {f.docName || "—"} · {dateTime(f.createdAt)}
                      </small>
                    </div>
                    <blockquote>{plain(f.item)}</blockquote>
                    {f.comment && (
                      <p>
                        <b>User says:</b> {f.comment}
                      </p>
                    )}
                    <div className="button-row">
                      <button
                        className="text-button"
                        onClick={() => toggleReviewed(f)}
                      >
                        <Check size={15} />{" "}
                        {f.reviewed ? "Mark not reviewed" : "Mark reviewed"}
                      </button>
                      {f.verdict === "wrong" && (
                        <button
                          className="secondary"
                          onClick={() => addRuleFrom(f)}
                        >
                          <Sparkles size={15} /> Add as AI guidance
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {!shownFeedback.length && <p className="fine">Nothing here.</p>}
              </ul>
            </>
          )}

          {section === "guidance" && (
            <>
              <h2>AI guidance</h2>
              <p className="fine">
                Rules added to every Gemini prompt for every user (notes,
                question banks, Ask Gemini, Interview Studio). This is how
                StudyMind learns from feedback on the free plan: no training,
                just instructions.
              </p>
              <ol className="guidance-list">
                {guidance.map((rule, i) => (
                  <li key={i}>
                    <span>{rule}</span>
                    <button
                      className="icon-button"
                      aria-label={`Remove rule ${i + 1}`}
                      onClick={() =>
                        storeGuidance(
                          guidance.filter((_, j) => j !== i),
                          "Rule removed.",
                        )
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
                {!guidance.length && <p className="fine">No rules yet.</p>}
              </ol>
              <form
                className="chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newRule.trim()) return;
                  storeGuidance([...guidance, newRule.trim()], "Rule added.");
                  setNewRule("");
                }}
              >
                <input
                  aria-label="New guidance rule"
                  placeholder='e.g. "8-mark answers must include a labelled diagram description"'
                  value={newRule}
                  maxLength={300}
                  onChange={(e) => setNewRule(e.target.value)}
                />
                <button
                  className="icon-dark"
                  aria-label="Add rule"
                  disabled={!newRule.trim()}
                >
                  <Check size={16} />
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
