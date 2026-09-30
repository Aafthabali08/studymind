import { defineConfig } from "vitest/config";
export default defineConfig({
  // Never load .env.local in tests: real Firebase/Gemini keys must not be used.
  envDir: "./tests/fixtures",
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    restoreMocks: true,
    execArgv: ["--no-experimental-webstorage"],
  },
  esbuild: { jsx: "automatic" },
});
