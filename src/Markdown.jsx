import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/common";
import { Check, Copy, X, Maximize2 } from "lucide-react";

const LABELS = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  sql: "SQL",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  bash: "Shell",
  shell: "Shell",
  json: "JSON",
  go: "Go",
  rust: "Rust",
  kotlin: "Kotlin",
  php: "PHP",
  ruby: "Ruby",
};

/** Full-screen figure viewer. Close with ✕, Escape or a click outside. */
export function Lightbox({ image, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!image) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [image, onClose]);
  if (!image) return null;
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt || "Figure"}
      onClick={onClose}
    >
      <button
        ref={closeRef}
        className="lightbox-close"
        aria-label="Close figure"
        onClick={onClose}
      >
        <X size={22} />
      </button>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={image.src} alt={image.alt || "Figure"} />
        {image.alt && <figcaption>{image.alt}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
}

/** Fenced code block: language label, syntax highlighting, copy button. */
export function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  const { html, language } = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang))
        return {
          html: hljs.highlight(code, { language: lang }).value,
          language: lang,
        };
      const auto = hljs.highlightAuto(code);
      return { html: auto.value, language: lang || auto.language || "" };
    } catch {
      return { html: null, language: lang };
    }
  }, [code, lang]);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{LABELS[language] || language || "Code"}</span>
        <button
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          onClick={() =>
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        {html != null ? (
          // highlight.js escapes the source, so this markup is safe.
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

/**
 * Renders study Markdown: headings, paragraphs, lists, tables, code blocks and
 * figures. `![caption](image:ID)` resolves to an image extracted from the PDF.
 */
export default function Markdown({ children, images = [], onPage }) {
  const [zoomed, setZoomed] = useState(null);
  const closeZoom = useCallback(() => setZoomed(null), []);
  const byId = useMemo(
    () => Object.fromEntries(images.map((i) => [i.id, i])),
    [images],
  );
  const components = useMemo(
    () => ({
      pre({ children: child }) {
        const el = React.Children.toArray(child)[0];
        const className = el?.props?.className || "";
        const lang =
          /language-([\w+#-]+)/.exec(className)?.[1]?.toLowerCase() || "";
        const code = String(el?.props?.children ?? "").replace(/\n$/, "");
        return <CodeBlock code={code} lang={lang} />;
      },
      img({ src = "", alt = "" }) {
        const img = src.startsWith("image:") ? byId[src.slice(6)] : null;
        if (src.startsWith("image:") && !img) return null;
        const full = img ? img.dataUrl : src;
        return (
          <span className="md-figure">
            <button
              type="button"
              className="md-zoom"
              aria-label={`View full screen: ${alt || "figure"}`}
              onClick={() => setZoomed({ src: full, alt })}
            >
              <img src={full} alt={alt} loading="lazy" />
              <span className="zoom-hint" aria-hidden="true">
                <Maximize2 size={14} />
              </span>
            </button>
            {alt && (
              <span className="md-caption">
                {alt}
                {img && onPage && (
                  <button
                    type="button"
                    className="tag"
                    onClick={() => onPage(img.page)}
                  >
                    p. {img.page + 1}
                  </button>
                )}
              </span>
            )}
          </span>
        );
      },
      table({ children: rows }) {
        return (
          <div className="md-table">
            <table>{rows}</table>
          </div>
        );
      },
      a({ href, children: text }) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {text}
          </a>
        );
      },
    }),
    [byId, onPage],
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) =>
          url.startsWith("image:") ? url : defaultUrlTransform(url)
        }
      >
        {children || ""}
      </ReactMarkdown>
      <Lightbox image={zoomed} onClose={closeZoom} />
    </div>
  );
}
