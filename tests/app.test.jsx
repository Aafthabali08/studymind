import React from "react";
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "../src/App";
import * as documents from "../src/documents";
import * as cloud from "../src/cloud";
import { samples } from "./fixtures/samples";
vi.mock("../src/documents", () => ({
  readDocument: vi.fn(),
  downloadText: vi.fn(),
  downloadBlob: vi.fn(),
  warmUpReader: vi.fn(),
}));
// PDF / Word downloads: capture what would be written.
vi.mock("../src/exporters/index", async (orig) => {
  const real = await orig();
  const { fileName } = await import("../src/exporters/blocks");
  return {
    ...real,
    exportBlocks: vi.fn(async ({ name, format }) =>
      fileName(name, format === "word" ? "docx" : "pdf"),
    ),
  };
});
vi.mock("../src/questionPdf", async (orig) => ({
  ...(await orig()),
  downloadQuestionPdf: vi.fn(async ({ doc, title }) => ({
    fileName: `${doc.name} - ${title}.pdf`,
    count: 21,
  })),
}));
// A signed-in (or signed-out) user without touching real Firebase.
const authState = vi.hoisted(() => ({
  enabled: true,
  ready: true,
  user: null,
  signOut: null,
}));
vi.mock("../src/auth", () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }) => children,
  authMessage: (e) => e?.message || "error",
}));
// In-memory stand-in for Firestore.
const db = vi.hoisted(() => ({ docs: [] }));
vi.mock("../src/cloud", () => ({
  loadLibrary: vi.fn(async () => db.docs.map((d) => ({ ...d }))),
  newDocumentId: vi.fn(
    async () => `new-${Math.random().toString(36).slice(2, 8)}`,
  ),
  saveDocument: vi.fn(async (uid, doc, file, { id } = {}) => {
    db.docs.unshift({ ...doc, id, study: {} });
    return { id, url: null, storagePath: null, storageError: "" };
  }),
  saveImages: vi.fn(async () => {}),
  loadImages: vi.fn(async () => []),
  saveStudy: vi.fn(async () => {}),
  deleteDocument: vi.fn(async () => {}),
  renameDocument: vi.fn(async () => {}),
  loadPlan: vi.fn(async () => null),
  savePlan: vi.fn(async () => {}),
  loadChat: vi.fn(async () => null),
  saveChat: vi.fn(async () => {}),
  loadPrefs: vi.fn(async () => null),
  savePrefs: vi.fn(async () => {}),
  loadResume: vi.fn(async () => null),
  saveResume: vi.fn(async () => {}),
  deleteResume: vi.fn(async () => {}),
  saveInterview: vi.fn(async () => {}),
}));
vi.mock("../src/support", async (importOriginal) => ({
  ...(await importOriginal()),
  ensureProfile: vi.fn(async () => {}),
  setDocCount: vi.fn(async () => {}),
  changeDocCount: vi.fn(async () => {}),
  loadLearning: vi.fn(async () => ({ avoid: [], good: [] })),
  loadGuidance: vi.fn(async () => []),
  myNotifications: vi.fn(async () => []),
  markNotificationsRead: vi.fn(async () => {}),
  myTickets: vi.fn(async () => []),
  adminUsers: vi.fn(async () => []),
  adminTickets: vi.fn(async () => []),
  adminFeedback: vi.fn(async () => []),
  exportMyData: vi.fn(async () => ({ documents: [{ id: "ai", name: "AI" }] })),
  signedInRecently: vi.fn(async () => true),
  deleteMyAccount: vi.fn(async (user, onStep) => onStep("Deleting 12 items…")),
}));
import * as support from "../src/support";
const click = async (name) =>
  userEvent.click(screen.getByRole("button", { name, exact: true }));
async function renderApp() {
  const view = render(<App />);
  await screen.findByRole("button", { name: "Open Artificial Intelligence" });
  return view;
}
async function openAI() {
  await userEvent.click(
    screen.getByRole("button", { name: "Open Artificial Intelligence" }),
  );
}
const dock = () =>
  within(screen.getByRole("navigation", { name: "Workspace navigation" }));
