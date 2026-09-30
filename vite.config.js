import { defineConfig } from "vite";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  // Pre-bundle every library up front, including ones only used by pages that
  // load on demand. Otherwise Vite re-optimises mid-session in development,
  // reloads the page and can load two copies of React.
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "lucide-react",
      "react-markdown",
      "remark-gfm",
      "highlight.js/lib/common",
      "react-dom",
      "pdfjs-dist",
      // Imported from Web Workers; pre-bundled so the first upload or model
      // load never makes the dev server re-optimise and reload the page.
      "pdfjs-dist/build/pdf.worker.min.mjs",
      "@huggingface/transformers",
      "mammoth",
      "tesseract.js",
      "firebase/app",
      "firebase/auth",
      "firebase/firestore",
      "firebase/ai",
      "firebase/app-check",
    ],
  },
  worker: { format: "es" },
});
