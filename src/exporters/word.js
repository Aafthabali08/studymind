// Blocks (see blocks.js) → a styled Word document with the docx library:
// the same structure as the PDF, using real Word styles (Title, Heading 1-4,
// bullet and numbered lists, tables, code in Consolas on a shaded box,
// quotes and callouts with a coloured left border) so it can be edited and
// re-styled in Word. docx loads on first use.
import { inlineRuns } from "./blocks";

const C = {
  ink: "1E2026",
  muted: "6E727C",
  accent: "2563EB",
  star: "B47800",
  starSoft: "FFF7E0",
  trick: "784800",
  rule: "E2E4E9",
  codeBg: "F5F6F8",
  codeInk: "242936",
  inlineCode: "AA2846",
  quoteBg: "F7F8FA",
  tableHead: "ECF1FA",
  tableZebra: "FAFBFC",
};
const FONT = "Calibri",
  MONO = "Consolas";

const base64Bytes = (dataUrl) => {
  const match = /^data:image\/(jpe?g|png);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type: match[1] === "png" ? "png" : "jpg" };
};

/** Renders blocks; resolves with a Blob (or a Buffer with { buffer: true }). */
export async function renderWord(blocks, { images = [], title = "StudyMind", buffer = false } = {}) {
  const d = await import("docx");
  const {
    AlignmentType,
    BorderStyle,
    Document,
    Footer,
    HeadingLevel,
    ImageRun,
    LevelFormat,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = d;

  const runsOf = (md, extra = {}, plain = false) =>
    (plain ? [{ text: md }] : inlineRuns(md)).flatMap((r) =>
      String(r.text)
        .split("\n")
        .map(
          (part, k) =>
            new TextRun({
              text: part,
              break: k ? 1 : 0,
              bold: r.bold || extra.bold,
              italics: r.italic || extra.italics,
              color: r.code ? C.inlineCode : r.color || extra.color,
              size: extra.size,
              font: r.code ? MONO : undefined,
              shading: r.code
                ? { type: ShadingType.CLEAR, fill: C.codeBg, color: "auto" }
                : undefined,
            }),
        ),
    );
  const box = (fill, bar) => ({
    shading: { type: ShadingType.CLEAR, fill, color: "auto" },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: bar, space: 8 } },
    indent: { left: 160, right: 160 },
  });
  const shown = new Set();
  // Ordered lists restart at 1 after anything that isn't a list item.
  let instance = 0,
    inList = false;
  for (const b of blocks) {
    if (b.type === "li" && b.ordered) {
      if (!inList) instance++;
      b.list = instance;
      inList = true;
    } else if (b.type !== "li") inList = false;
  }

  const children = [];
  for (const b of blocks) {
    switch (b.type) {
      case "title":
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runsOf(b.text) }));
        break;
      case "subtitle":
        children.push(
          new Paragraph({
            spacing: { after: 60 },
            children: runsOf(b.text, { bold: true, color: C.accent, size: 26 }),
          }),
        );
        break;
      case "meta":
        children.push(
          new Paragraph({
            spacing: { after: 280 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.rule, space: 8 } },
            children: runsOf(b.text, { color: C.muted, size: 18 }),
          }),
        );
        break;
      case "h":
        children.push(
          new Paragraph({
            heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(3, b.level - 1)],
            children: runsOf(b.text),
          }),
        );
        break;
      case "p":
        children.push(new Paragraph({ children: runsOf(b.text, {}, b.plain) }));
        break;
      case "li":
        children.push(
          new Paragraph({
            children: runsOf(b.text),
            ...(b.ordered
              ? { numbering: { reference: "numbers", level: b.indent, instance: b.list ?? 0 } }
              : { bullet: { level: b.indent } }),
            spacing: { after: 60 },
          }),
        );
        break;
      case "quote":
        children.push(
          new Paragraph({
            ...box(C.quoteBg, C.accent),
            children: runsOf(b.text, { italics: true, color: "3C404A" }),
          }),
        );
        break;
      case "callout":
        children.push(
          new Paragraph({
            ...box(C.starSoft, C.star),
            spacing: { before: 120, after: 200 },
            children: [
              new TextRun({ text: `${b.label.toUpperCase()}`, bold: true, color: C.star, size: 16 }),
              new TextRun({ text: "", break: 1 }),
              ...runsOf(b.text, { color: C.trick }),
            ],
          }),
        );
        break;
      case "code": {
        const lines = b.text.replace(/\t/g, "    ").split("\n");
        children.push(
          new Paragraph({
            style: "Code",
            children: [
              ...(b.lang
                ? [
                    new TextRun({ text: b.lang.toUpperCase(), bold: true, color: C.muted, size: 14, font: FONT }),
                    new TextRun({ text: "", break: 1 }),
                  ]
                : []),
              ...lines.map((l, k) => new TextRun({ text: l || " ", break: k ? 1 : 0 })),
            ],
          }),
        );
        break;
      }
      case "table": {
        const cols = Math.max(...b.rows.map((r) => r.length));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: b.rows.map(
              (row, r) =>
                new TableRow({
                  tableHeader: r === 0,
                  children: Array.from({ length: cols }, (_, c) =>
                    new TableCell({
                      shading:
                        r === 0
                          ? { type: ShadingType.CLEAR, fill: C.tableHead, color: "auto" }
                          : r % 2 === 0
                            ? { type: ShadingType.CLEAR, fill: C.tableZebra, color: "auto" }
                            : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                      children: [
                        new Paragraph({
                          spacing: { after: 0 },
                          children: runsOf(row[c] || "", { bold: r === 0, size: 19 }),
                        }),
                      ],
                    }),
                  ),
                }),
            ),
          }),
          new Paragraph({ spacing: { after: 120 }, children: [] }),
        );
        break;
      }
      case "image": {
        const img = b.img || images.find((i) => i.id === b.id);
        const data = base64Bytes(img?.dataUrl);
        if (!data) break;
        shown.add(img.id);
        // About 150 dpi like the PDF, at most ~16 cm wide.
        const width = Math.min(600, Math.max(170, (img.width || 600) * 0.64));
        const height = Math.round(width * ((img.height || 1) / (img.width || 1)));
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 40 },
            children: [new ImageRun({ type: data.type, data: data.bytes, transformation: { width, height } })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: runsOf(
              `Figure from page ${img.page + 1}${b.caption || img.caption ? `: ${b.caption || img.caption}` : ""}`,
              { italics: true, color: C.muted, size: 17 },
              true,
            ),
          }),
        );
        break;
      }
      case "question":
        children.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 240, after: 40 },
            children: [
              new TextRun({ text: `Q${b.n}.  `, bold: true, color: C.accent, size: 24 }),
              ...runsOf(b.text, { bold: true, size: 24 }),
            ],
          }),
          new Paragraph({
            keepNext: true,
            spacing: { after: 120 },
            children: [
              ...(b.important ? [new TextRun({ text: "★ IMPORTANT   ", bold: true, color: C.star, size: 16 })] : []),
              new TextRun({ text: b.meta || "", color: C.muted, size: 16 }),
            ],
          }),
        );
        break;
      case "label":
        children.push(
          new Paragraph({
            keepNext: true,
            spacing: { after: 60 },
            children: [new TextRun({ text: b.text.toUpperCase(), bold: true, color: C.muted, size: 15 })],
          }),
        );
        break;
      case "rule":
        children.push(
          new Paragraph({
            spacing: { after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 4 } },
            children: [],
          }),
        );
        break;
      case "pagebreak":
        children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
        break;
    }
  }

  const heading = (size, color, before) => ({
    run: { font: FONT, size, bold: true, color },
    paragraph: { spacing: { before, after: 80 }, keepNext: true },
  });
  const word = new Document({
    creator: "StudyMind",
    title,
    styles: {
      default: {
        document: { run: { font: FONT, size: 21, color: C.ink }, paragraph: { spacing: { after: 140, line: 288 } } },
        title: { run: { font: FONT, size: 44, bold: true, color: C.ink }, paragraph: { spacing: { after: 60 } } },
        heading1: { ...heading(32, C.ink, 360), paragraph: { spacing: { before: 360, after: 120 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.accent, space: 4 } } } },
        heading2: heading(27, C.ink, 280),
        heading3: heading(24, C.accent, 220),
        heading4: heading(22, "3C404A", 180),
      },
      paragraphStyles: [
        {
          id: "Code",
          name: "Code",
          basedOn: "Normal",
          run: { font: MONO, size: 17, color: C.codeInk },
          paragraph: {
            spacing: { before: 80, after: 200, line: 260 },
            shading: { type: ShadingType.CLEAR, fill: C.codeBg, color: "auto" },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 6 },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 6 },
              left: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 6 },
              right: { style: BorderStyle.SINGLE, size: 4, color: C.rule, space: 6 },
            },
            indent: { left: 120, right: 120 },
          },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "numbers",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${title} · Page `, color: C.muted, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: C.muted, size: 16 }),
                  new TextRun({ text: " of ", color: C.muted, size: 16 }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: C.muted, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return buffer ? { buffer: await Packer.toBuffer(word), shown } : { blob: await Packer.toBlob(word), shown };
}
