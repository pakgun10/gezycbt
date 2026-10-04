import katex from "katex";
import sanitizeHtml from "sanitize-html";

export const RICH_CONTENT_LIMITS = {
  latexSource: 2_000,
  renderedLatex: 24_000,
} as const;

export type RichContentNode =
  | { readonly kind: "inline-math"; readonly latex: string }
  | { readonly kind: "block-math"; readonly latex: string }
  | { readonly kind: "question-media"; readonly placementKey: string };

export class RichContentValidationError extends Error {
  constructor(
    readonly code: "CONTENT_INVALID" | "LATEX_UNSAFE" | "LATEX_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "RichContentValidationError";
  }
}

const ALLOWED_TAGS = [
  "p",
  "br",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "sub",
  "sup",
  "span",
  "div",
  "figure",
] as const;

/**
 * Canonical server-side rich-content boundary. The browser may clean content
 * for UX, but this allowlist is the security boundary used by every writer.
 */
export function sanitizeRichContent(value: unknown, maxLength: number): string {
  if (typeof value !== "string")
    throw new RichContentValidationError(
      "CONTENT_INVALID",
      "Rich content harus berupa teks.",
    );
  const normalized = value.trim();
  if (normalized.length > maxLength)
    throw new RichContentValidationError(
      "CONTENT_INVALID",
      "Rich content melebihi batas panjang.",
    );
  const sanitized = sanitizeHtml(normalized, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      span: ["data-content-node", "data-latex"],
      div: ["data-content-node", "data-latex"],
      figure: ["data-content-node", "data-media-placement"],
    },
    allowedSchemes: [],
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  }).trim();
  assertCanonicalNodes(sanitized);
  return sanitized;
}

/**
 * Validates only bounded/safe LaTeX commands. Syntax is deliberately checked
 * separately by readiness so an invalid formula may remain in a draft.
 */
export function assertSafeLatexSource(value: string): string {
  const latex = value.trim();
  if (!latex || latex.length > RICH_CONTENT_LIMITS.latexSource)
    throw new RichContentValidationError(
      "LATEX_UNSAFE",
      "Formula LaTeX kosong atau terlalu panjang.",
    );
  if ([...latex].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 && code !== 0x09;
  }))
    throw new RichContentValidationError(
      "LATEX_UNSAFE",
      "Formula LaTeX mengandung control character.",
    );
  if (
    /\\(?:html|href|url|includegraphics|input|include|write|openout|read|def|gdef|edef|xdef|newcommand|renewcommand|catcode|csname|endcsname|usepackage|documentclass)\b/iu.test(
      latex,
    )
  )
    throw new RichContentValidationError(
      "LATEX_UNSAFE",
      "Perintah LaTeX tersebut tidak diizinkan.",
    );
  return latex;
}

/** Returns canonical custom nodes embedded in sanitized HTML. */
export function extractRichContentNodes(
  html: string,
): readonly RichContentNode[] {
  assertCanonicalNodes(html);
  const nodes: RichContentNode[] = [];
  const nodePattern =
    /<(span|div|figure)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu;
  for (const match of html.matchAll(nodePattern)) {
    const tag = match[1]?.toLowerCase();
    const attributes = match[2] ?? "";
    const node = readAttribute(attributes, "data-content-node");
    if (!node) continue;
    const body = (match[3] ?? "").trim();
    if (node === "inline-math" || node === "block-math") {
      if ((node === "inline-math" && tag !== "span") || (node === "block-math" && tag !== "div"))
        throw new RichContentValidationError(
          "CONTENT_INVALID",
          "Node matematika memiliki elemen canonical yang salah.",
        );
      if (body) {
        throw new RichContentValidationError(
          "CONTENT_INVALID",
          "Node matematika tidak boleh memiliki HTML turunan.",
        );
      }
      const latex = decodeAttribute(
        readAttribute(attributes, "data-latex") ?? "",
      );
      assertSafeLatexSource(latex);
      nodes.push({ kind: node, latex });
      continue;
    }
    if (node === "question-media") {
      if (tag !== "figure" || body) {
        throw new RichContentValidationError(
          "CONTENT_INVALID",
          "Placeholder media harus berupa figure kosong.",
        );
      }
      const placementKey = decodeAttribute(
        readAttribute(attributes, "data-media-placement") ?? "",
      );
      if (!/^[A-Za-z0-9_-]{8,128}$/u.test(placementKey))
        throw new RichContentValidationError(
          "CONTENT_INVALID",
          "Placement key media tidak valid.",
        );
      nodes.push({ kind: "question-media", placementKey });
    }
  }
  return nodes;
}

