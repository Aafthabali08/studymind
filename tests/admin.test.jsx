import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, beforeEach } from "vitest";
import AdminPage from "../src/AdminPage";
import SupportPage from "../src/SupportPage";
import FeedbackButtons from "../src/FeedbackButtons";
import * as support from "../src/support";
import { learningNotes, setLearning } from "../src/ai/memory";
vi.mock("../src/imageUtils", async (importOriginal) => ({
  ...(await importOriginal()),
  compressImage: vi.fn(async (file) => ({
    dataUrl: "data:image/jpeg;base64,QUJD",
    width: 800,
    height: 600,
    name: file.name,
  })),
}));

const authState = vi.hoisted(() => ({ user: null }));
vi.mock("../src/auth", () => ({ useAuth: () => authState }));
vi.mock("../src/support", async (importOriginal) => {
  const real = await importOriginal();
  const d = (s) => new Date(s);
  return {
    ...real,
    adminUsers: vi.fn(async ({ search = "" } = {}) =>
      [
        {
          id: "u1",
          email: "asha@college.edu",
          name: "Asha",
          docCount: 4,
          createdAt: d("2026-09-01"),
          lastActive: d("2026-09-27"),
        },
        {
          id: "u2",
          email: "ravi@gmail.com",
          name: "Ravi",
          docCount: 1,
          createdAt: d("2026-09-10"),
          lastActive: d("2026-09-20"),
        },
      ].filter((u) => u.email.startsWith(search.toLowerCase())),
    ),
    adminTickets: vi.fn(async () => [
      {
        id: "t1",
        uid: "u1",
        email: "asha@college.edu",
        subject: "Wrong 8-mark answer",
        category: "Wrong or poor AI answer",
        status: "open",
        unreadForAdmin: true,
        messages: [
          { from: "user", text: "Q3 is wrong", at: "2026-09-27T10:00:00Z" },
        ],
        updatedAt: d("2026-09-27"),
      },
    ]),
    adminFeedback: vi.fn(async () => [
      {
        id: "f1",
        uid: "u1",
        email: "asha@college.edu",
        kind: "question",
        verdict: "wrong",
        item: "Define AI.",
        comment: "Too short",
        reviewed: false,
        createdAt: d("2026-09-27"),
      },
      {
        id: "f2",
        uid: "u2",
        email: "ravi@gmail.com",
        kind: "notes",
        verdict: "correct",
        item: "Notes",
        comment: "",
        reviewed: false,
        createdAt: d("2026-09-26"),
      },
    ]),
    loadGuidance: vi.fn(async () => []),
    saveGuidance: vi.fn(async () => {}),
    setTicketStatus: vi.fn(async () => {}),
    replyToTicket: vi.fn(async (t, from, text) => ({
      from,
      text,
      at: new Date().toISOString(),
    })),
    notifyUser: vi.fn(async () => {}),
    markTicketRead: vi.fn(async () => {}),
    markFeedbackReviewed: vi.fn(async () => {}),
    createTicket: vi.fn(async () => "t9"),
    loadAttachments: vi.fn(async () => ({
      a1: {
        id: "a1",
        dataUrl: "data:image/jpeg;base64,AAA",
        name: "error.png",
      },
    })),
    myTickets: vi.fn(async () => []),
    sendFeedback: vi.fn(async (user, { verdict, item, comment }) =>
      verdict === "wrong"
        ? {
            avoid: [`Question bank: ${item} — user says: ${comment}`],
            good: [],
          }
        : { avoid: [], good: [item] },
    ),
  };
});

beforeEach(() => {
  authState.user = {
    uid: "u1",
    email: "asha@college.edu",
    displayName: "Asha",
    emailVerified: true,
  };
  setLearning({ avoid: [], good: [], guidance: [] });
});

it("only treats the verified admin email as admin", () => {
  expect(
    support.isAdminUser({
      email: "aafthabali08@gmail.com",
      emailVerified: true,
    }),
  ).toBe(true);
  expect(
    support.isAdminUser({
      email: "AAFTHABALI08@gmail.com",
      emailVerified: true,
    }),
  ).toBe(true);
  expect(
    support.isAdminUser({
      email: "aafthabali08@gmail.com",
      emailVerified: false,
    }),
  ).toBe(false);
  expect(
    support.isAdminUser({ email: "someone@gmail.com", emailVerified: true }),
  ).toBe(false);
  expect(support.isAdminUser(null)).toBe(false);
});

