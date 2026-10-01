import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import AISettings from "../src/AISettings";
import { getAIState, updateSettings } from "../src/ai/engine";

afterEach(() => {
  updateSettings({ engine: "fast" });
  vi.unstubAllGlobals();
});
const reply = (text) => ({
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
                  `data: {"choices":[{"delta":{"content":"${text}"}}]}\n`,
                ),
              }),
      };
    },
  },
});

it("switches engines straight away, but a model server only after a successful test", async () => {
  updateSettings({ engine: "fast" });
  render(<AISettings onDone={() => {}} />);
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/Answering now: Instant/);
  await userEvent.click(screen.getByRole("radio", { name: /On-device open model/ }));
  expect(getAIState().settings.engine).toBe("local");
  await userEvent.click(screen.getByRole("radio", { name: /Instant/ }));

  // A failing server is not used, and the dialog suggests what to try.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).endsWith("/models")
        ? { ok: true, json: async () => ({ data: [{ id: "llama-3.3-70b-versatile" }] }) }
        : { ok: false, status: 404 },
    ),
  );
  await userEvent.click(screen.getByRole("radio", { name: /Your model server/ }));
  expect(getAIState().settings.engine).toBe("fast");
  expect(screen.getByText(/used only after the test connection succeeds/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Groq" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Test connection and use this server" }),
  );
  expect(await screen.findByText(/Not connected, so this server is not used/)).toBeVisible();
  expect(screen.getByText(/doesn't know the model/)).toBeVisible();
  expect(getAIState().settings.engine).toBe("fast");
  expect(screen.getByRole("button", { name: "Close" })).toBeVisible();

  // Picking a suggested model and passing the test switches to it.
  await userEvent.click(screen.getByRole("button", { name: "Try llama-3.3-70b-versatile" }));
  expect(screen.getByLabelText("Model name")).toHaveValue("llama-3.3-70b-versatile");
  vi.stubGlobal("fetch", vi.fn(async () => reply("ready")));
  await userEvent.click(
    screen.getByRole("button", { name: "Test connection and use this server" }),
  );
  expect(await screen.findByText(/Connected\. llama-3.3-70b-versatile replied "ready"/)).toBeVisible();
  expect(getAIState().settings).toMatchObject({
    engine: "remote",
    model: "llama-3.3-70b-versatile",
  });
  expect(screen.getByText(/Answering now:/)).toHaveTextContent(
    "llama-3.3-70b-versatile on your server",
  );
  expect(screen.getByRole("button", { name: "Save and close" })).toBeVisible();
});
