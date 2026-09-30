import React, { useState, useEffect, useRef, lazy, Suspense } from "react";
import {
  BookOpen,
  ArrowUpRight,
  Plus,
  Search,
  Upload,
  FileText,
  ArrowRight,
  Sparkles,
  Headphones,
  Layers,
  CalendarDays,
  Mic,
  LayoutGrid,
  GraduationCap,
  X,
  Sun,
  Moon,
  LogOut,
  Settings2,
  Trash2,
  Bell,
  LifeBuoy,
  ShieldCheck,
  DownloadCloud,
  UserX,
  Pencil,
  Lock,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { initialTheme, saveTheme, validateFile } from "./logic";
import { downloadText, readDocument, warmUpReader } from "./documents";
import Particles from "./Particles";
import Thinking from "./Thinking";
import { setLearning } from "./ai/memory";
import {
  changeDocCount,
  deleteMyAccount,
  ensureProfile,
  exportMyData,
  signedInRecently,
  isAdminUser,
  loadGuidance,
  loadLearning,
  markNotificationsRead,
  myNotifications,
  setDocCount,
} from "./support";
import Landing from "./Landing";
import EditableName from "./EditableName";
import { useAuth } from "./auth";
import { updateSettings, useAI } from "./ai/engine";
import {
  deleteDocument,
  loadImages,
  loadLibrary,
  loadPrefs,
  newDocumentId,
  renameDocument,
  saveDocument,
  saveImages,
  savePrefs,
  saveStudy,
} from "./cloud";

// Pages load on demand (smaller first load) and are preloaded in idle time
// after sign-in, so switching pages never waits.
const pages = {
  DocumentWorkspace: () => import("./DocumentWorkspace"),
  InterviewStudio: () => import("./InterviewStudio"),
  StudyPlan: () => import("./StudyPlan"),
  Support: () => import("./SupportPage"),
  AdminPage: () => import("./AdminPage"),
  AuthPanel: () => import("./AuthPanel"),
  AISettings: () => import("./AISettings"),
  HelpBot: () => import("./HelpBot"),
};
const DocumentWorkspace = lazy(pages.DocumentWorkspace);
const InterviewStudio = lazy(pages.InterviewStudio);
const StudyPlan = lazy(pages.StudyPlan);
const Support = lazy(pages.Support);
const AdminPage = lazy(pages.AdminPage);
const AuthPanel = lazy(pages.AuthPanel);
const AISettings = lazy(pages.AISettings);
const HelpBot = lazy(pages.HelpBot);
function preloadPages() {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 600));
  idle(() => {
    Object.values(pages).forEach((load) => load().catch(() => {}));
    warmUpReader(); // the first upload then starts instantly
  });
}
const PageLoading = () => (
  <div className="page-loading" role="status" aria-label="Loading">
    <span className="thinking-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  </div>
);

const NAV = [
  [LayoutGrid, "Overview", "Workspace"],
  [BookOpen, "Library", "My library"],
  [CalendarDays, "Study plan", "Study plan"],
  [Mic, "Interview", "Interview studio"],
];

