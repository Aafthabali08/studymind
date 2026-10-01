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

it("the chosen engine answers, and says when Gemini had to take over", async () => {
  const names = [];
  const fetchMock = vi.fn(async (url) => {
    if (String(url).startsWith("http://127.0.0.1:1")) throw new TypeError("Failed to fetch");
    return sse("From Gemini");
  });
  vi.stubGlobal("fetch", fetchMock);
  await engine.generate([{ role: "user", content: "Hi" }], {
    onEngine: (n) => names.push(n),
  });
  expect(names).toEqual([
    "llama on your server",
    expect.stringMatching(/^Gemini .*because llama on your server did not answer/),
  ]);
  // Switching to Gemini: Gemini answers directly.
  engine.updateSettings({ engine: "gemini" });
  fetchMock.mockClear();
  names.length = 0;
  await engine.generate([{ role: "user", content: "Hi" }], {
    onEngine: (n) => names.push(n),
  });
  expect(names).toEqual([expect.stringMatching(/^Gemini \(/)]);
  expect(String(fetchMock.mock.calls[0][0])).toContain("generativelanguage");
});

it("a test connection never falls back to Gemini, and suggests what to try", async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url).endsWith("/models"))
      return { ok: true, json: async () => ({ data: [{ id: "llama" }, { id: "qwen2.5" }] }) };
    return { ok: false, status: 404 };
  });
  vi.stubGlobal("fetch", fetchMock);
  const error = await engine
    .testConnection({ baseUrl: "http://llm.test/v1/", model: "llama", apiKey: "" })
    .catch((e) => e);
  expect(error.message).toMatch(/returned 404/);
  expect(error.advice).toMatch(/doesn't know the model "llama"/);
  expect(error.models).toEqual(["qwen2.5"]);
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes("generativelanguage"))).toBe(false);
});

it("only switches to a model server that passed its test, and forgets an unverified one", async () => {
  engine.switchToServer({ baseUrl: "http://llm.test/v1/", model: "llama", apiKey: "" });
  expect(engine.getAIState().settings).toMatchObject({ engine: "remote", baseUrl: "http://llm.test/v1" });
  expect(engine.serverVerified()).toBe(true);
  // An unverified server saved earlier is not used after a reload.
  localStorage.setItem(
    "studymind-ai",
    JSON.stringify({ engine: "remote", chosen: true, baseUrl: "http://x/v1", model: "m" }),
  );
  vi.resetModules();
  const fresh = await import("../src/ai/engine");
  expect(fresh.getAIState().settings.engine).toBe("gemini");
});

it("drops page citations that the retrieved excerpts don't support", () => {
  const text = "[p. 3] Backprop uses the chain rule [p. 3].\n\n[p. 9] Gradient descent updates weights [p. 12].";
  expect(engine.keepRealCitations(text, new Set([3]))).toBe(
    "[p. 3] Backprop uses the chain rule [p. 3].\n\nGradient descent updates weights.",
  );
});
