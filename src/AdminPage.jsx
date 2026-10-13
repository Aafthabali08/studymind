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
  Ban,
  Clock,
  Unlock,
  ArrowRightLeft,
  UserCog,
  History,
  UserPlus,
  UserMinus,
} from "lucide-react";
import {
  ADMIN_EMAILS,
  FEEDBACK_KINDS,
  SUSPEND_FOR,
  TICKET_STATUSES,
  adminBans,
  adminSupporters,
  adminAudit,
  addSupporter,
  removeSupporter,
  banState,
  blockUser,
  isActiveNow,
  suspendUser,
  unbanUser,
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
import MaterialTransfer from "./MaterialTransfer";
import { AUDIT_ACTIONS } from "./university";
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
  ["transfer", "Transfer materials", ArrowRightLeft],
  ["supporters", "Supporters", UserCog],
  ["audit", "Audit log", History],
];
const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || "").toLowerCase());
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
    [newRule, setNewRule] = useState(""),
    [bans, setBans] = useState({}), // uid → ban
    [userFilter, setUserFilter] = useState("all"), // all | active | restricted
    [banForm, setBanForm] = useState({ duration: SUSPEND_FOR[1][1], reason: "" }),
    [banBusy, setBanBusy] = useState(false),
    [supporters, setSupporters] = useState({}), // uid → supporter
    [audit, setAudit] = useState([]),
    [auditFilter, setAuditFilter] = useState({ uid: "all", action: "all", q: "" }),
    [findSupporter, setFindSupporter] = useState(""),
    [supporterMatches, setSupporterMatches] = useState(null),
    [supporterDetail, setSupporterDetail] = useState(null), // uid
    [roleBusy, setRoleBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const searchTimer = useRef(null);
  const supporterTimer = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const [u, t, f, g, b, s, a] = await Promise.all([
        adminUsers(),
        adminTickets(),
        adminFeedback(),
        loadGuidance(),
        adminBans().catch(() => ({})),
        adminSupporters().catch(() => ({})),
        adminAudit().catch(() => []),
      ]);
      setBans(b);
      setSupporters(s);
      setAudit(a);
      setNow(Date.now());
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
  // "Active now" and suspension times stay current while the page is open.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
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
  // Find a registered user to make a supporter (email prefix), debounced.
  useEffect(() => {
    clearTimeout(supporterTimer.current);
    if (!findSupporter.trim()) return setSupporterMatches(null);
    supporterTimer.current = setTimeout(
      () =>
        adminUsers({ search: findSupporter })
          .then(setSupporterMatches)
          .catch(() => notify("User search failed.")),
      300,
    );
    return () => clearTimeout(supporterTimer.current);
  }, [findSupporter]);

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
      activeNow: users.filter((u) => isActiveNow(u, now)).length,
      restricted: Object.values(bans).filter((b) => banState(b, now)).length,
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
  }, [users, tickets, feedback, bans, now]);

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

  const statusOf = (u) => banState(bans[u.id], now);
  const userRows = (searchResults ?? users).filter((u) =>
    userFilter === "active"
      ? isActiveNow(u, now)
      : userFilter === "restricted"
        ? statusOf(u)
        : true,
  );
  const fmt = (d) =>
    new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(d);
  /** "Active now" · "Blocked" · "Suspended until …" */
  function UserStatus({ u }) {
    const ban = statusOf(u);
    if (ban)
      return (
        <span className={`user-status ${ban.kind}`}>
          {ban.kind === "blocked" ? "Blocked" : `Suspended until ${fmt(ban.until)}`}
        </span>
      );
    return isActiveNow(u, now) ? (
      <span className="user-status online">
        <i aria-hidden="true" /> Active now
      </span>
    ) : (
      <span className="user-status">Offline</span>
    );
  }
  async function restrict(u, kind) {
    const label = u.name || u.email;
    const ok = window.confirm(
      kind === "block"
        ? `Block ${label}? They won't be able to use StudyMind until you unblock them.`
        : `Suspend ${label} for ${SUSPEND_FOR.find(([, ms]) => ms === banForm.duration)?.[0]}?`,
    );
    if (!ok) return;
    setBanBusy(true);
    try {
      const ban =
        kind === "block"
          ? await blockUser(u, banForm.reason)
          : await suspendUser(u, banForm.duration, banForm.reason);
      setBans((b) => ({ ...b, [u.id]: ban }));
      setNow(Date.now());
      setBanForm((f) => ({ ...f, reason: "" }));
      notify(kind === "block" ? `${label} is blocked.` : `${label} is suspended until ${fmt(ban.until)}.`);
    } catch (e) {
      notify(e.message || "Could not change this user's access.");
    } finally {
      setBanBusy(false);
    }
  }
  async function lift(u) {
    setBanBusy(true);
    try {
      await unbanUser(u.id);
      setBans((b) => {
        const next = { ...b };
        delete next[u.id];
        return next;
      });
      notify(`${u.name || u.email} can use StudyMind again.`);
    } catch (e) {
      notify(e.message || "Could not lift the restriction.");
    } finally {
      setBanBusy(false);
    }
  }

  // ---- Supporters ------------------------------------------------------------------
  const userById = (id) => users.find((u) => u.id === id) || searchResults?.find((u) => u.id === id);
  /** A supporter as a user row: their profile when loaded, else what the role saved. */
  const supporterUser = (s) => ({ id: s.uid, email: s.email, name: s.name, ...(userById(s.uid) || {}) });
  const supporterRows = Object.values(supporters)
    .map(supporterUser)
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const changesBy = (uid) => audit.filter((a) => a.uid === uid);
  async function grant(u) {
    setRoleBusy(true);
    try {
      const s = await addSupporter(u);
      setSupporters((all) => ({ ...all, [u.id]: s }));
      notify(`${u.name || u.email} is now a supporter.`);
    } catch (e) {
      notify(e.message || "Could not add the supporter.");
    } finally {
      setRoleBusy(false);
    }
  }
  async function revoke(u) {
    const label = u.name || u.email;
    if (!window.confirm(`Remove ${label} as a supporter? They keep their account; their changes stay in the audit log.`))
      return;
    setRoleBusy(true);
    try {
      await removeSupporter(u);
      setSupporters((all) => {
        const next = { ...all };
        delete next[u.id];
        return next;
      });
      setSupporterDetail((id) => (id === u.id ? null : id));
      notify(`${label} is no longer a supporter.`);
    } catch (e) {
      notify(e.message || "Could not remove the supporter.");
    } finally {
      setRoleBusy(false);
    }
  }
  function showChanges(uid) {
    setAuditFilter({ uid, action: "all", q: "" });
    setSection("audit");
  }
  const auditRows = audit.filter((a) => {
    if (auditFilter.uid !== "all" && a.uid !== auditFilter.uid) return false;
    if (auditFilter.action !== "all" && a.action !== auditFilter.action) return false;
    const q = auditFilter.q.trim().toLowerCase();
    return (
      !q ||
      [a.summary, a.course, a.email, a.name, ...(a.items || []).map((i) => i.name)].some((t) =>
        String(t || "").toLowerCase().includes(q),
      )
    );
  });
  // Everyone in the log, including former supporters.
  const auditPeople = Object.values(
    Object.fromEntries([
      ...audit.map((a) => [a.uid, { uid: a.uid, label: a.name || a.email }]),
      ...Object.values(supporters).map((s) => [s.uid, { uid: s.uid, label: s.name || s.email }]),
    ]),
  ).sort((a, b) => a.label.localeCompare(b.label));

  /** Suspend / block / lift, for a user or a supporter. */
  const accessCard = (u) =>
    isAdminEmail(u.email) ? (
      <p className="fine">This is the admin account; it can't be blocked or suspended.</p>
    ) : (
      <div className="access-card" aria-label="Access">
        <strong>Access</strong>
        {statusOf(u) ? (
          <>
            <p className="fine">
              {statusOf(u).kind === "blocked"
                ? "Blocked until you unblock them."
                : `Suspended until ${fmt(statusOf(u).until)}; access returns by itself.`}
              {statusOf(u).reason && ` Reason: ${statusOf(u).reason}`}
            </p>
            <button className="secondary" disabled={banBusy} onClick={() => lift(u)}>
              <Unlock size={15} /> {statusOf(u).kind === "blocked" ? "Unblock" : "End suspension"}
            </button>
          </>
        ) : (
          <>
            <input
              aria-label="Reason (shown to the user)"
              placeholder="Reason (optional, shown to the user)"
              value={banForm.reason}
              maxLength={300}
              onChange={(e) => setBanForm((f) => ({ ...f, reason: e.target.value }))}
            />
            <div className="access-actions">
              <select
                aria-label="Suspend for"
                value={banForm.duration}
                onChange={(e) => setBanForm((f) => ({ ...f, duration: Number(e.target.value) }))}
              >
                {SUSPEND_FOR.map(([l, ms]) => (
                  <option key={ms} value={ms}>
                    {l}
                  </option>
                ))}
              </select>
              <button className="secondary" disabled={banBusy} onClick={() => restrict(u, "suspend")}>
                <Clock size={15} /> Suspend
              </button>
              <button className="secondary danger-button" disabled={banBusy} onClick={() => restrict(u, "block")}>
                <Ban size={15} /> Block
              </button>
            </div>
          </>
        )}
      </div>
    );
  /** Make / remove supporter, for a user. */
  const roleCard = (u) =>
    isAdminEmail(u.email) ? null : (
      <div className="access-card" aria-label="Supporter role">
        <strong>Supporter role</strong>
        {supporters[u.id] ? (
          <>
            <p className="fine">
              Supporter since {date(supporters[u.id].addedAt)} · {changesBy(u.id).length} changes recorded. They can add,
              upload, edit, transfer, copy and paste in the University library, but not delete.
            </p>
            <div className="access-actions">
              <button className="secondary" onClick={() => showChanges(u.id)}>
                <History size={15} /> View their changes
              </button>
              <button className="secondary danger-button" disabled={roleBusy} onClick={() => revoke(u)}>
                <UserMinus size={15} /> Remove supporter
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="fine">
              A supporter can add subjects, folders and files to the University library, upload, edit, transfer, copy and
              paste. They can't delete or open this dashboard.
            </p>
            <button className="secondary" disabled={roleBusy} onClick={() => grant(u)}>
              <UserPlus size={15} /> Make supporter
            </button>
          </>
        )}
      </div>
    );
  const auditList = (rows) => (
    <ol className="audit-list" aria-label="Changes">
      {rows.map((a) => (
        <li key={a.id}>
          <div className="audit-head">
            <span className={`audit-chip ${a.action}`}>{AUDIT_ACTIONS[a.action] || a.action}</span>
            <strong>{a.name || a.email}</strong>
            <time dateTime={a.at?.toISOString?.()}>{dateTime(a.at)}</time>
          </div>
          <p>{a.summary}</p>
          {a.course && <small>{a.course}</small>}
          {a.count > 1 && (
            <details>
              <summary>{a.count} items</summary>
              <ul>
                {(a.items || []).map((i) => (
                  <li key={i.id}>
                    {i.name || i.id} {i.kind && <small>({i.kind})</small>}
                  </li>
                ))}
                {a.count > (a.items || []).length && <li>…and {a.count - a.items.length} more</li>}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ol>
  );

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
                  <strong>{stats.activeNow}</strong>
                  <small>active now</small>
                </div>
                <div>
                  <strong>{stats.activeWeek}</strong>
                  <small>active this week</small>
                </div>
                <div>
                  <strong>{stats.restricted}</strong>
                  <small>blocked or suspended</small>
                </div>
                <div>
                  <strong>{Object.keys(supporters).length}</strong>
                  <small>supporters</small>
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
              {!userDetail && (
                <div className="segmented user-filter" role="group" aria-label="Show users">
                  {[
                    ["all", "All"],
                    ["active", `Active now · ${stats.activeNow}`],
                    ["restricted", `Blocked & suspended · ${stats.restricted}`],
                  ].map(([v, l]) => (
                    <button
                      key={v}
                      aria-pressed={userFilter === v}
                      className={userFilter === v ? "active" : ""}
                      onClick={() => setUserFilter(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              {userDetail ? (
                <div className="user-detail">
                  <button
                    className="text-button"
                    onClick={() => setUserDetail(null)}
                  >
                    ← All users
                  </button>
                  <h3>{userDetail.name || userDetail.email}</h3>
                  <p className="fine">
                    {userDetail.email} · <UserStatus u={userDetail} />
                    {supporters[userDetail.id] && <span className="role-badge">Supporter</span>}
                  </p>
                  {accessCard(userDetail)}
                  {roleCard(userDetail)}
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
                              {t.appeal && <span className="role-badge appeal">Appeal</span>}
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
                        <th>Status</th>
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
                              <strong>
                                {u.name || "—"}
                                {supporters[u.id] && <span className="role-badge">Supporter</span>}
                              </strong>
                              <small>{u.email}</small>
                            </button>
                          </td>
                          <td>
                            <UserStatus u={u} />
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
                  {ticket.appeal && (
                    <div className="appeal-note">
                      <p>
                        Sent with <strong>Contact admin</strong> from the {ticket.banKind || "locked"} account screen. They
                        can't read replies until their access is back.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setUserDetail(userById(ticket.uid) || { id: ticket.uid, email: ticket.email, name: ticket.name });
                          setSection("users");
                        }}
                      >
                        <Unlock size={15} /> Manage their access
                      </button>
                    </div>
                  )}
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
                              {t.appeal && <span className="role-badge appeal">Appeal</span>}
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

          {section === "transfer" && (
            <>
              <h2>Transfer materials</h2>
              <p className="fine">
                Move (cut and paste) or copy university subjects, units, folders and files to another university,
                degree or year, into any subject or folder there.
              </p>
              <MaterialTransfer notify={notify} />
            </>
          )}

          {section === "supporters" && (
            <>
              <h2>Supporters</h2>
              <p className="fine">
                Supporters manage the University library with you: they add subjects, folders and files, upload, rename,
                change exam tags and icons, transfer, copy and paste. They can't delete, edit the course options or open
                this dashboard. Everything they change is recorded in the Audit log.
              </p>
              {supporterDetail && supporters[supporterDetail] ? (
                (() => {
                  const u = supporterUser(supporters[supporterDetail]);
                  const recent = changesBy(u.id).slice(0, 10);
                  return (
                    <div className="user-detail">
                      <button className="text-button" onClick={() => setSupporterDetail(null)}>
                        ← All supporters
                      </button>
                      <h3>{u.name || u.email}</h3>
                      <p className="fine">
                        {u.email} · <UserStatus u={u} /> · last active {dateTime(u.lastActive)}
                      </p>
                      {accessCard(u)}
                      {roleCard(u)}
                      <h3>Recent changes</h3>
                      {recent.length ? auditList(recent) : <p className="fine">No changes yet.</p>}
                    </div>
                  );
                })()
              ) : (
                <>
                  <div className="supporter-add" aria-label="Add a supporter">
                    <h3>Add a supporter</h3>
                    <label className="search admin-search">
                      <Search size={17} />
                      <input
                        aria-label="Find a registered user by email"
                        placeholder="Find a registered user by email"
                        value={findSupporter}
                        onChange={(e) => setFindSupporter(e.target.value)}
                      />
                    </label>
                    {supporterMatches && (
                      <ul className="supporter-matches">
                        {supporterMatches.map((u) => (
                          <li key={u.id}>
                            <span>
                              <strong>{u.name || "—"}</strong>
                              <small>{u.email}</small>
                            </span>
                            {isAdminEmail(u.email) ? (
                              <small>Admin</small>
                            ) : supporters[u.id] ? (
                              <small>Already a supporter</small>
                            ) : (
                              <button
                                className="secondary"
                                disabled={roleBusy}
                                aria-label={`Make ${u.email} a supporter`}
                                onClick={() => grant(u)}
                              >
                                <UserPlus size={15} /> Make supporter
                              </button>
                            )}
                          </li>
                        ))}
                        {!supporterMatches.length && (
                          <li className="fine">No registered user with that email. They need to sign in to StudyMind once first.</li>
                        )}
                      </ul>
                    )}
                  </div>
                  <h3>Current supporters · {supporterRows.length}</h3>
                  {supporterRows.length ? (
                    <div className="md-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Supporter</th>
                            <th>Status</th>
                            <th>Changes</th>
                            <th>Added</th>
                            <th>Last active</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supporterRows.map((u) => (
                            <tr key={u.id} className="user-row" onClick={() => setSupporterDetail(u.id)}>
                              <td>
                                <button className="user-cell" aria-label={`Manage supporter ${u.email}`}>
                                  <strong>{u.name || "—"}</strong>
                                  <small>{u.email}</small>
                                </button>
                              </td>
                              <td>
                                <UserStatus u={u} />
                              </td>
                              <td>{changesBy(u.id).length}</td>
                              <td>{date(supporters[u.id]?.addedAt)}</td>
                              <td>{date(u.lastActive)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="fine">No supporters yet. Find a registered user above to add one.</p>
                  )}
                </>
              )}
            </>
          )}

          {section === "audit" && (
            <>
              <h2>Audit log</h2>
              <p className="fine">
                Every change supporters make to the University library, newest first. Each entry is saved together with the
                change itself, so it can't be skipped or edited.
              </p>
              <div className="audit-filters">
                <label>
                  Supporter
                  <select
                    value={auditFilter.uid}
                    onChange={(e) => setAuditFilter((f) => ({ ...f, uid: e.target.value }))}
                  >
                    <option value="all">Everyone</option>
                    {auditPeople.map((p) => (
                      <option key={p.uid} value={p.uid}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Change
                  <select
                    value={auditFilter.action}
                    onChange={(e) => setAuditFilter((f) => ({ ...f, action: e.target.value }))}
                  >
                    <option value="all">All changes</option>
                    {Object.entries(AUDIT_ACTIONS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="search admin-search">
                  <Search size={17} />
                  <input
                    aria-label="Search the audit log"
                    placeholder="Search files, folders, courses…"
                    value={auditFilter.q}
                    onChange={(e) => setAuditFilter((f) => ({ ...f, q: e.target.value }))}
                  />
                </label>
              </div>
              <p className="fine" role="status">
                {auditRows.length} of {audit.length} changes
              </p>
              {auditRows.length ? auditList(auditRows) : <p className="fine">No changes recorded{audit.length ? " match these filters" : " yet"}.</p>}
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