beforeEach(() => {
  vi.mocked(documents.readDocument).mockReset();
  vi.mocked(documents.downloadText).mockClear();
  Object.values(cloud).forEach((fn) => fn.mockClear?.());
  db.docs = samples.map((d) => ({ ...d, sample: undefined, study: {} }));
  authState.enabled = true;
  authState.user = {
    uid: "u1",
    email: "student@example.com",
    displayName: "Asha Rao",
    emailVerified: true,
  };
  authState.signOut = vi.fn(async () => {});
});
describe("login gate and demo page", () => {
  beforeEach(() => {
    authState.user = null;
  });
  it("shows the demo page and asks for login before any feature", async () => {
    render(<App />);
    expect(
      screen.getByRole("heading", {
        name: "A little curiosity. A lot of possibility.",
      }),
    ).toBeVisible();
    expect(screen.getByText(/WHAT YOU GET AFTER UPLOADING/)).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Workspace navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guest profile" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open / }),
    ).not.toBeInTheDocument();
    expect(cloud.loadLibrary).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /My library/ }));
    expect(screen.getByRole("dialog", { name: "Log in" })).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Log in or sign up to continue.",
    );
    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Log in" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /Interview studio/ }),
    );
    expect(screen.getByRole("dialog", { name: "Log in" })).toBeVisible();
  });
  it("opens sign up and log in as a floating card at the top right", async () => {
    render(<App />);
    await click("Sign up");
    const card = screen.getByRole("dialog", { name: "Sign up" });
    expect(card).toHaveClass("popover");
    expect(
      within(card).getByRole("heading", { name: "Create your account." }),
    ).toBeVisible();
    expect(
      within(card).getByRole("button", { name: /Continue with Google/ }),
    ).toBeVisible();
    expect(
      within(card).queryByText("Continue as guest"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Log in",
      }),
    );
    const login = screen.getByRole("dialog", { name: "Log in" });
    expect(within(login).getByText("Forgot password?")).toBeVisible();
    expect(
      within(login).getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  });
  it("keeps Interview Studio locked until login", async () => {
    render(<App />);
    await userEvent.click(
      screen.getByRole("button", { name: /Interview studio/ }),
    );
    expect(screen.getByRole("dialog", { name: "Log in" })).toBeVisible();
    expect(
      screen.queryByLabelText("What role are you applying for?"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Log in to unlock/ }),
    ).toBeVisible();
  });
  it("switches both themes and retains preference across remount", async () => {
    const app = render(<App />);
    await click("Switch to black theme");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("studymind-theme")).toBe("dark");
    app.unmount();
    render(<App />);
    await click("Switch to light theme");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
describe("signed in: navigation, account and library", () => {
  it("loads the account's library with no demo documents and visits every page", async () => {
    await renderApp();
    expect(cloud.loadLibrary).toHaveBeenCalledWith("u1");
    expect(screen.queryByText("SAMPLE")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Hi, Asha\./ })).toBeVisible();
    for (const [name, title] of [
      ["Library", "The library."],
      ["Study plan", "Make space to learn."],
      ["Interview", "Meet your next chapter."],
    ]) {
      await userEvent.click(dock().getByRole("button", { name, exact: true }));
      // Pages load on demand: wait for each one.
      expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    }
  });
  it("opens the account menu with AI settings, back to studying and log out", async () => {
    await renderApp();
    await click("Your account");
    const menu = screen.getByRole("dialog", { name: "Your account" });
    expect(within(menu).getByText("student@example.com")).toBeVisible();
    await userEvent.click(
      within(menu).getByRole("button", { name: "AI settings" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Your AI engine." }),
    ).toBeVisible();
    await click("Save and close");
    await userEvent.click(
      dock().getByRole("button", { name: "Library", exact: true }),
    );
    await click("Your account");
    await click("Back to studying");
    expect(screen.getByRole("heading", { name: /Hi, Asha\./ })).toBeVisible();
    await click("Your account");
    await click("Log out");
    expect(authState.signOut).toHaveBeenCalledOnce();
  });
  it("searches the library and deletes a document from its card", async () => {
    await renderApp();
    await userEvent.click(
      dock().getByRole("button", { name: "Library", exact: true }),
    );
    await userEvent.type(
      screen.getByLabelText("Search your documents"),
      "  machine  ",
    );
    expect(
      screen.getByRole("heading", { name: "Machine Learning" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Database Management" }),
    ).not.toBeInTheDocument();
    await click("Delete Machine Learning");
    // Asks first; Cancel keeps it.
    const ask = screen.getByRole("dialog");
    expect(ask).toHaveTextContent("Delete this document?");
    expect(ask).toHaveTextContent("Machine Learning");
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("heading", { name: "Machine Learning" }),
    ).toBeInTheDocument();
    expect(cloud.deleteDocument).not.toHaveBeenCalled();
    await click("Delete Machine Learning");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete document",
      }),
    );
    expect(
      screen.queryByRole("heading", { name: "Machine Learning" }),
    ).not.toBeInTheDocument();
    expect(cloud.deleteDocument).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ id: "ml" }),
    );
  });
});
describe("admin, support and notifications", () => {
  it("keeps profile and document count in sync and hides admin from normal users", async () => {
    await renderApp();
    expect(support.ensureProfile).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "u1" }),
    );
    await waitFor(() =>
      expect(support.setDocCount).toHaveBeenCalledWith("u1", 3),
    );
    await click("Your account");
    expect(
      screen.getByRole("button", { name: "Help & support" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Admin dashboard" }),
    ).not.toBeInTheDocument();
    await click("Help & support");
    expect(
      screen.getByRole("heading", { name: "We're listening." }),
    ).toBeVisible();
  });
  it("shows the admin dashboard to the admin email", async () => {
    authState.user = {
      uid: "admin",
      email: "aafthabali08@gmail.com",
      displayName: "Aafthab",
      emailVerified: true,
    };
    await renderApp();
    await click("Your account");
    await click("Admin dashboard");
    expect(
      screen.getByRole("heading", { name: "Admin dashboard." }),
    ).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Admin sections" }),
    ).toBeVisible();
  });
  it("shows unread ticket updates in the bell and opens the ticket", async () => {
    vi.mocked(support.myNotifications).mockResolvedValue([
      {
        id: "n1",
        title: 'Your ticket "PDF" is now Resolved',
        body: "Fixed.",
        ticketId: "t1",
        read: false,
      },
    ]);
    await renderApp();
    const bell = await screen.findByRole("button", {
      name: "Notifications, 1 unread",
    });
    await userEvent.click(bell);
    await click("Mark all read");
    expect(support.markNotificationsRead).toHaveBeenCalledWith("u1", ["n1"]);
    await userEvent.click(
      screen.getByRole("button", { name: /is now Resolved/ }),
    );
    expect(
      screen.getByRole("heading", { name: "We're listening." }),
    ).toBeVisible();
    vi.mocked(support.myNotifications).mockResolvedValue([]);
  });
  it("marks a ticket's notifications read when one of them is opened", async () => {
    vi.mocked(support.markNotificationsRead).mockClear();
    vi.mocked(support.myNotifications).mockResolvedValue([
      { id: "a", title: 'New reply on "PDF"', body: "Hi", ticketId: "t1", read: false },
      { id: "b", title: 'Your ticket "PDF" is now In progress', body: "", ticketId: "t1", read: false },
      { id: "c", title: 'New reply on "Other"', body: "", ticketId: "t2", read: false },
    ]);
    await renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Notifications, 3 unread" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /is now In progress/ }));
    expect(support.markNotificationsRead).toHaveBeenCalledWith("u1", ["a", "b"]);
    expect(
      screen.getByRole("button", { name: "Notifications, 1 unread" }),
    ).toBeInTheDocument();
    vi.mocked(support.myNotifications).mockResolvedValue([]);
  });
});
describe("preferences", () => {
  it("saves the very first theme change after signing in", async () => {
    vi.mocked(cloud.savePrefs).mockClear();
    await renderApp();
    const toggle = screen.getByRole("button", { name: /^Switch to (black|white) theme$/ });
    const to = /black/.test(toggle.getAttribute("aria-label")) ? "dark" : "light";
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(cloud.savePrefs).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({ theme: to }),
      ),
    );
  });
});
describe("your data", () => {
  it("downloads all of the user's data as JSON", async () => {
    await renderApp();
    await click("Your account");
    await click("Download my data");
    await waitFor(() =>
      expect(documents.downloadText).toHaveBeenCalledWith(
        expect.stringContaining('"documents"'),
        "studymind-my-data.json",
      ),
    );
    expect(support.exportMyData).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "u1" }),
    );
  });
  it("deletes the account only after typing DELETE and a recent sign-in", async () => {
    await renderApp();
    await click("Your account");
    await click("Delete my account");
    const confirm = screen.getByRole("button", { name: "Delete everything" });
    expect(confirm).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Type DELETE to confirm"),
      "DELETE",
    );
    expect(confirm).toBeEnabled();
    vi.mocked(support.signedInRecently).mockResolvedValueOnce(false);
    await userEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /log out and log in again/,
    );
    expect(support.deleteMyAccount).not.toHaveBeenCalled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(support.deleteMyAccount).toHaveBeenCalledWith(
        expect.objectContaining({ uid: "u1" }),
        expect.any(Function),
      ),
    );
    expect(await screen.findByText(/permanently deleted/)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
describe("renaming documents", () => {
  it("renames from a library card and saves it to the account", async () => {
    await renderApp();
    await userEvent.click(
      dock().getByRole("button", { name: "Library", exact: true }),
    );
    await click("Rename Machine Learning");
    const input = screen.getByLabelText("Document name");
    expect(input).toHaveValue("Machine Learning");
    await userEvent.clear(input);
    await userEvent.type(input, "  ML   revision notes {Enter}");
    expect(
      screen.getByRole("heading", { name: "ML revision notes" }),
    ).toBeVisible();
    expect(cloud.renameDocument).toHaveBeenCalledWith(
      "u1",
      "ml",
      "ML revision notes",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      'Renamed to "ML revision notes".',
    );
  });
  it("renames from the document header, rejects empty names and cancels with Escape", async () => {
    await renderApp();
    await openAI();
    await click("Rename Artificial Intelligence");
    const input = screen.getByLabelText("Document name");
    await userEvent.clear(input);
    await click("Save name");
    expect(screen.getByRole("alert")).toHaveTextContent("can't be empty");
    await userEvent.type(input, "Draft{Escape}");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Artificial Intelligence",
      }),
    ).toBeVisible();
    expect(cloud.renameDocument).not.toHaveBeenCalled();
    await click("Rename Artificial Intelligence");
    await userEvent.clear(screen.getByLabelText("Document name"));
    await userEvent.type(screen.getByLabelText("Document name"), "AI unit 1");
    await click("Save name");
    expect(
      screen.getByRole("heading", { level: 1, name: "AI unit 1" }),
    ).toBeVisible();
    expect(cloud.renameDocument).toHaveBeenCalledWith("u1", "ai", "AI unit 1");
    await click("Back to library");
    expect(
      screen.getByRole("button", { name: "Open AI unit 1" }),
    ).toBeVisible();
  });
  it("restores the old name if saving fails", async () => {
    vi.mocked(cloud.renameDocument).mockRejectedValueOnce(new Error("offline"));
    await renderApp();
    await openAI();
    await click("Rename Artificial Intelligence");
    await userEvent.clear(screen.getByLabelText("Document name"));
    await userEvent.type(
      screen.getByLabelText("Document name"),
      "New name{Enter}",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Artificial Intelligence",
        }),
      ).toBeVisible(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Could not rename");
  });
});
describe("documents and study tools", () => {
  it("searches with a working page citation and boundary buttons", async () => {
    await renderApp();
    await openAI();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Search document"),
      "What is backpropagation?{Enter}",
    );
    await click("Page 3");
    expect(
      within(screen.getByRole("article")).getByRole("heading", {
        name: "Neural Networks",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await click("Previous page");
    expect(
      screen.getByRole("heading", { name: "Search and Problem Solving" }),
    ).toBeVisible();
  });
  it("returns a clear no-match response without fabricated citations", async () => {
    await renderApp();
    await openAI();
    await userEvent.type(
      screen.getByLabelText("Search document"),
      "What is photosynthesis?{Enter}",
    );
    expect(screen.getByText(/I could not find matching text/)).toBeVisible();
  });
  it("shows structured notes, keeps edits across tabs and reopening, and exports them", async () => {
    await renderApp();
    await openAI();
    await click("Notes");
    const notes = document.querySelector(".notes-body");
    expect(
      within(notes).getByRole("heading", {
        level: 1,
        name: "Artificial Intelligence",
      }),
    ).toBeVisible();
    expect(
      within(notes).getByRole("heading", {
        level: 2,
        name: "3. Neural Networks",
      }),
    ).toBeVisible();
    expect(within(notes).getByRole("table")).toBeVisible();
    await click("Edit");
    const input = screen.getByLabelText("Editable notes");
    expect(input.value).toMatch(/^# Artificial Intelligence/);
    await userEvent.clear(input);
    await userEvent.type(input, "# My notes{Enter}{Enter}Some **bold** text.");
    await click("Preview");
    expect(
      screen.getByRole("heading", { level: 1, name: "My notes" }),
    ).toBeVisible();
    expect(screen.getByText("EDITED BY YOU", { exact: false })).toBeVisible();
    await click("Ask document");
    await click("Notes");
    expect(
      screen.getByRole("heading", { level: 1, name: "My notes" }),
    ).toBeVisible();
    await click("Back to library");
    await openAI();
    await click("Notes");
    expect(
      screen.getByRole("heading", { level: 1, name: "My notes" }),
    ).toBeVisible();
    const { exportBlocks } = await import("../src/exporters/index");
    await click("Download notes as Word");
    expect(exportBlocks).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "word",
        name: ["Artificial Intelligence", "Notes"],
      }),
    );
    const exported = exportBlocks.mock.calls.at(-1)[0].blocks;
    expect(exported).toEqual(
      expect.arrayContaining([
        { type: "h", level: 1, text: "My notes" },
        { type: "p", text: "Some **bold** text." },
      ]),
    );
    expect(
      await screen.findByText("Downloaded Artificial Intelligence - Notes.docx."),
    ).toBeVisible();
    await click("Reset to built-in notes");
    expect(
      within(document.querySelector(".notes-body")).getByRole("heading", {
        level: 1,
        name: "Artificial Intelligence",
      }),
    ).toBeVisible();
  });
  it("groups questions by 2, 5 and 8 marks with detailed answers", async () => {
    await renderApp();
    await openAI();
    await click("Questions");
    const group = screen.getByRole("group", { name: "Marks" });
    expect(
      within(group).getByRole("button", { name: /2 marks/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const q = screen.getByRole("button", {
      name: /Define artificial intelligence\./,
    });
    expect(q).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(q);
    expect(q).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/MODEL ANSWER/)).toBeVisible();
    expect(
      within(document.querySelector(".answer")).getByText(
        /study of systems that perceive/,
      ),
    ).toBeVisible();
    await userEvent.click(
      within(group).getByRole("button", { name: /5 marks/ }),
    );
    await click("Show all answers");
    expect(
      screen.getAllByRole("heading", { level: 3, name: "Key points" }).length,
    ).toBeGreaterThan(1);
    await userEvent.click(
      within(group).getByRole("button", { name: /8 marks/ }),
    );
    await click("Show all answers");
    expect(
      screen.getAllByRole("heading", { level: 2, name: "Introduction" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("heading", { level: 2, name: "Conclusion" }).length,
    ).toBeGreaterThan(0);
    await click("Complete question bank as PDF");
    const { downloadQuestionPdf } = await import("../src/questionPdf");
    expect(downloadQuestionPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "pdf",
        category: "all",
        title: "Complete question bank",
        bank: expect.objectContaining({ 2: expect.any(Array), 8: expect.any(Array) }),
      }),
    );
    expect(
      await screen.findByText(
        "Downloaded Artificial Intelligence - Complete question bank.pdf (21 questions).",
      ),
    ).toBeVisible();
  });
  it("groups questions by type with importance, memory tricks and a complete bank", async () => {
    await renderApp();
    await openAI();
    await click("Questions");
    const stats = screen.getByLabelText("Question bank summary");
    expect(within(stats).getByText("important")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 4, name: /Definition/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 4, name: /List \/ State/ }),
    ).toBeVisible();
    const q = screen.getByRole("button", {
      name: /List the components of a search problem/,
    });
    expect(q).toHaveTextContent("★ Important");
    await userEvent.click(q);
    expect(screen.getByText("MEMORY TRICK")).toBeVisible();
    expect(document.querySelector(".memory-trick").textContent).toMatch(
      /Initial · Actions · Model · Goal · Cost/,
    );
    await click("★ Important only");
    expect(
      screen.getByRole("button", { name: /★ Important only/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(
      within(screen.getByRole("group", { name: "Marks" })).getByRole("button", {
        name: /^All/,
      }),
    );
    for (const m of [2, 5, 8])
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: new RegExp(`${m}-mark questions`),
        }),
      ).toBeVisible();
  });
  it("links the notes to the complete question bank", async () => {
    await renderApp();
    await openAI();
    await click("Notes");
    expect(screen.getByText("Complete question bank")).toBeVisible();
    await click("Open question bank");
    expect(
      within(screen.getByRole("group", { name: "Marks" })).getByRole("button", {
        name: /^All/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("flips and advances flashcards", async () => {
    await renderApp();
    await click("Flashcards");
    expect(
      screen.getByRole("button", { name: "Previous card" }),
    ).toBeDisabled();
    // Cards come from the question bank (built in idle time): a real
    // question, then its answer.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reveal flashcard answer" })
          .textContent,
      ).not.toMatch(/^Recall the key idea/),
    );
    await click("Reveal flashcard answer");
    expect(
      screen.getByText(/^Source: page \d+$|^From your question bank$/),
    ).toBeVisible();
    await click("Next card");
    expect(
      screen.getByRole("button", { name: "Reveal flashcard answer" }),
    ).toBeVisible();
    await click("Previous card");
    expect(
      screen.getByRole("button", { name: "Previous card" }),
    ).toBeDisabled();
  });
  it("runs a 3-set quiz from the document, scores it and makes new questions", async () => {
    await renderApp();
    await openAI();
    await click("Quiz");
    const sets = await screen.findByRole("group", { name: "Quiz sets" });
    expect(within(sets).getAllByRole("button")).toHaveLength(3);
    const total = Number(
      screen
        .getByText(/^SET 1 · QUESTION 1 OF \d+/)
        .textContent.match(/OF (\d+)/)[1],
    );
    expect(total).toBeGreaterThanOrEqual(12);
    const firstPrompt = document.querySelector(".quiz-prompt").textContent;
    for (let n = 0; n < total; n++) {
      const selects = screen.queryAllByRole("combobox", { name: /^Sentence for/ });
      if (selects.length) {
        // Matching: pick a sentence for every term, then check.
        for (const [i, sel] of selects.entries())
          await userEvent.selectOptions(sel, String(i % 4));
        await click("Check matches");
      } else {
        const options = within(
          screen.getByRole("group", { name: "Answers" }),
        ).getAllByRole("button");
        await userEvent.click(options[0]);
        options.forEach((o) => expect(o).toBeDisabled());
        expect(options.filter((o) => o.classList.contains("right"))).toHaveLength(1);
      }
      expect(screen.getByRole("status", { name: "" })).toBeInTheDocument();
      await click(n === total - 1 ? "Finish quiz" : "Next question");
    }
    expect(
      screen.getByRole("heading", { name: new RegExp(`/ ${total} correct$`) }),
    ).toBeVisible();
    await click("Try this set again");
    expect(screen.getByText(/^SET 1 · QUESTION 1 OF/)).toBeVisible();
    // New questions: a different quiz from the same document.
    await click("New questions");
    await waitFor(() =>
      expect(document.querySelector(".quiz-prompt")?.textContent).not.toBe(firstPrompt),
    );
    expect(document.querySelector(".quiz-prompt")).toBeInTheDocument();
  });
  it("starts, stops, and cancels speech when leaving the page", async () => {
    await renderApp();
    await click("Read aloud");
    await click("Read this page");
    expect(window.speechSynthesis.speak).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Reading…" })).toBeDisabled();
    await click("Stop");
    expect(
      screen.getByRole("button", { name: "Read this page" }),
    ).toBeEnabled();
    await click("Read this page");
    await click("Notes");
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });
  it("handles missing speech APIs without crashing", async () => {
    window.speechSynthesis = undefined;
    window.SpeechSynthesisUtterance = undefined;
    await renderApp();
    await click("Read aloud");
    await click("Read this page");
    expect(screen.getByRole("status")).toHaveTextContent(
      /Read aloud is unavailable/,
    );
  });
  it("exports document text as a Word document", async () => {
    await renderApp();
    await openAI();
    await click("Export to Word");
    await vi.waitFor(() =>
      expect(documents.downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "Artificial Intelligence - text.docx",
      ),
    );
    const [blob] = documents.downloadBlob.mock.calls.at(-1);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
describe("AI study tools", () => {
  it("summarises the document with exact, page-linked key sentences", async () => {
    await renderApp();
    await openAI();
    await click("Summary");
    expect(
      screen.getByRole("heading", { name: "The short version." }),
    ).toBeVisible();
    const points = within(document.querySelector(".key-points")).getAllByRole(
      "listitem",
    );
    expect(points.length).toBeGreaterThan(2);
    await click("This page");
    expect(screen.getByText("KEY IDEAS · PAGE 1")).toBeVisible();
    await userEvent.click(
      screen.getAllByRole("button", { name: /Go to page 1/ })[0],
    );
    const { exportBlocks } = await import("../src/exporters/index");
    await click("Download summary as PDF");
    const call = exportBlocks.mock.calls.at(-1)[0];
    expect(call).toMatchObject({ format: "pdf", name: ["Artificial Intelligence", "Page 1 summary"] });
    expect(call.blocks).toContainEqual({ type: "h", level: 2, text: "Key sentences" });
    expect(call.blocks.filter((b) => b.type === "li").length).toBeGreaterThan(0);
  });
  it("opens AI engine settings and explains the pipeline", async () => {
    await renderApp();
    await openAI();
    await click("Summary");
    await click("Turn on AI for written summaries");
    expect(
      await screen.findByRole("heading", { name: "Your AI engine." }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: /Instant/ })).toBeChecked();
    await userEvent.click(
      screen.getByRole("radio", { name: /Your model server/ }),
    );
    await click("Groq");
    expect(screen.getByLabelText("Model name")).toHaveValue(
      "llama-3.1-8b-instant",
    );
    expect(
      screen.getByText("How StudyMind reads your documents"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Instant/ }));
    await click("Save and close");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("deletes the open document from the workspace", async () => {
    await renderApp();
    await openAI();
    await click("Delete document");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete document",
      }),
    );
    expect(screen.getByRole("heading", { name: "The library." })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Open Artificial Intelligence" }),
    ).not.toBeInTheDocument();
    expect(cloud.deleteDocument).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ id: "ai" }),
    );
  });
});
// applyAccept: false lets tests pick files the picker would normally hide.
const pickFiles = (files) =>
  userEvent
    .setup({ applyAccept: false })
    .upload(screen.getByLabelText("Choose study files"), files);