it("shows overview stats, searches users by email with document counts", async () => {
  const notify = vi.fn();
  render(<AdminPage active notify={notify} />);
  const stats = await screen.findByText("active this week");
  expect(stats).toBeVisible();
  expect(screen.getByText("documents").previousSibling).toHaveTextContent("5");
  expect(
    screen.getByText(/^AI marked correct/).previousSibling,
  ).toHaveTextContent("50%");
  // Ticket counts: received, open, fixed, closed; each opens the ticket list.
  const received = screen.getByText("received").closest("button");
  expect(received).toHaveTextContent("1");
  expect(screen.getByText("open").closest("button")).toHaveTextContent("1");
  expect(screen.getByText("fixed").closest("button")).toHaveTextContent("0");
  expect(screen.getByText("closed").closest("button")).toHaveTextContent("0");
  await userEvent.click(screen.getByText("open").closest("button"));
  expect(screen.getByRole("button", { name: /Wrong 8-mark answer/ })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /^Overview/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Users/ }));
  expect(
    screen.getByRole("button", { name: "Open ravi@gmail.com" }),
  ).toBeVisible();
  await userEvent.type(screen.getByLabelText("Search users by email"), "asha");
  await waitFor(() =>
    expect(support.adminUsers).toHaveBeenLastCalledWith({ search: "asha" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Open ravi@gmail.com" }),
    ).not.toBeInTheDocument(),
  );
  const row = screen
    .getByRole("button", { name: "Open asha@college.edu" })
    .closest("tr");
  expect(within(row).getByText("4")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Open asha@college.edu" }),
  );
  expect(screen.getByRole("heading", { name: "Asha" })).toBeVisible();
  expect(screen.getByText("Wrong 8-mark answer")).toBeVisible();
});

it("updates a ticket status, messages the user and turns feedback into AI guidance", async () => {
  const notify = vi.fn();
  render(<AdminPage active notify={notify} />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Tickets/ }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /Wrong 8-mark answer/ }),
  );
  expect(support.markTicketRead).toHaveBeenCalled();
  expect(screen.getByText("Q3 is wrong")).toBeVisible();
  await userEvent.type(
    screen.getByLabelText("Message to the user"),
    "Fixed in the new question bank.",
  );
  const actions = screen.getByRole("group", { name: "Ticket status" });
  expect(
    within(actions).getByRole("button", { name: "Reopen" }),
  ).toBeDisabled(); // the ticket is already open
  await userEvent.click(
    within(actions).getByRole("button", { name: "✓ Mark fixed" }),
  );
  expect(support.setTicketStatus).toHaveBeenCalledWith(
    expect.objectContaining({ id: "t1" }),
    "resolved",
    "Fixed in the new question bank.",
  );
  expect(notify).toHaveBeenCalledWith(
    expect.stringMatching(/Fixed; the user was notified/),
  );
  // Opening and answering the ticket clears its unread badge in the overview.
  await userEvent.click(screen.getByRole("button", { name: /^Overview/ }));
  expect(screen.getByText("unread replies").closest("button")).toHaveTextContent("0");
  expect(screen.getByText("fixed").closest("button")).toHaveTextContent("1");
  await userEvent.click(screen.getByRole("button", { name: /^Feedback/ }));
  expect(screen.getByText("Define AI.")).toBeVisible();
  expect(
    screen.queryByText("Notes", { selector: "blockquote" }),
  ).not.toBeInTheDocument(); // filtered to ✗ wrong
  await userEvent.click(
    screen.getByRole("button", { name: /Add as AI guidance/ }),
  );
  expect(support.saveGuidance).toHaveBeenCalledWith([
    "In Question bank: Too short",
  ]);
  expect(learningNotes()).toMatch(
    /Rules from the StudyMind team[\s\S]*Too short/,
  );
});

it("lets a user raise a ticket in the complaint box", async () => {
  const notify = vi.fn();
  render(<SupportPage active user={authState.user} notify={notify} />);
  await userEvent.selectOptions(
    screen.getByLabelText("Category"),
    "Upload or PDF problem",
  );
  await userEvent.type(screen.getByLabelText("Subject"), "PDF won't upload");
  await userEvent.type(
    screen.getByLabelText("What happened?"),
    "My 30 MB lecture PDF fails every time.",
  );
  await userEvent.click(screen.getByRole("button", { name: /Send ticket/ }));
  expect(support.createTicket).toHaveBeenCalledWith(authState.user, {
    category: "Upload or PDF problem",
    subject: "PDF won't upload",
    message: "My 30 MB lecture PDF fails every time.",
    images: [],
  });
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Ticket sent/));
});

