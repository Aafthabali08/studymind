import { it, expect, vi, beforeEach, afterEach } from "vitest";

const sse = (text) => ({
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
                  `data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(text)}}]}}]}\n`,
                ),
              }),
      };
    },
  },
});
let engine;
beforeEach(async () => {
  vi.stubEnv("VITE_GEMINI_API_KEY", "test-key");
  vi.resetModules();
  localStorage.clear();
  engine = await import("../src/ai/engine");
  engine.updateSettings({ engine: "remote", baseUrl: "http://127.0.0.1:1/v1", model: "llama" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("falls back to Gemini when the chosen model server can't be reached", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).startsWith("http://127.0.0.1:1")) throw new TypeError("Failed to fetch");
    return sse("From Gemini");
  });
  vi.stubGlobal("fetch", fetchMock);
  const text = await engine.generate([{ role: "user", content: "Hi" }]);
  expect(text).toBe("From Gemini");
  expect(fetchMock.mock.calls.map(([u]) => String(u).slice(0, 30))).toEqual([
    "http://127.0.0.1:1/v1/chat/com",
    "https://generativelanguage.goo",
  ]);
});

it("Ask Gemini (preferGemini) goes straight to Gemini whatever engine is chosen", async () => {
  const fetchMock = vi.fn(async () => sse("Straight to Gemini"));
  vi.stubGlobal("fetch", fetchMock);
  const text = await engine.generate(
    [{ role: "user", content: [{ text: "What is on my screen?" }] }],
    { preferGemini: true },
  );
  expect(text).toBe("Straight to Gemini");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage");
});