describe("uploads", () => {
  it("reads, saves to the account and opens a single upload", async () => {
    vi.mocked(documents.readDocument).mockResolvedValue({
      pages: ["My single line body"],
      images: [{ id: "p1-1", page: 0, dataUrl: "data:image/jpeg;base64,AA" }],
    });
    await renderApp();
    await pickFiles(
      new File(["My single line body"], "my.txt", { type: "text/plain" }),
    );
    expect(
      await screen.findByRole("heading", { name: "my", level: 1 }),
    ).toBeVisible();
    expect(documents.readDocument).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ images: true, onText: expect.any(Function) }),
    );
    expect(cloud.saveDocument).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ name: "my" }),
      expect.any(File),
      { id: expect.stringMatching(/^new-/) },
    );
    const [, , , { id }] = cloud.saveDocument.mock.calls[0];
    await waitFor(() =>
      expect(cloud.saveImages).toHaveBeenCalledWith(
        "u1",
        id,
        expect.any(Array),
      ),
    );
    expect(
      within(screen.getByRole("article")).getByText("My single line body"),
    ).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Figure 1 on page 1" }),
    ).toBeVisible();
  });
  it("uploads several files at once with progress for each", async () => {
    vi.mocked(documents.readDocument).mockImplementation(async (file) => ({
      pages: [`Text of ${file.name}. It has a sentence.`],
      images: [],
    }));
    await renderApp();
    await userEvent.click(
      dock().getByRole("button", { name: "Upload documents" }),
    );
    await pickFiles([
      new File(["a"], "alpha.pdf", { type: "application/pdf" }),
      new File(["b"], "beta.txt", { type: "text/plain" }),
      new File(["x"], "virus.exe"),
    ]);
    const list = await screen.findByRole("list", { name: "Upload progress" });
    await waitFor(() =>
      expect(
        within(list).getAllByRole("button", { name: "Open" }),
      ).toHaveLength(2),
    );
    expect(within(list).getByText("virus.exe")).toBeVisible();
    expect(within(list).getByText(/Choose a PDF or TXT/)).toBeVisible();
    expect(cloud.saveDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 documents are ready in your library.",
    );
    await click("Go to library");
    expect(screen.getByRole("heading", { name: "alpha" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "beta" })).toBeVisible();
  });
  it("reports parse failures in the queue and keeps other files going", async () => {
    vi.mocked(documents.readDocument)
      .mockRejectedValueOnce(Error("This PDF could not be read."))
      .mockResolvedValueOnce(["Good text here."]);
    await renderApp();
    await userEvent.click(
      dock().getByRole("button", { name: "Upload documents" }),
    );
    await pickFiles([
      new File(["bad"], "bad.pdf"),
      new File(["ok"], "good.pdf"),
    ]);
    const list = await screen.findByRole("list", { name: "Upload progress" });
    await waitFor(() =>
      expect(
        within(list).getByText("This PDF could not be read."),
      ).toBeVisible(),
    );
    await waitFor(() =>
      expect(within(list).getByRole("button", { name: "Open" })).toBeVisible(),
    );
  });
  it("rejects a single unsupported dropped file before parsing", async () => {
    await renderApp();
    fireEvent.drop(document.querySelector(".upload-card"), {
      dataTransfer: { files: [new File(["x"], "x.exe")] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Choose a PDF or TXT");
    expect(documents.readDocument).not.toHaveBeenCalled();
  });
  it("keeps the dialog open while files are read", async () => {
    let resolve;
    vi.mocked(documents.readDocument).mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    await renderApp();
    await userEvent.click(
      screen.getAllByRole("button", {
        name: "Upload documents",
        exact: true,
      })[0],
    );
    const zone = screen.getByRole("button", { name: /Choose files or drop/ });
    fireEvent.drop(zone, {
      dataTransfer: { files: [new File(["a"], "a.txt")] },
    });
    await waitFor(() => expect(documents.readDocument).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => resolve(["content"]));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
describe("study plan across documents", () => {
  it("plans several documents together, saves progress, and can be cleared", async () => {
    await renderApp();
    await userEvent.click(
      dock().getByRole("button", { name: "Study plan", exact: true }),
    );
    const picker = screen.getByRole("group", { name: "Documents to cover" });
    expect(within(picker).getAllByRole("checkbox")).toHaveLength(3);
    await userEvent.click(
      within(picker).getByRole("checkbox", { name: /Database Management/ }),
    );
    await userEvent.clear(screen.getByLabelText("Days to study"));
    await userEvent.type(screen.getByLabelText("Days to study"), "4");
    await click("Create study plan");
    const days = within(screen.getByRole("list", { name: "Study plan days" }));
    const checks = days.getAllByRole("checkbox");
    expect(checks).toHaveLength(4);
    expect(days.getAllByText(/Artificial Intelligence/).length).toBeGreaterThan(
      0,
    );
    expect(days.getAllByText(/Machine Learning/).length).toBeGreaterThan(0);
    expect(days.queryByText(/Database Management/)).not.toBeInTheDocument();
    expect(days.getByText("Revision")).toBeVisible();
    await userEvent.click(checks[0]);
    expect(cloud.savePlan).toHaveBeenLastCalledWith(
      "u1",
      expect.objectContaining({ checked: { 0: true }, docIds: ["ai", "ml"] }),
    );
    await userEvent.click(
      dock().getByRole("button", { name: "Overview", exact: true }),
    );
    await userEvent.click(
      dock().getByRole("button", { name: "Study plan", exact: true }),
    );
    expect(
      within(
        screen.getByRole("list", { name: "Study plan days" }),
      ).getAllByRole("checkbox")[0],
    ).toBeChecked();
    await click("Clear plan");
    expect(
      screen.queryByRole("list", { name: "Study plan days" }),
    ).not.toBeInTheDocument();
  });
});