it("records ✓ / ✗ feedback and feeds it into Gemini's memory", async () => {
  const onVerdict = vi.fn();
  render(
    <FeedbackButtons kind="question" item="Define AI." onVerdict={onVerdict} />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Wrong/ }));
  await userEvent.type(screen.getByLabelText("What was wrong?"), "Too short");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onVerdict).toHaveBeenCalledWith("wrong"));
  expect(screen.getByText(/StudyMind will learn from this/)).toBeVisible();
  expect(learningNotes()).toMatch(
    /marked these outputs as WRONG[\s\S]*Define AI\. — user says: Too short/,
  );
});

it("attaches optional pictures to a ticket and shows them to the admin full screen", async () => {
  const notify = vi.fn();
  render(<SupportPage active user={authState.user} notify={notify} />);
  await userEvent.type(screen.getByLabelText("Subject"), "Upload fails");
  await userEvent.type(
    screen.getByLabelText("What happened?"),
    "It shows an error on page 3.",
  );
  const shot = new File(["x"], "error.png", { type: "image/png" });
  await userEvent.upload(screen.getByLabelText("Choose pictures to attach"), [
    shot,
    new File(["y"], "two.png", { type: "image/png" }),
  ]);
  const previews = await screen.findByRole("list", {
    name: "Attached pictures",
  });
  expect(within(previews).getAllByRole("img")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "Remove two.png" }));
  expect(within(previews).getAllByRole("img")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: /Send ticket/ }));
  expect(support.createTicket).toHaveBeenLastCalledWith(
    authState.user,
    expect.objectContaining({
      images: [expect.objectContaining({ name: "error.png" })],
    }),
  );
  expect(notify).toHaveBeenCalledWith(
    expect.stringMatching(/Ticket sent with 1 picture/),
  );

  // Admin side: the picture appears in the thread and opens full screen.
  vi.mocked(support.adminTickets).mockResolvedValueOnce([
    {
      id: "t2",
      uid: "u1",
      email: "asha@college.edu",
      subject: "Upload fails",
      category: "Upload or PDF problem",
      status: "open",
      messages: [
        {
          from: "user",
          text: "See screenshot",
          at: "2026-09-28T10:00:00Z",
          attachments: ["a1"],
        },
      ],
      updatedAt: new Date(),
    },
  ]);
  render(<AdminPage active notify={notify} />);
  await userEvent.click(
    await screen.findByRole("button", { name: /^Tickets/ }),
  );
  expect(screen.getByLabelText("1 pictures")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /Upload fails/ }));
  const thumb = await screen.findByRole("button", {
    name: "View picture 1 full screen",
  });
  await userEvent.click(thumb);
  expect(screen.getByRole("dialog", { name: "error.png" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Close figure" }));
  expect(
    screen.queryByRole("dialog", { name: "error.png" }),
  ).not.toBeInTheDocument();
});

it("pastes a screenshot into a reply", async () => {
  vi.mocked(support.myTickets).mockResolvedValueOnce([
    {
      id: "t3",
      uid: "u1",
      subject: "Question",
      category: "Other",
      status: "open",
      messages: [{ from: "user", text: "Hi", at: "2026-09-28T10:00:00Z" }],
      updatedAt: new Date(),
    },
  ]);
  const notify = vi.fn();
  render(
    <SupportPage
      active
      user={authState.user}
      notify={notify}
      openTicketId="t3"
    />,
  );
  const input = await screen.findByLabelText("Reply to the team");
  const file = new File(["z"], "paste.png", { type: "image/png" });
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  paste.clipboardData = {
    items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
  };
  input.dispatchEvent(paste);
  expect(await screen.findByRole("img", { name: "paste.png" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Send reply" }));
  expect(support.replyToTicket).toHaveBeenCalledWith(
    expect.objectContaining({ id: "t3" }),
    "user",
    "",
    [expect.objectContaining({ name: "paste.png" })],
  );
});
