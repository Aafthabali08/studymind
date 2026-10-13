import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks -----------------------------------------------------------------------
const uniApi = vi.hoisted(() => ({
  loadUniOptions: vi.fn(),
  loadNodes: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNodes: vi.fn(),
  saveUniFile: vi.fn(),
  loadAllNodes: vi.fn(),
}));
vi.mock("../src/university", async (orig) => ({ ...(await orig()), ...uniApi }));
vi.mock("../src/documents", () => ({ readDocument: vi.fn(), warmUpReader: vi.fn(), downloadBlob: vi.fn() }));

const api = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  adminBans: vi.fn(),
  adminSupporters: vi.fn(),
  adminAudit: vi.fn(),
  adminTickets: vi.fn(),
  addSupporter: vi.fn(),
  removeSupporter: vi.fn(),
  suspendUser: vi.fn(),
  blockUser: vi.fn(),
  unbanUser: vi.fn(),
  appealTicket: vi.fn(),
}));
vi.mock("../src/support", async (orig) => ({
  ...(await orig()),
  ...api,
  adminFeedback: vi.fn(async () => []),
  loadGuidance: vi.fn(async () => []),
  markTicketRead: vi.fn(async () => {}),
}));

const { default: UniversityPage } = await import("../src/UniversityPage");
const { default: AdminPage } = await import("../src/AdminPage");
const { default: BanScreen } = await import("../src/BanScreen");
const { libraryActor } = await import("../src/university");

const scope = { university: "GITAM VIZAG", degree: "CSE CORE", year: "1" };
const NODES = [
  { id: "dbms", kind: "subject", name: "DBMS", parentId: null, exam: "both", ...scope },
  { id: "u1", kind: "folder", name: "Unit 1", parentId: "dbms", exam: "both", ...scope },
];
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const USERS = [
  { id: "u1", email: "asha@college.edu", name: "Asha", docCount: 2, createdAt: minutesAgo(9000), lastActive: minutesAgo(1) },
  { id: "u2", email: "ravi@gmail.com", name: "Ravi", docCount: 0, createdAt: minutesAgo(9000), lastActive: minutesAgo(600) },
  { id: "ad", email: "aafthabali08@gmail.com", name: "Admin", docCount: 0, createdAt: minutesAgo(9000), lastActive: minutesAgo(2) },
];
const AUDIT = [
  {
    id: "a2",
    uid: "u1",
    name: "Asha",
    email: "asha@college.edu",
    action: "upload",
    summary: "Uploaded “ER model.pdf” (4 pages) to “Unit 1”",
    course: "GITAM VIZAG · CSE CORE · Year 1",
    items: [{ id: "f9", name: "ER model", kind: "file" }],
    count: 1,
    at: minutesAgo(5),
  },
  {
    id: "a1",
    uid: "u1",
    name: "Asha",
    email: "asha@college.edu",
    action: "move",
    summary: "Transferred subject “DBMS” with 1 folder and 0 files inside from Year 1 to Year 2",
    course: "GITAM VIZAG · CSE CORE · Year 2",
    items: [
      { id: "dbms", name: "DBMS", kind: "subject" },
      { id: "u1", name: "Unit 1", kind: "folder" },
    ],
    count: 2,
    at: minutesAgo(60),
  },
  { id: "a0", uid: "old", name: "", email: "former@college.edu", action: "rename", summary: "Renamed folder “U1” to “Unit 1”", course: "", items: [], count: 1, at: minutesAgo(9000) },
];

