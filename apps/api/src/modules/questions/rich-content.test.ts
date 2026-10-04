import { describe, expect, test } from "bun:test";
import { hashCanonicalQuestion } from "./content-hash";
import {
  assertSafeLatexSource,
  extractRichContentNodes,
  RichContentValidationError,
  sanitizeRichContent,
  validateRichContentMath,
} from "./rich-content";

const choiceContent = {
  type: "SINGLE_CHOICE" as const,
  stimulusHtml: "<p>Stimulus</p>",
  promptHtml: "<p>Pilih</p>",
  explanationHtml: null,
  options: [
    { position: 1, contentHtml: "<p>A</p>", isCorrect: true },
    { position: 2, contentHtml: "<p>B</p>", isCorrect: false },
  ],
  statements: [],
};

describe("rich question content", () => {
  test("sanitizes markup while preserving canonical math and media nodes", () => {
    const value = sanitizeRichContent(
      '<p onclick="alert(1)">A<script>alert(1)</script><span data-content-node="inline-math" data-latex="x^2"></span><figure data-content-node="question-media" data-media-placement="placement-12345678"></figure></p>',
      100_000,
    );

    expect(value).not.toContain("onclick");
    expect(value).not.toContain("<script");
    expect(extractRichContentNodes(value)).toEqual([
      { kind: "inline-math", latex: "x^2" },
      { kind: "question-media", placementKey: "placement-12345678" },
    ]);
  });

  test("rejects node attributes without a canonical node", () => {
    expect(() =>
      sanitizeRichContent('<p><span data-latex="x^2">x</span></p>', 1_000),
    ).toThrow(RichContentValidationError);
  });

  test("blocks unsafe LaTeX commands and reports invalid formulas", () => {
    expect(() =>
      assertSafeLatexSource("\\href{https://example.com}{x}"),
    ).toThrow(RichContentValidationError);
    expect(
      validateRichContentMath(
        '<p><span data-content-node="inline-math" data-latex="\\frac{1}{2}"></span></p>',
        "promptHtml",
      ),
    ).toEqual([]);
    expect(
      validateRichContentMath(
        '<p><span data-content-node="inline-math" data-latex="\\frac{"></span></p>',
        "promptHtml",
      ),
    ).toHaveLength(1);
  });

  test("changes the canonical hash when media metadata changes", async () => {
    const withoutMedia = await hashCanonicalQuestion(choiceContent);
    const withMedia = await hashCanonicalQuestion(choiceContent, [
      {
        placementKey: "placement-12345678",
        mediaAssetId: "9",
        usage: "STIMULUS",
        sortOrder: 0,
        altText: "Diagram",
        isDecorative: false,
        displayWidthPercent: 80,
        alignment: "CENTER",
      },
    ]);
    expect(Buffer.from(withoutMedia).toString("hex")).not.toBe(
      Buffer.from(withMedia).toString("hex"),
    );
  });
});
