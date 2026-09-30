import React from "react";
import { render, screen, act } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("tells the user when Gemini switches to a backup model, then clears it", async () => {
  vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
  vi.resetModules();
  const { default: Thinking } = await import("../src/Thinking");
  const { streamGemini } = await import("../src/ai/gemini");
  let release;
  const backup = new Promise((resolve) => (release = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      url.includes("gemini-3.8-flash")
        ? {
            ok: false,
            status: 429,
            json: async () => ({
              error: { message: "quota", details: [{ retryDelay: "27s" }] },
            }),
          }
        : backup,
    ),
  );
  render(<Thinking label="Writing notes…" />);
  let reply;
  await act(async () => {
    reply = streamGemini([{ role: "user", content: "Hi" }]);
  });
  expect(
    await screen.findByText(/Switching to gemini-3\.5-flash/),
  ).toBeInTheDocument();

  await act(async () => {
    release({
      ok: true,
      status: 200,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () =>
              sent
                ? { done: true }
                : ((sent = true),
                  {
                    done: false,
                    value: new TextEncoder().encode(
                      'data: {"candidates":[{"content":{"parts":[{"text":"Done"}]}}]}\n',
                    ),
                  }),
          };
        },
      },
    });
    await reply;
  });
  expect(await reply).toBe("Done");
  expect(screen.queryByText(/Switching to/)).not.toBeInTheDocument();
});