beforeEach(() => {
  localStorage.clear();
  Object.values(uniApi).forEach((f) => f.mockReset());
  Object.values(api).forEach((f) => f.mockReset());
  uniApi.loadUniOptions.mockResolvedValue({ universities: ["GITAM VIZAG"], degrees: ["CSE CORE"], years: ["1", "2"] });
  uniApi.loadNodes.mockImplementation(async (s) => (s.year === "1" ? NODES : []));
  uniApi.createNode.mockImplementation(async ({ name, parentId, kind }) => ({ id: `n-${name}`, kind, name, parentId, exam: "both", ...scope }));
  api.adminUsers.mockImplementation(async ({ search } = {}) => (search ? USERS.filter((u) => u.email.startsWith(search)) : USERS));
  api.adminBans.mockResolvedValue({});
  api.adminSupporters.mockResolvedValue({});
  api.adminAudit.mockResolvedValue(AUDIT);
  api.adminTickets.mockResolvedValue([]);
  api.addSupporter.mockImplementation(async (u) => ({ uid: u.id, email: u.email, name: u.name, addedAt: new Date() }));
  api.removeSupporter.mockResolvedValue();
  api.suspendUser.mockImplementation(async (u, ms, reason) => ({ uid: u.id, type: "suspended", until: new Date(Date.now() + ms), reason }));
  api.blockUser.mockImplementation(async (u, reason) => ({ uid: u.id, type: "blocked", until: null, reason }));
  api.unbanUser.mockResolvedValue();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

// ---- University page as a supporter ------------------------------------------------
describe("a supporter on the University page", () => {
  const helper = { uid: "u1", email: "asha@college.edu", displayName: "Asha" };

  it("can add, upload, edit, transfer, copy and paste, but not delete or edit the options", async () => {
    const notify = vi.fn();
    render(<UniversityPage active admin={false} supporter user={helper} notify={notify} onOpenFile={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Open DBMS" })).toBeVisible();
    // Their changes are made as a supporter (so each is logged).
    expect(libraryActor()).toEqual({ uid: "u1", email: "asha@college.edu", name: "Asha", supporter: true });

    const tools = screen.getByLabelText("Supporter tools");
    expect(tools).toHaveTextContent("Only the admin can delete. Your changes are recorded for the admin.");
    for (const name of ["Cut DBMS", "Copy DBMS", "Transfer or copy DBMS", "Rename DBMS", "Change icon for DBMS"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByLabelText("Exam for DBMS")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Delete DBMS" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit options/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Transfer materials/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Swap or move this year/ })).toBeVisible();

    await userEvent.type(screen.getByLabelText("New subject name"), "OS");
    await userEvent.click(screen.getByRole("button", { name: /Add subject/ }));
    expect(uniApi.createNode).toHaveBeenCalledWith(expect.objectContaining({ kind: "subject", name: "OS" }));
    await userEvent.click(screen.getByRole("button", { name: "Open DBMS" }));
    expect(within(screen.getByLabelText("Supporter tools")).getByRole("button", { name: /Upload files/ })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Transfer or copy Unit 1" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("SUPPORTER · FOLDER");
  });

  it("explains a refused change when their supporter access has ended", async () => {
    const notify = vi.fn();
    uniApi.createNode.mockRejectedValue(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
    render(<UniversityPage active admin={false} supporter user={helper} notify={notify} onOpenFile={vi.fn()} />);
    await screen.findByRole("button", { name: "Open DBMS" });
    await userEvent.type(screen.getByLabelText("New subject name"), "OS");
    await userEvent.click(screen.getByRole("button", { name: /Add subject/ }));
    expect(notify).toHaveBeenCalledWith("You don't have permission to change the library. Ask the admin if you should be a supporter.");
  });

  it("gives students no library tools", async () => {
    render(<UniversityPage active admin={false} user={{ uid: "s1", email: "s@x.com" }} notify={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Open DBMS" })).toBeVisible();
    expect(libraryActor()).toBeNull();
    expect(screen.queryByLabelText("Supporter tools")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cut DBMS" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Transfer materials/ })).toBeNull();
  });

  it("keeps Delete and Edit options for the admin", async () => {
    render(<UniversityPage active admin user={{ uid: "ad", email: "aafthabali08@gmail.com" }} notify={vi.fn()} onOpenFile={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Delete DBMS" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Edit options/ })).toBeVisible();
    expect(screen.getByLabelText("Admin tools")).toBeVisible();
    expect(libraryActor()).toMatchObject({ uid: "ad", supporter: false });
  });
});

// ---- Admin: supporters and audit log ------------------------------------------------
async function openSection(name) {
  const notify = vi.fn();
  render(<AdminPage active notify={notify} />);
  expect(await screen.findByText("active now")).toBeVisible();
  await userEvent.click(within(screen.getByRole("navigation", { name: "Admin sections" })).getByRole("button", { name }));
  return notify;
}

describe("admin: supporters", () => {
  it("finds a registered user, makes them a supporter, then suspends and removes them", async () => {
    const notify = await openSection("Supporters");
    expect(screen.getByText("No supporters yet. Find a registered user above to add one.")).toBeVisible();
    await userEvent.type(screen.getByLabelText("Find a registered user by email"), "asha");
    await userEvent.click(await screen.findByRole("button", { name: "Make asha@college.edu a supporter" }));
    expect(api.addSupporter).toHaveBeenCalledWith(expect.objectContaining({ id: "u1", email: "asha@college.edu" }));
    expect(notify).toHaveBeenCalledWith("Asha is now a supporter.");
    expect(screen.getByText("Already a supporter")).toBeVisible();
    expect(screen.getByText("Current supporters · 1")).toBeVisible();
    const row = screen.getByRole("button", { name: "Manage supporter asha@college.edu" }).closest("tr");
    expect(within(row).getByText("Active now")).toBeVisible();
    expect(within(row).getByText("2")).toBeVisible(); // changes in the log

    await userEvent.click(screen.getByRole("button", { name: "Manage supporter asha@college.edu" }));
    expect(screen.getByRole("heading", { name: "Recent changes" })).toBeVisible();
    expect(screen.getByText("Uploaded “ER model.pdf” (4 pages) to “Unit 1”")).toBeVisible();
    const access = screen.getByLabelText("Access");
    await userEvent.type(within(access).getByLabelText("Reason (shown to the user)"), "Wrong uploads");
    await userEvent.selectOptions(within(access).getByLabelText("Suspend for"), "1 week");
    await userEvent.click(within(access).getByRole("button", { name: /Suspend/ }));
    expect(api.suspendUser).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), 7 * 864e5, "Wrong uploads");
    expect(within(access).getByText(/Suspended until .*Reason: Wrong uploads/)).toBeVisible();
    await userEvent.click(within(access).getByRole("button", { name: /End suspension/ }));
    expect(api.unbanUser).toHaveBeenCalledWith("u1");
    await userEvent.click(within(screen.getByLabelText("Access")).getByRole("button", { name: /Block/ }));
    expect(api.blockUser).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "");

    window.confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: /Remove supporter/ }));
    expect(api.removeSupporter).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Remove supporter/ }));
    expect(api.removeSupporter).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }));
    expect(notify).toHaveBeenLastCalledWith("Asha is no longer a supporter.");
    expect(screen.getByText("Current supporters · 0")).toBeVisible();
  });

  it("never offers the admin account as a supporter", async () => {
    await openSection("Supporters");
    await userEvent.type(screen.getByLabelText("Find a registered user by email"), "aaft");
    const match = (await screen.findByText("aafthabali08@gmail.com")).closest("li");
    expect(within(match).getByText("Admin", { selector: "small" })).toBeVisible();
    expect(within(match).queryByRole("button")).toBeNull();
  });

  it("makes or removes a supporter from a user's page too, with a badge in the list", async () => {
    api.adminSupporters.mockResolvedValue({ u2: { uid: "u2", email: "ravi@gmail.com", name: "Ravi", addedAt: minutesAgo(100) } });
    await openSection(/^Users/);
    const ravi = screen.getByRole("button", { name: "Open ravi@gmail.com" });
    expect(within(ravi).getByText("Supporter")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Open asha@college.edu" }));
    const role = screen.getByLabelText("Supporter role");
    await userEvent.click(within(role).getByRole("button", { name: /Make supporter/ }));
    expect(api.addSupporter).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }));
    expect(within(screen.getByLabelText("Supporter role")).getByRole("button", { name: /Remove supporter/ })).toBeVisible();
    // "View their changes" opens the audit log for them.
    await userEvent.click(within(screen.getByLabelText("Supporter role")).getByRole("button", { name: /View their changes/ }));
    expect(screen.getByRole("heading", { name: "Audit log" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 3 changes");
  });
});

describe("admin: audit log", () => {
  it("lists every change newest first and filters by supporter, change and text", async () => {
    await openSection("Audit log");
    const list = screen.getByRole("list", { name: "Changes" });
    const entries = within(list).getAllByRole("listitem").filter((li) => li.parentElement === list);
    expect(entries.map((li) => li.querySelector("p").textContent)).toEqual([
      "Uploaded “ER model.pdf” (4 pages) to “Unit 1”",
      "Transferred subject “DBMS” with 1 folder and 0 files inside from Year 1 to Year 2",
      "Renamed folder “U1” to “Unit 1”",
    ]);
    // A change to many items lists them.
    expect(within(entries[1]).getByText("2 items")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3 changes");

    // Former supporters stay in the filter.
    await userEvent.selectOptions(screen.getByLabelText("Supporter"), "former@college.edu");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 changes");
    await userEvent.selectOptions(screen.getByLabelText("Supporter"), "Everyone");
    await userEvent.selectOptions(screen.getByLabelText("Change"), "Transferred");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 changes");
    await userEvent.selectOptions(screen.getByLabelText("Change"), "All changes");
    await userEvent.type(screen.getByLabelText("Search the audit log"), "er model");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3 changes");
    await userEvent.clear(screen.getByLabelText("Search the audit log"));
    await userEvent.type(screen.getByLabelText("Search the audit log"), "nothing like this");
    expect(screen.getByText("No changes recorded match these filters.")).toBeVisible();
  });

  it("marks appeals from locked accounts and opens their access controls", async () => {
    api.adminBans.mockResolvedValue({ u2: { type: "blocked", until: null, reason: "Spam" } });
    api.adminTickets.mockResolvedValue([
      {
        id: "t1",
        uid: "u2",
        email: "ravi@gmail.com",
        name: "Ravi",
        subject: "Blocked account: please review",
        category: "Account or sign-in",
        appeal: true,
        banKind: "blocked",
        status: "open",
        messages: [{ from: "user", text: "It was a mistake", at: new Date().toISOString(), attachments: [] }],
        unreadForAdmin: true,
        createdAt: minutesAgo(3),
        updatedAt: minutesAgo(3),
      },
    ]);
    await openSection(/^Tickets/);
    const row = screen.getByRole("button", { name: /Blocked account: please review/ });
    expect(within(row).getByText("Appeal")).toBeVisible();
    await userEvent.click(row);
    expect(screen.getByText(/from the blocked account screen/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Manage their access/ }));
    expect(screen.getByRole("heading", { name: "Ravi" })).toBeVisible();
    await userEvent.click(within(screen.getByLabelText("Access")).getByRole("button", { name: /Unblock/ }));
    expect(api.unbanUser).toHaveBeenCalledWith("u2");
  });
});

// ---- The locked screen ------------------------------------------------------------
describe("blocked or suspended: Contact admin", () => {
  const user = { uid: "u9", email: "x@y.com", displayName: "X" };

  it("only raises a ticket (or logs out)", async () => {
    api.appealTicket.mockResolvedValue("t9");
    const onLogOut = vi.fn();
    const ban = { kind: "suspended", until: new Date(Date.now() + 864e5), reason: "Spam" };
    render(<BanScreen user={user} ban={ban} onLogOut={onLogOut} />);
    const screenBox = screen.getByRole("alertdialog", { name: "Your account is suspended." });
    expect(within(screenBox).getAllByRole("button").map((b) => b.textContent.trim())).toEqual(["Contact admin", "Log out"]);
    await userEvent.click(screen.getByRole("button", { name: /Contact admin/ }));
    const form = screen.getByRole("form", { name: "Contact admin" });
    expect(within(form).getByRole("button", { name: /Raise ticket/ })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Message to the admin"), "I didn't spam, please check.");
    await userEvent.click(within(form).getByRole("button", { name: /Raise ticket/ }));
    expect(api.appealTicket).toHaveBeenCalledWith(user, ban, "I didn't spam, please check.");
    expect(screen.getByRole("status")).toHaveTextContent("Ticket sent. The admin will review it");
    expect(screen.queryByRole("form")).toBeNull();
    expect(within(screenBox).getAllByRole("button").map((b) => b.textContent.trim())).toEqual(["Log out"]);
    await userEvent.click(screen.getByRole("button", { name: /Log out/ }));
    expect(onLogOut).toHaveBeenCalled();
  });

  it("keeps the message when sending fails, to try again", async () => {
    api.appealTicket.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("t9");
    render(<BanScreen user={user} ban={{ kind: "blocked", until: null, reason: "" }} onLogOut={vi.fn()} />);
    expect(screen.getByText("The StudyMind admin has blocked this account, so it can't be used.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Contact admin/ }));
    await userEvent.type(screen.getByLabelText("Message to the admin"), "Please unblock");
    await userEvent.click(screen.getByRole("button", { name: /Raise ticket/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Message to the admin")).toHaveValue("Please unblock");
    await userEvent.click(screen.getByRole("button", { name: /Raise ticket/ }));
    expect(api.appealTicket).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Ticket sent.");
  });
});
