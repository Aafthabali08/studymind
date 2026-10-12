import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_MS,
  SUSPEND_FOR,
  banState,
  blockUser,
  isActiveNow,
  suspendUser,
} from "../src/support";

describe("ban and activity helpers", () => {
  const now = new Date("2026-10-12T10:00:00Z").getTime();
  it("treats a block as permanent and a suspension as timed", () => {
    expect(banState(null, now)).toBeNull();
    expect(banState({ type: "blocked", until: null, reason: "Spam" }, now)).toEqual({
      kind: "blocked",
      until: null,
      reason: "Spam",
    });
    const until = new Date(now + 3600_000);
    expect(banState({ type: "suspended", until }, now)).toEqual({ kind: "suspended", until, reason: "" });
    // Firestore Timestamps are read too.
    expect(banState({ type: "suspended", until: { toDate: () => until } }, now)?.until).toEqual(until);
    expect(banState({ type: "suspended", until: new Date(now - 1) }, now)).toBeNull();
    expect(banState({ type: "suspended", until: null }, now)).toBeNull();
  });
  it("counts someone as active for 5 minutes after their last heartbeat", () => {
    expect(isActiveNow({ lastActive: new Date(now - 60_000) }, now)).toBe(true);
    expect(isActiveNow({ lastActive: new Date(now - ACTIVE_MS - 1) }, now)).toBe(false);
    expect(isActiveNow({}, now)).toBe(false);
    expect(SUSPEND_FOR.map(([label]) => label)).toEqual(["1 hour", "1 day", "3 days", "1 week", "30 days"]);
  });
  it("never blocks or suspends the admin account", async () => {
    const admin = { id: "a", email: "AafthabAli08@gmail.com" };
    await expect(blockUser(admin)).rejects.toThrow(/admin account/);
    await expect(suspendUser(admin, 1000)).rejects.toThrow(/admin account/);
  });
});

// ---- The admin page ---------------------------------------------------------------
const api = vi.hoisted(() => ({
  adminUsers: vi.fn(),
  adminBans: vi.fn(),
  blockUser: vi.fn(),
  suspendUser: vi.fn(),
  unbanUser: vi.fn(),
}));
vi.mock("../src/support", async (orig) => {
  const real = await orig();
  return {
    ...real,
    ...api,
    adminTickets: vi.fn(async () => []),
    adminFeedback: vi.fn(async () => []),
    loadGuidance: vi.fn(async () => []),
    // The pure helpers above are tested for real.
    blockUser: (...a) => (a[0]?.email?.toLowerCase?.() === "aafthabali08@gmail.com" ? real.blockUser(...a) : api.blockUser(...a)),
    suspendUser: (...a) => (a[0]?.email?.toLowerCase?.() === "aafthabali08@gmail.com" ? real.suspendUser(...a) : api.suspendUser(...a)),
  };
});
const { default: AdminPage } = await import("../src/AdminPage");

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const USERS = [
  { id: "u1", email: "asha@college.edu", name: "Asha", docCount: 2, createdAt: minutesAgo(9000), lastActive: minutesAgo(1) },
  { id: "u2", email: "ravi@gmail.com", name: "Ravi", docCount: 0, createdAt: minutesAgo(9000), lastActive: minutesAgo(600) },
  { id: "u3", email: "kiran@gmail.com", name: "Kiran", docCount: 1, createdAt: minutesAgo(9000), lastActive: minutesAgo(3000) },
  { id: "ad", email: "aafthabali08@gmail.com", name: "Admin", docCount: 0, createdAt: minutesAgo(9000), lastActive: minutesAgo(2) },
];
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.adminUsers.mockResolvedValue(USERS);
  api.adminBans.mockResolvedValue({ u3: { type: "blocked", until: null, reason: "Spam" } });
  api.blockUser.mockImplementation(async (u, reason) => ({ uid: u.id, type: "blocked", until: null, reason }));
  api.suspendUser.mockImplementation(async (u, ms, reason) => ({ uid: u.id, type: "suspended", until: new Date(Date.now() + ms), reason }));
  api.unbanUser.mockResolvedValue();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

async function openUsers() {
  const notify = vi.fn();
  render(<AdminPage active notify={notify} />);
  expect(await screen.findByText("active now")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Users/ }));
  return notify;
}
const row = (email) => screen.getByRole("button", { name: `Open ${email}` }).closest("tr");

it("shows who is active now and who is blocked, with filters", async () => {
  render(<AdminPage active notify={vi.fn()} />);
  const stats = await screen.findByText("active now");
  expect(stats.closest("div")).toHaveTextContent("2"); // Asha and the admin
  expect(screen.getByText("blocked or suspended").closest("div")).toHaveTextContent("1");
  await userEvent.click(screen.getByRole("button", { name: /^Users/ }));
  expect(within(row("asha@college.edu")).getByText("Active now")).toBeVisible();
  expect(within(row("ravi@gmail.com")).getByText("Offline")).toBeVisible();
  expect(within(row("kiran@gmail.com")).getByText("Blocked")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /^Active now · 2/ }));
  expect(screen.getByRole("button", { name: "Open asha@college.edu" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open ravi@gmail.com" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /^Blocked & suspended · 1/ }));
  expect(screen.getByRole("button", { name: "Open kiran@gmail.com" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Open asha@college.edu" })).toBeNull();
});

it("suspends a user for a chosen time with a reason, then ends it early", async () => {
  const notify = await openUsers();
  await userEvent.click(screen.getByRole("button", { name: "Open ravi@gmail.com" }));
  const access = screen.getByLabelText("Access");
  await userEvent.type(within(access).getByLabelText("Reason (shown to the user)"), "Spamming tickets");
  await userEvent.selectOptions(within(access).getByLabelText("Suspend for"), "3 days");
  await userEvent.click(within(access).getByRole("button", { name: /Suspend/ }));
  expect(api.suspendUser).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }), 3 * 864e5, "Spamming tickets");
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^Ravi is suspended until /));
  expect(screen.getAllByText(/Suspended until/).length).toBeGreaterThan(0);
  expect(within(access).getByText(/Reason: Spamming tickets/)).toBeVisible();

  await userEvent.click(within(access).getByRole("button", { name: /End suspension/ }));
  expect(api.unbanUser).toHaveBeenCalledWith("u2");
  expect(notify).toHaveBeenLastCalledWith("Ravi can use StudyMind again.");
  expect(within(access).getByRole("button", { name: /Block/ })).toBeVisible();
});

it("blocks a user after confirming, unblocks them, and protects the admin account", async () => {
  await openUsers();
  await userEvent.click(screen.getByRole("button", { name: "Open asha@college.edu" }));
  let access = screen.getByLabelText("Access");
  window.confirm.mockReturnValueOnce(false);
  await userEvent.click(within(access).getByRole("button", { name: /Block/ }));
  expect(api.blockUser).not.toHaveBeenCalled();
  await userEvent.click(within(access).getByRole("button", { name: /Block/ }));
  expect(api.blockUser).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "");
  expect(within(access).getByText("Blocked until you unblock them.")).toBeVisible();
  await userEvent.click(within(access).getByRole("button", { name: /Unblock/ }));
  expect(api.unbanUser).toHaveBeenCalledWith("u1");

  await userEvent.click(screen.getByRole("button", { name: "← All users" }));
  await userEvent.click(screen.getByRole("button", { name: "Open aafthabali08@gmail.com" }));
  expect(screen.getByText(/admin account; it can't be blocked/)).toBeVisible();
  expect(screen.queryByLabelText("Access")).toBeNull();
});