export default function App() {
  const auth = useAuth();
  const user = auth.user;
  const ai = useAI();
  const [view, setView] = useState("Overview"),
    [docs, setDocs] = useState([]),
    [loadingLibrary, setLoadingLibrary] = useState(false),
    [selected, setSelected] = useState(null),
    [initialTab, setInitialTab] = useState("Ask document"),
    [modal, setModal] = useState(null), // "upload" | "ai"
    [popover, setPopover] = useState(null), // "signin" | "signup" | "account"
    [query, setQuery] = useState(""),
    [notice, setNotice] = useState(""),
    [queue, setQueue] = useState([]),
    [theme, setTheme] = useState(initialTheme),
    [study, setStudy] = useState({}),
    [botPage, setBotPage] = useState(0),
    [notifications, setNotifications] = useState([]),
    [openTicketId, setOpenTicketId] = useState(null),
    [deleting, setDeleting] = useState({ typed: "", step: "", error: "" }),
    [docToDelete, setDocToDelete] = useState(null);
  const admin = isAdminUser(user);
  const unread = notifications.filter((n) => !n.read).length;
  const fileRef = useRef(null),
    uploadLock = useRef(false),
    pending = useRef([]),
    urls = useRef([]),
    dialogRef = useRef(null),
    popoverRef = useRef(null),
    noteTimers = useRef({});
  const uploading = queue.some((q) =>
    ["waiting", "reading", "saving"].includes(q.status),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      saveTheme(window.localStorage, theme);
    } catch {}
  }, [theme]);
  useEffect(
    () => () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      window.speechSynthesis?.cancel();
    },
    [],
  );

  // Signed in: load the library and preferences. Signed out: clear everything.
  useEffect(() => {
    setDocs([]);
    setStudy({});
    setSelected(null);
    setView("Overview");
    if (!user) return;
    setPopover(null);
    let live = true;
    setLoadingLibrary(true);
    loadLibrary(user.uid)
      .then((cloudDocs) => {
        if (!live) return;
        setDocs(cloudDocs.map((d) => ({ ...d, cloudId: d.id })));
        // Keep the profile's document count exact (shown on the admin page).
        setDocCount(user.uid, cloudDocs.length).catch(() => {});
        setStudy(
          Object.fromEntries(cloudDocs.map((d) => [d.id, d.study || {}])),
        );
      })
      .catch(
        () =>
          live &&
          setNotice("Could not load your library. Check your connection."),
      )
      .finally(() => live && setLoadingLibrary(false));
    ensureProfile(user).catch(() => {});
    preloadPages();
    // What Gemini learns from: this user's feedback + the admin's guidance.
    Promise.all([
      loadLearning(user.uid).catch(() => ({})),
      loadGuidance().catch(() => []),
    ]).then(
      ([learning, guidance]) =>
        live &&
        setLearning({
          avoid: learning.avoid || [],
          good: learning.good || [],
          guidance,
        }),
    );
    refreshNotifications();
    loadPrefs(user.uid)
      .then((prefs) => {
        if (!live || !prefs) return;
        if (prefs.theme === "dark" || prefs.theme === "light")
          setTheme(prefs.theme);
        if (prefs.engine) updateSettings({ engine: prefs.engine });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [user?.uid]);
  // Admin replies arrive as notifications; check every 2 minutes and on focus.
  function refreshNotifications() {
    if (!user) return;
    myNotifications(user.uid)
      .then(setNotifications)
      .catch(() => {});
  }
  useEffect(() => {
    if (!user) return setNotifications([]);
    const id = setInterval(refreshNotifications, 120000);
    window.addEventListener("focus", refreshNotifications);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", refreshNotifications);
    };
  }, [user?.uid]);
  // Opening a notification shows the whole ticket, so every unread
  // notification about that ticket counts as read.
  function openNotification(n) {
    setPopover(null);
    const ids = notifications
      .filter(
        (x) => !x.read && (x.id === n.id || (n.ticketId && x.ticketId === n.ticketId)),
      )
      .map((x) => x.id);
    if (ids.length) {
      setNotifications((all) =>
        all.map((x) => (ids.includes(x.id) ? { ...x, read: true } : x)),
      );
      markNotificationsRead(user.uid, ids).catch(() => {});
    }
    if (n.ticketId) setOpenTicketId(n.ticketId);
    navigate("Support");
  }
  function readAllNotifications() {
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (!ids.length) return;
    setNotifications((all) => all.map((n) => ({ ...n, read: true })));
    markNotificationsRead(user.uid, ids).catch(() => {});
  }
  // Keep theme and AI engine in the account so every device matches.
  // The state at sign-in is only a baseline (the account's own prefs load
  // next); every later change is saved, including the first one.
  const savedPrefs = useRef(null);
  useEffect(() => {
    if (!user) return void (savedPrefs.current = null);
    const prefs = {
      theme,
      ...(ai.settings.chosen ? { engine: ai.settings.engine } : {}),
    };
    const key = JSON.stringify(prefs);
    if (savedPrefs.current === null) return void (savedPrefs.current = key);
    if (key === savedPrefs.current) return;
    savedPrefs.current = key;
    savePrefs(user.uid, prefs).catch(() => {});
  }, [user?.uid, theme, ai.settings.engine, ai.settings.chosen]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(id);
  }, [notice]);

  // Modal dialogs (upload, AI settings): focus trap and Escape.
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    const controls = () =>
      Array.from(
        dialog.querySelectorAll("button,input,select,textarea,a[href]"),
      ).filter((el) => !el.disabled);
    controls()[0]?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function key(e) {
      if (e.key === "Escape" && !uploadLock.current) setModal(null);
      if (e.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (!items.length) {
          e.preventDefault();
          dialog.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal]);

  // Floating top-right card (log in / sign up / account): Escape and outside click close it.
  useEffect(() => {
    if (!popover) return;
    const previous = document.activeElement;
    popoverRef.current?.querySelector("button,input")?.focus();
    const key = (e) => e.key === "Escape" && setPopover(null);
    const click = (e) =>
      !popoverRef.current?.contains(e.target) &&
      !e.target.closest?.("[data-popover-trigger]") &&
      setPopover(null);
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
      if (previous?.isConnected) previous.focus();
    };
  }, [popover]);

  function requireLogin(mode = "signin") {
    setPopover(mode);
    setNotice(
      mode === "signup"
        ? "Create a free account to start."
        : "Log in or sign up to continue.",
    );
  }
  function navigate(v) {
    if (!user) return requireLogin();
    window.scrollTo({ top: 0, behavior: "instant" });
    window.speechSynthesis?.cancel();
    setView(v);
    setSelected(null);
  }
  function patchDoc(id, patch) {
    setDocs((d) =>
      d.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
    );
    setSelected((s) => (s?.id === id ? { ...s, ...patch } : s));
  }
  function openDoc(doc, tab = "Ask document") {
    if (!user) return requireLogin();
    if (!doc) {
      warmUpReader();
      return setModal("upload");
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    window.speechSynthesis?.cancel();
    setSelected(doc);
    setInitialTab(tab);
    setView("Library");
    setBotPage(0);
    // Figures live in their own collection; fetch them on first open.
    if (doc.cloudId && !doc.images)
      loadImages(user.uid, doc.cloudId)
        .then((images) => patchDoc(doc.id, { images }))
        .catch(() => patchDoc(doc.id, { images: [] }));
  }
  function openUpload() {
    if (!user) return requireLogin();
    warmUpReader();
    setModal("upload");
  }

  // ---- Uploads: any number of files, processed one after another --------------
  const setItem = (id, patch) =>
    setQueue((q) =>
      q.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );

  function upload(fileList) {
    if (!user) return requireLogin();
    const files = Array.from(fileList || []);
    if (fileRef.current) fileRef.current.value = "";
    if (!files.length) return;
    const items = files.map((file) => {
      let error = "";
      try {
        validateFile(file);
      } catch (e) {
        error = e.message;
      }
      return {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        status: error ? "error" : "waiting",
        message: error,
      };
    });
    if (items.length === 1 && items[0].status === "error") {
      setNotice(items[0].message);
      return;
    }
    setQueue((q) => [
      ...q.filter((i) => ["waiting", "reading", "saving"].includes(i.status)),
      ...items,
    ]);
    pending.current.push(...items.filter((i) => i.status === "waiting"));
    processQueue(items.length);
  }

  async function processQueue(batchSize) {
    if (uploadLock.current) return;
    uploadLock.current = true;
    let ready = 0;
    // Two files at a time: one can be read while the other is being saved
    // or OCR'd, so a batch finishes much sooner.
    const runner = async () => {
      while (pending.current.length) {
        const item = pending.current.shift();
        const { file } = item;
        try {
          setItem(item.id, { status: "reading", message: "Reading pages…" });
          // The id is created on this device, so nothing below waits for the network.
          const id = await newDocumentId(user.uid).catch(() =>
            crypto.randomUUID(),
          );
          let doc = null,
            saved = null;
          const showDocument = (pages) => {
            if (doc) return;
            let url = null;
            if (/\.pdf$/i.test(file.name)) {
              url = URL.createObjectURL(file);
              urls.current.push(url);
            }
            doc = {
              id,
              cloudId: id,
              cloud: true,
              name: file.name.replace(/\.(pdf|txt)$/i, ""),
              file: file.name,
              pages,
              images: [],
              category: "Your document",
              kind: "Uploaded document",
              url,
            };
            setDocs((d) => [doc, ...d]);
            ready++;
            setItem(item.id, {
              status: "done",
              docId: id,
              message: `${pages.length} page${pages.length === 1 ? "" : "s"} · notes and 2/5/8-mark questions ready · looking for figures…`,
            });
            // Save in the background; the document is usable right away.
            saved = saveDocument(user.uid, doc, file, { id }).then(
              () => {
                changeDocCount(user.uid, 1).catch(() => {});
                return true;
              },
              () => {
                setNotice(
                  `"${doc.name}" could not be saved to your account. It stays open until you refresh.`,
                );
                return false;
              },
            );
            if (batchSize === 1) {
              setModal(null);
              setQueue([]);
              openDoc(doc);
            }
          };
          const read = await readDocument(file, {
            images: true,
            onText: showDocument,
            // Scanned PDFs: show OCR progress page by page.
            onProgress: ({ stage, done, total }) =>
              setItem(item.id, {
                message:
                  stage === "ocr"
                    ? `Scanned PDF: reading page ${Math.min(done + 1, total)} of ${total} with OCR…`
                    : `Reading page ${done} of ${total}…`,
              }),
          });
          const pages = Array.isArray(read) ? read : read.pages;
          const images = (!Array.isArray(read) && read.images) || [];
          showDocument(pages); // when the reader did not report text early (TXT)
          patchDoc(id, { images });
          setItem(item.id, {
            message: `${pages.length} page${pages.length === 1 ? "" : "s"}${
              images.length
                ? ` · ${images.length} figure${images.length === 1 ? "" : "s"}`
                : ""
            } · notes and 2/5/8-mark questions ready`,
          });
          if (images.length)
            saved
              .then((ok) => ok && saveImages(user.uid, id, images))
              .catch(() =>
                setNotice("Some figures could not be saved to your account."),
              );
        } catch (e) {
          setItem(item.id, {
            status: "error",
            message: e.message || "Could not read this file.",
          });
        }
      }
    };
    try {
      await Promise.all([runner(), runner()]);
    } finally {
      uploadLock.current = false;
    }
    if (batchSize === 1 && ready === 1)
      setNotice(
        "Your document is ready. Figures appear as soon as they are found.",
      );
    else if (ready > 1)
      setNotice(`${ready} documents are ready in your library.`);
  }
  function dropFiles(e) {
    e.preventDefault();
    upload(e.dataTransfer.files);
  }

  // Notes and question banks: saved per document, synced after a short pause.
  function updateStudy(doc, patch) {
    setStudy((all) => {
      const next = { ...all, [doc.id]: { ...all[doc.id], ...patch } };
      if (user && doc.cloudId) {
        clearTimeout(noteTimers.current[doc.id]);
        noteTimers.current[doc.id] = setTimeout(
          () =>
            saveStudy(user.uid, doc.cloudId, next[doc.id]).catch(() =>
              setNotice(
                "Notes could not be synced. They are kept in this session.",
              ),
            ),
          1200,
        );
      }
      return next;
    });
  }
  function renameDoc(doc, name) {
    const previous = doc.name;
    patchDoc(doc.id, { name });
    if (doc.cloudId)
      renameDocument(user.uid, doc.cloudId, name)
        .then(() => setNotice(`Renamed to "${name}".`))
        .catch(() => {
          patchDoc(doc.id, { name: previous });
          setNotice("Could not rename it in your account. Try again.");
        });
    else setNotice(`Renamed to "${name}".`);
  }
  // Asks first in an in-app dialog (native confirm() is blocked in some
  // embedded browsers and doesn't match the site).
  function removeDoc(doc) {
    setDocToDelete(doc);
    setModal("delete-doc");
  }
  function confirmRemoveDoc() {
    const doc = docToDelete;
    setModal(null);
    setDocToDelete(null);
    if (!doc) return;
    setDocs((d) => d.filter((x) => x.id !== doc.id));
    setSelected((s) => (s?.id === doc.id ? null : s));
    if (doc.cloudId)
      deleteDocument(user.uid, { ...doc, id: doc.cloudId })
        .then(() => {
          changeDocCount(user.uid, -1).catch(() => {});
          setNotice(`"${doc.name}" was deleted from your account.`);
        })
        .catch(() =>
          setNotice("Could not delete it from your account. Try again later."),
        );
    else setNotice(`"${doc.name}" was deleted.`);
  }
  async function downloadMyData() {
    setPopover(null);
    setNotice("Preparing your data…");
    try {
      const data = await exportMyData(user);
      downloadText(JSON.stringify(data, null, 2), "studymind-my-data.json");
      setNotice("Your data was downloaded as studymind-my-data.json.");
    } catch {
      setNotice(
        "Could not export your data. Check your connection and try again.",
      );
    }
  }
  async function confirmDeleteAccount() {
    if (!(await signedInRecently().catch(() => false)))
      return setDeleting((d) => ({
        ...d,
        error:
          "For your security, log out and log in again, then delete your account within 5 minutes.",
      }));
    uploadLock.current = true; // keep the dialog open while deleting
    try {
      await deleteMyAccount(user, (step) =>
        setDeleting((d) => ({ ...d, step })),
      );
      uploadLock.current = false;
      setModal(null);
      setNotice("Your account and all of your data were permanently deleted.");
    } catch (e) {
      uploadLock.current = false;
      setDeleting((d) => ({
        ...d,
        step: "",
        error:
          e?.code === "auth/requires-recent-login"
            ? "Your data was deleted, but removing the sign-in needs a fresh login. Log in again and repeat."
            : "Something went wrong while deleting. Nothing else was removed; try again.",
      }));
    }
  }
  async function logOut() {
    try {
      await auth.signOut();
      setPopover(null);
      setNotice("You're logged out. See you soon.");
    } catch {
      setNotice("Could not log out. Try again.");
    }
  }

  const q = query.trim().toLocaleLowerCase();
  const filtered = docs.filter((d) =>
    (d.name + " " + d.file).toLocaleLowerCase().includes(q),
  );
  const initial = (user?.displayName || user?.email || "?")
    .charAt(0)
    .toUpperCase();

  if (auth.enabled && !auth.ready)
    return (
      <div className="splash" role="status">
        <span className="brandmark">
          <BookOpen size={21} />
        </span>
        Opening StudyMind…
      </div>
    );

  return (
    <>
      <Particles theme={theme} />
      <div inert={modal ? true : undefined}>
        <header className="topbar">
          <button
            className="brand"
            onClick={() =>
              user ? navigate("Overview") : window.scrollTo({ top: 0 })
            }
          >
            <span className="brandmark">
              <BookOpen size={21} />
            </span>
            studymind<span className="ai-label">AI</span>
          </button>
          <nav className="topnav">
            {NAV.filter(([, v]) => v !== "Study plan").map(([, v, label]) => (
              <button
                key={v}
                aria-current={
                  user && view === v && !selected ? "page" : undefined
                }
                className={user && view === v ? "current" : ""}
                onClick={() => navigate(v)}
              >
                {label}
                {!user && (
                  <Lock size={12} className="nav-lock" aria-label="Locked" />
                )}
                {user && v === "Interview" && <span className="tiny">NEW</span>}
              </button>
            ))}
          </nav>
          <div className="header-actions">
            {user && (
              <button
                className="theme-toggle bell"
                data-popover-trigger
                aria-label={
                  unread ? `Notifications, ${unread} unread` : "Notifications"
                }
                aria-expanded={popover === "notifications"}
                onClick={() => {
                  setPopover((p) =>
                    p === "notifications" ? null : "notifications",
                  );
                  refreshNotifications();
                }}
              >
                <Bell size={18} />
                {unread > 0 && <span className="bell-count">{unread}</span>}
              </button>
            )}
            <button
              className="theme-toggle"
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to black theme"
              }
              title={theme === "dark" ? "Light theme" : "Black theme"}
              onClick={() =>
                setTheme((t) => (t === "light" ? "dark" : "light"))
              }
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            {user ? (
              <button
                className="profile"
                data-popover-trigger
                aria-label="Your account"
                aria-expanded={popover === "account"}
                onClick={() =>
                  setPopover((p) => (p === "account" ? null : "account"))
                }
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  initial
                )}
              </button>
            ) : (
              <>
                <button
                  className="signin-button"
                  data-popover-trigger
                  aria-expanded={popover === "signin"}
                  onClick={() =>
                    setPopover((p) => (p === "signin" ? null : "signin"))
                  }
                >
                  Log in
                </button>
                <button
                  className="primary signup-button"
                  data-popover-trigger
                  aria-expanded={popover === "signup"}
                  onClick={() =>
                    setPopover((p) => (p === "signup" ? null : "signup"))
                  }
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </header>

        {popover && (
          <section
            ref={popoverRef}
            className="popover panel"
            role="dialog"
            aria-label={
              popover === "notifications"
                ? "Notifications"
                : popover === "account"
                  ? "Your account"
                  : popover === "signup"
                    ? "Sign up"
                    : "Log in"
            }
          >
            <button
              className="close"
              aria-label="Close"
              onClick={() => setPopover(null)}
            >
              <X size={18} />
            </button>
            {popover === "notifications" && user ? (
              <div className="notifications">
                <div className="notifications-head">
                  <h2>Notifications</h2>
                  {unread > 0 && (
                    <button
                      className="text-button"
                      onClick={readAllNotifications}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {notifications.length ? (
                  <ul>
                    {notifications.map((n) => (
                      <li key={n.id}>
                        <button
                          className={"notification" + (n.read ? "" : " unread")}
                          onClick={() => openNotification(n)}
                        >
                          <strong>{n.title}</strong>
                          <small>{n.body}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="fine">
                    No notifications yet. Replies to your support tickets appear
                    here.
                  </p>
                )}
                <button
                  className="text-button"
                  onClick={() => {
                    setPopover(null);
                    navigate("Support");
                  }}
                >
                  <LifeBuoy size={15} /> Help & support
                </button>
              </div>
            ) : popover === "account" && user ? (
              <div className="account-menu">
                <div className="account-head">
                  <span className="profile big">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      initial
                    )}
                  </span>
                  <div>
                    <strong>{user.displayName || "Your account"}</strong>
                    <small>{user.email}</small>
                  </div>
                </div>
                {!user.emailVerified && user.email && (
                  <p className="fine">
                    Verify your email using the link we sent you.
                  </p>
                )}
                <button
                  className="menu-item"
                  onClick={() => {
                    setPopover(null);
                    setModal("ai");
                  }}
                >
                  <Settings2 size={17} /> AI settings
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setPopover(null);
                    navigate("Support");
                  }}
                >
                  <LifeBuoy size={17} /> Help & support
                </button>
                {admin && (
                  <button
                    className="menu-item"
                    onClick={() => {
                      setPopover(null);
                      navigate("Admin");
                    }}
                  >
                    <ShieldCheck size={17} /> Admin dashboard
                  </button>
                )}
                <button
                  className="menu-item"
                  onClick={() => {
                    setPopover(null);
                    if (selected || view !== "Overview") navigate("Overview");
                  }}
                >
                  <ArrowRight size={17} /> Back to studying
                </button>
                <button className="menu-item" onClick={downloadMyData}>
                  <DownloadCloud size={17} /> Download my data
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setPopover(null);
                    setDeleting({ typed: "", step: "", error: "" });
                    setModal("delete-account");
                  }}
                >
                  <UserX size={17} /> Delete my account
                </button>
                <button className="menu-item danger" onClick={logOut}>
                  <LogOut size={17} /> Log out
                </button>
              </div>
            ) : !auth.enabled ? (
              <div>
                <h2>Sign-in isn't set up yet.</h2>
                <p>
                  Add your Firebase web app keys to .env.local and restart the
                  app.
                </p>
              </div>
            ) : (
              <Suspense fallback={<PageLoading />}>
                <AuthPanel
                  key={popover}
                  initialMode={popover === "signup" ? "signup" : "signin"}
                  notify={setNotice}
                  onDone={() => setPopover(null)}
                />
              </Suspense>
            )}
          </section>
        )}

        <main id="main-content">
          {!user && (
            <Landing
              onAuth={(mode) => setPopover(mode)}
              setupMissing={!auth.enabled}
            />
          )}

          {user && !selected && view === "Overview" && (
            <>
              <section className="welcome">
                <div>
                  <div className="eyebrow">
                    <span className="short-line" /> YOUR PERSONAL LEARNING SPACE
                  </div>
                  <h1>
                    {user.displayName
                      ? `Hi, ${user.displayName.split(" ")[0]}.`
                      : "A little curiosity."}{" "}
                    <br />
                    <span>A lot of possibility.</span>
                  </h1>
                  <p>Turn your documents into your next breakthrough.</p>
                </div>
                <div className="welcome-aside">
                  <div className="date">
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })
                      .format(new Date())
                      .toUpperCase()}
                  </div>
                  <div className="session">
                    <span className="spark-box">
                      <Sparkles size={22} />
                    </span>
                    <div>
                      Your mind, in motion.
                      <br />
                      <small>Make room for something new.</small>
                    </div>
                  </div>
                </div>
              </section>
              <section className="start-grid">
                <div
                  className="upload-card"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={dropFiles}
                >
                  <div className="section-kicker">
                    <span>01 / BRING YOUR CURIOSITY</span>
                    <ArrowUpRight size={18} />
                  </div>
                  <div className="upload-inner">
                    <div className="file-stack">
                      <FileText size={32} />
                      <span className="mini-plus">+</span>
                    </div>
                    <h2>Your next chapter starts here.</h2>
                    <p>Drop one PDF or many. Unpack every idea.</p>
                    <button className="primary" onClick={openUpload}>
                      <Plus size={17} /> Upload documents
                    </button>
                    <span className="fine">
                      PDF or TXT · Many at once · Up to 25 MB each
                    </span>
                  </div>
                </div>
                <div className="dark-card">
                  <div className="section-kicker">
                    <span>02 / FIND YOUR CONFIDENCE</span>
                    <Mic size={18} />
                  </div>
                  <div className="wave" aria-hidden="true">
                    {Array.from({ length: 39 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          height:
                            10 +
                            Math.abs(Math.sin(i * 0.73)) * 45 +
                            Math.sin(i * 0.2) * 15 +
                            "px",
                          animationDelay: i * 0.07 + "s",
                        }}
                      />
                    ))}
                  </div>
                  <div>
                    <span className="outline-tag">INTERVIEW STUDIO</span>
                    <h2>
                      Big opportunity? <br />
                      Be ready for it.
                    </h2>
                    <p>
                      A space to practice your answers
                      <br />
                      and find your voice.
                    </p>
                    <button
                      className="light-button"
                      onClick={() => navigate("Interview")}
                    >
                      Let's practice <ArrowUpRight size={16} />
                    </button>
                  </div>
                </div>
              </section>
              <section className="library-section">
                <div className="section-heading">
                  <h2>
                    Pick up where you left off{" "}
                    <span className="count">
                      {docs.length.toString().padStart(2, "0")}
                    </span>
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("Library")}
                  >
                    View library <ArrowRight size={16} />
                  </button>
                </div>
                {loadingLibrary ? (
                  <div className="empty">Loading your library…</div>
                ) : docs.length ? (
                  <div className="doc-grid">
                    {docs.slice(0, 3).map((d, i) => (
                      <DocCard
                        key={d.id}
                        d={d}
                        i={i}
                        open={openDoc}
                        remove={removeDoc}
                        rename={renameDoc}
                      />
                    ))}
                  </div>
                ) : (
                  <button className="empty empty-upload" onClick={openUpload}>
                    <Upload size={22} />
                    Your library is empty. Upload your first PDFs to get notes,
                    questions and a plan.
                  </button>
                )}
              </section>
              <section className="tools-row">
                <span>MAKE IT STICK</span>
                {[
                  [Layers, "Flashcards"],
                  [GraduationCap, "Questions"],
                  [CalendarDays, "Study plan"],
                  [Headphones, "Read aloud"],
                ].map(([Icon, title]) => (
                  <button
                    key={title}
                    onClick={() =>
                      title === "Study plan"
                        ? navigate("Study plan")
                        : openDoc(docs[0], title)
                    }
                  >
                    <Icon size={18} />
                    {title}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </section>
            </>
          )}

          {user && !selected && view === "Library" && (
            <>
              <PageTitle
                kicker="YOUR KNOWLEDGE, COLLECTED"
                title="The library."
                subtitle="Every document is a new place to begin."
              />
              <div className="library-controls">
                <label className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search your documents"
                    placeholder="Search your documents"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button className="primary" onClick={openUpload}>
                  <Plus size={17} />
                  Upload documents
                </button>
              </div>
              <div
                className="doc-grid"
                onDragOver={(e) => e.preventDefault()}
                onDrop={dropFiles}
              >
                {filtered.map((d, i) => (
                  <DocCard
                    key={d.id}
                    d={d}
                    i={i}
                    open={openDoc}
                    remove={removeDoc}
                    rename={renameDoc}
                  />
                ))}
              </div>
              {!filtered.length && (
                <div className="empty">
                  {loadingLibrary
                    ? "Loading your library…"
                    : docs.length
                      ? "No documents match your search."
                      : "No documents here yet. Upload one or many PDFs to begin."}
                </div>
              )}
              <p className="fine">
                Your documents, notes, figures and questions are saved privately
                to your account.
              </p>
            </>
          )}

          {user && selected && (
            <Suspense fallback={<PageLoading />}>
              <DocumentWorkspace
                key={selected.id}
                doc={selected}
                initialTab={initialTab}
                study={study[selected.id] || {}}
                onStudy={(patch) => updateStudy(selected, patch)}
                onDelete={removeDoc}
                onRename={renameDoc}
                onOpenSettings={() => setModal("ai")}
                onPageChange={setBotPage}
                onBack={() => {
                  window.speechSynthesis?.cancel();
                  setSelected(null);
                }}
                notify={setNotice}
              />
            </Suspense>
          )}
          {user && (
            <>
              <Suspense
                fallback={
                  !selected && view === "Interview" ? <PageLoading /> : null
                }
              >
                <InterviewStudio
                  active={!selected && view === "Interview"}
                  notify={setNotice}
                />
              </Suspense>
              <Suspense
                fallback={
                  !selected && view === "Study plan" ? <PageLoading /> : null
                }
              >
                <StudyPlan
                  active={!selected && view === "Study plan"}
                  docs={docs}
                  uid={user.uid}
                  notify={setNotice}
                  onOpenDoc={(doc) => openDoc(doc, "Notes")}
                />
              </Suspense>
              <Suspense
                fallback={
                  !selected && view === "Support" ? <PageLoading /> : null
                }
              >
                <Support
                  active={!selected && view === "Support"}
                  user={user}
                  notify={setNotice}
                  openTicketId={openTicketId}
                  onOpened={() => setOpenTicketId(null)}
                />
              </Suspense>
              {admin && (
                <Suspense
                  fallback={
                    !selected && view === "Admin" ? <PageLoading /> : null
                  }
                >
                  <AdminPage
                    active={!selected && view === "Admin"}
                    notify={setNotice}
                  />
                </Suspense>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>Less overwhelm. More understanding.</span>
          </footer>
        </main>

        {user && (
          <div className="dock-wrap">
            <nav className="dock" aria-label="Workspace navigation">
              {NAV.map(([Icon, v]) => (
                <button
                  key={v}
                  className={view === v ? "selected" : ""}
                  aria-current={view === v ? "page" : undefined}
                  aria-label={v}
                  onClick={() => navigate(v)}
                >
                  <Icon size={20} />
                  <span>{v}</span>
                </button>
              ))}
              <span className="dock-divider" />
              <button aria-label="Upload documents" onClick={openUpload}>
                <Plus size={21} />
                <span>Upload</span>
              </button>
            </nav>
          </div>
        )}
        {user && (
          <Suspense fallback={null}>
            <HelpBot
              uid={user.uid}
              context={{
                view: selected ? `document "${selected.name}"` : view,
                doc: selected,
                page: botPage,
              }}
            />
          </Suspense>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        aria-label="Choose study files"
        accept=".pdf,.txt"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => !uploadLock.current && setModal(null)}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            tabIndex={-1}
            className="modal panel"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close dialog"
              disabled={uploading}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "upload" ? (
              <>
                <Upload size={32} />
                <h2 id="dialog-title">Bring a little knowledge.</h2>
                <p>
                  Upload one or many PDFs (text or scanned) or TXT files. Each gets
                  notes, figures and 2/5/8-mark questions.
                </p>
                <button
                  className="dropzone"
                  onClick={() => fileRef.current.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={dropFiles}
                >
                  <Plus size={26} />
                  <strong aria-live="polite">
                    {uploading
                      ? "Add more files while these are read…"
                      : "Choose files or drop them here"}
                  </strong>
                  <small>
                    PDF or TXT · Several at once · Maximum 25 MB each
                  </small>
                </button>
                {queue.length > 0 && (
                  <ul className="upload-queue" aria-label="Upload progress">
                    {queue.map((item) => (
                      <li key={item.id} className={item.status}>
                        <span className="queue-icon" aria-hidden="true">
                          {item.status === "done" ? (
                            <Check size={15} />
                          ) : item.status === "error" ? (
                            <AlertCircle size={15} />
                          ) : (
                            <Loader2
                              size={15}
                              className={
                                item.status === "waiting" ? "" : "spin"
                              }
                            />
                          )}
                        </span>
                        <span className="queue-text">
                          <strong>{item.name}</strong>
                          <small>
                            {item.status === "waiting"
                              ? "Waiting…"
                              : item.message}
                          </small>
                        </span>
                        {item.status === "done" && (
                          <button
                            className="tag"
                            onClick={() => {
                              const doc = docs.find((d) => d.id === item.docId);
                              setModal(null);
                              setQueue([]);
                              openDoc(doc);
                            }}
                          >
                            Open
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {queue.length > 0 && !uploading && (
                  <button
                    className="primary"
                    onClick={() => {
                      setModal(null);
                      setQueue([]);
                      navigate("Library");
                    }}
                  >
                    Go to library <ArrowRight size={16} />
                  </button>
                )}
                <p className="fine">
                  Text and figures are read in your browser, then saved
                  privately to your account. Scanned pages are read with built-in OCR.
                </p>
              </>
            ) : modal === "delete-doc" ? (
              <div className="delete-account">
                <Trash2 size={30} />
                <h2 id="dialog-title">Delete this document?</h2>
                <p>
                  <b>{docToDelete?.name}</b> and its notes, figures, questions
                  and chats will be deleted from your account. This cannot be
                  undone.
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => {
                      setModal(null);
                      setDocToDelete(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary danger-button"
                    onClick={confirmRemoveDoc}
                  >
                    Delete document
                  </button>
                </div>
              </div>
            ) : modal === "delete-account" ? (
              <div className="delete-account">
                <UserX size={32} />
                <h2 id="dialog-title">Delete your account?</h2>
                <p>
                  This permanently deletes your documents, notes, figures,
                  question banks, resume, interview sessions, study plans,
                  chats, tickets and feedback, and then your sign-in. It cannot
                  be undone. You can <b>Download my data</b> first from the
                  account menu.
                </p>
                <label>
                  Type DELETE to confirm
                  <input
                    value={deleting.typed}
                    autoComplete="off"
                    onChange={(e) =>
                      setDeleting((d) => ({
                        ...d,
                        typed: e.target.value,
                        error: "",
                      }))
                    }
                  />
                </label>
                {deleting.error && (
                  <p className="form-error" role="alert">
                    {deleting.error}
                  </p>
                )}
                {deleting.step && (
                  <Thinking
                    label={deleting.step}
                    compact
                    lines={0}
                    slowHint=""
                  />
                )}
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={Boolean(deleting.step)}
                    onClick={() => setModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary danger-button"
                    disabled={
                      deleting.typed.trim() !== "DELETE" ||
                      Boolean(deleting.step)
                    }
                    onClick={confirmDeleteAccount}
                  >
                    Delete everything
                  </button>
                </div>
              </div>
            ) : (
              <Suspense fallback={<PageLoading />}>
                <AISettings onDone={() => setModal(null)} />
              </Suspense>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}

function PageTitle({ kicker, title, subtitle }) {
  return (
    <section className="page-title">
      <div className="eyebrow">{kicker}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}

function DocCard({ d, i, open, remove, rename }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className={"doc-card" + (renaming ? " renaming" : "")}>
      {renaming ? (
        <div className="doc-open">
          <div className="doc-top">
            <span className="document-icon">
              <FileText size={22} />
            </span>
          </div>
          <div className="doc-details">
            <span className="fine">Rename document</span>
            <EditableName
              name={d.name}
              as="h3"
              editing
              onEditingChange={setRenaming}
              onRename={(name) => rename(d, name)}
            />
            <p>
              {d.pages.length} {d.pages.length === 1 ? "page" : "pages"}{" "}
              <span>·</span> {d.file}
            </p>
          </div>
        </div>
      ) : (
        <button
          className="doc-open"
          onClick={() => open(d)}
          aria-label={`Open ${d.name}`}
        >
          <div className="doc-top">
            <span className="document-icon">
              <FileText size={22} />
            </span>
            <span className="tag">
              {(d.images?.length ?? d.imageCount)
                ? `${d.images?.length ?? d.imageCount} figures`
                : "PDF"}
            </span>
            <ArrowUpRight size={18} />
          </div>
          <div className="doc-details">
            <span className="fine">{d.category}</span>
            <h3>{d.name}</h3>
            <p>
              {d.pages.length} {d.pages.length === 1 ? "page" : "pages"}{" "}
              <span>·</span> {d.kind}
            </p>
          </div>
          <div className="doc-bottom">
            <span>{i === 0 ? "Explore this document" : "Open document"}</span>
            <ArrowRight size={16} />
          </div>
        </button>
      )}
      {!renaming && (
        <div className="doc-actions">
          <button
            className="doc-action"
            aria-label={`Rename ${d.name}`}
            onClick={() => setRenaming(true)}
          >
            <Pencil size={15} />
          </button>
          <button
            className="doc-action"
            aria-label={`Delete ${d.name}`}
            onClick={() => remove(d)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