/** Readiness validation for formulas. It does not mutate or sanitize content. */
export function validateRichContentMath(
  html: string,
  fieldPath: string,
): readonly { readonly code: string; readonly fieldPath: string; readonly message: string }[] {
  const issues: { code: string; fieldPath: string; message: string }[] = [];
  let nodes: readonly RichContentNode[];
  try {
    nodes = extractRichContentNodes(html);
  } catch (error) {
    if (error instanceof RichContentValidationError) {
      issues.push({
        code: error.code,
        fieldPath,
        message: error.message,
      });
    }
    return issues;
  }
  nodes.forEach((node, index) => {
    if (node.kind === "question-media") return;
    try {
      const rendered = katex.renderToString(node.latex, {
        displayMode: node.kind === "block-math",
        throwOnError: true,
        trust: false,
        maxExpand: 100,
        maxSize: 10,
        output: "html",
      });
      if (rendered.length > RICH_CONTENT_LIMITS.renderedLatex)
        throw new RichContentValidationError(
          "LATEX_INVALID",
          "Hasil render formula terlalu besar.",
        );
    } catch (_error) {
      issues.push({
        code: "LATEX_INVALID",
        fieldPath,
        message: `Formula LaTeX ke-${index + 1} tidak valid atau terlalu kompleks.`,
      });
    }
  });
  return issues;
}

function assertCanonicalNodes(html: string): void {
  const customAttributes = /data-content-node\s*=\s*["']([^"']*)["']/giu;
  for (const match of html.matchAll(customAttributes)) {
    const node = match[1];
    if (node !== "inline-math" && node !== "block-math" && node !== "question-media")
      throw new RichContentValidationError(
        "CONTENT_INVALID",
        "Jenis content node tidak didukung.",
      );
  }
  const mediaAttributes = /data-media-placement\s*=\s*["']([^"']*)["']/giu;
  for (const match of html.matchAll(mediaAttributes)) {
    if (!/^[A-Za-z0-9_-]{8,128}$/u.test(decodeAttribute(match[1] ?? "")))
      throw new RichContentValidationError(
        "CONTENT_INVALID",
        "Placement key media tidak valid.",
      );
  }
  const latexAttributes = /data-latex\s*=\s*["']([^"']*)["']/giu;
  for (const match of html.matchAll(latexAttributes)) {
    assertSafeLatexSource(decodeAttribute(match[1] ?? ""));
  }
  extractNodeShapeOnly(html);
}

function extractNodeShapeOnly(html: string): void {
  const nodePattern =
    /<(span|div|figure)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu;
  for (const match of html.matchAll(nodePattern)) {
    const attributes = match[2] ?? "";
    const node = readAttribute(attributes, "data-content-node");
    const latex = readAttribute(attributes, "data-latex");
    const placement = readAttribute(attributes, "data-media-placement");
    if (!node) {
      if (latex !== null || placement !== null)
        throw new RichContentValidationError(
          "CONTENT_INVALID",
          "Atribut node rich content harus memiliki jenis node.",
        );
      continue;
    }
    const tag = match[1]?.toLowerCase();
    if (
      (node === "inline-math" || node === "block-math") &&
      latex === null
    )
      throw new RichContentValidationError(
        "CONTENT_INVALID",
        "Node matematika harus memiliki source LaTeX.",
      );
    if (node === "question-media" && placement === null)
      throw new RichContentValidationError(
        "CONTENT_INVALID",
        "Node media harus memiliki placement key.",
      );
    if (node !== "question-media" && placement !== null)
      throw new RichContentValidationError(
        "CONTENT_INVALID",
        "Placement key hanya boleh digunakan pada node media.",
      );
    if (node === "inline-math" && tag !== "span")
      throw new RichContentValidationError("CONTENT_INVALID", "Inline math node invalid.");
    if (node === "block-math" && tag !== "div")
      throw new RichContentValidationError("CONTENT_INVALID", "Block math node invalid.");
    if (node === "question-media" && tag !== "figure")
      throw new RichContentValidationError("CONTENT_INVALID", "Media node invalid.");
  }
}

function readAttribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*=\\s*["']([^"']*)["']`, "iu").exec(
    attributes,
  );
  return match?.[1] ?? null;
}

function decodeAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
