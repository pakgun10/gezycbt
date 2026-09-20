import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { QuestionDraft, QuestionDraftContent } from "./domain";
import {
  QuestionReadinessService,
  validateQuestionReadiness,
} from "./readiness";

const REVISION_ID = "101" as Id;

describe("validateQuestionReadiness", () => {
  test("accepts a valid single choice and reports optional explanation as warning", () => {
    const report = validateQuestionReadiness(REVISION_ID, {
      type: "SINGLE_CHOICE",
      stimulusHtml: "",
      promptHtml: "Pilih jawaban",
      explanationHtml: null,
      options: [
        { id: "201" as Id, position: 1, contentHtml: "A", isCorrect: true },
        { id: "202" as Id, position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    });

    expect(report.isReady).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.issues[0]?.code).toBe("QUESTION_EXPLANATION_MISSING");
  });

  test("returns deterministic, field-addressable errors for a malformed choice", () => {
    const input: QuestionDraftContent = {
      type: "SINGLE_CHOICE",
      stimulusHtml: " ",
      promptHtml: null,
      explanationHtml: "",
      options: [
        { id: "202" as Id, position: 2, contentHtml: " ", isCorrect: true },
        { id: "201" as Id, position: 2, contentHtml: "B", isCorrect: true },
      ],
      statements: [],
    };
    const first = validateQuestionReadiness(REVISION_ID, input);
    const second = validateQuestionReadiness(REVISION_ID, input);

    expect(first).toEqual(second);
    expect(first.isReady).toBe(false);
    expect(first.errorCount).toBe(4);
    expect(first.issues.map((issue) => issue.code).sort()).toEqual(
      [
        "QUESTION_OPTION_POSITIONS_INVALID",
        "QUESTION_OPTION_CONTENT_REQUIRED",
        "QUESTION_PROMPT_REQUIRED",
        "QUESTION_SINGLE_CORRECT_COUNT_INVALID",
        "QUESTION_EXPLANATION_MISSING",
      ].sort(),
    );
    expect(
      first.issues.find(
        (issue) => issue.code === "QUESTION_OPTION_CONTENT_REQUIRED",
      ),
    ).toMatchObject({
      entityId: "202",
      fieldPath: "options[0].contentHtml",
      severity: "ERROR",
      message: expect.any(String),
      remediationHint: expect.any(String),
    });
  });

  test("requires at least one exact-match key for multiple response", () => {
    const report = validateQuestionReadiness(REVISION_ID, {
      type: "MULTIPLE_RESPONSE",
      stimulusHtml: "Stimulus",
      promptHtml: "Pilih semua",
      explanationHtml: "Pembahasan",
      options: [
        { position: 1, contentHtml: "A", isCorrect: false },
        { position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    });

    expect(report.isReady).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "QUESTION_MULTIPLE_CORRECT_REQUIRED",
    );
  });

  test("requires exactly three true/false statements and no prompt/options", () => {
    const report = validateQuestionReadiness(REVISION_ID, {
      type: "TRUE_FALSE",
      stimulusHtml: "Stimulus",
      promptHtml: "Tambahan",
      explanationHtml: "Pembahasan",
      options: [{ position: 1, contentHtml: "A", isCorrect: false }],
      statements: [
        {
          id: "301" as Id,
          position: 1,
          statementHtml: "Satu",
          correctValue: true,
        },
        {
          id: "302" as Id,
          position: 1,
          statementHtml: " ",
          correctValue: false,
        },
      ],
    });

    expect(report.isReady).toBe(false);
    expect(report.issues.map((issue) => issue.code).sort()).toEqual(
      [
        "QUESTION_TRUE_FALSE_OPTIONS_FORBIDDEN",
        "QUESTION_TRUE_FALSE_PROMPT_FORBIDDEN",
        "QUESTION_STATEMENTS_COUNT_INVALID",
        "QUESTION_STATEMENT_POSITIONS_INVALID",
        "QUESTION_STATEMENT_CONTENT_REQUIRED",
      ].sort(),
    );
  });

  test("keeps a warning non-blocking for a valid true/false question", () => {
    const report = validateQuestionReadiness(REVISION_ID, {
      type: "TRUE_FALSE",
      stimulusHtml: "Nilai pernyataan berikut.",
      promptHtml: null,
      explanationHtml: "Pembahasan",
      options: [],
      statements: [
        { position: 1, statementHtml: "Satu", correctValue: true },
        { position: 2, statementHtml: "Dua", correctValue: false },
        { position: 3, statementHtml: "Tiga", correctValue: true },
      ],
    });

    expect(report).toMatchObject({
      isReady: true,
      errorCount: 0,
      warningCount: 0,
    });
  });
});

describe("QuestionReadinessService", () => {
  test("validates the latest revision loaded from its repository", async () => {
    const revision = {
      id: REVISION_ID,
      type: "SINGLE_CHOICE",
      stimulusHtml: "Stimulus",
      promptHtml: "Prompt",
      explanationHtml: "Explanation",
      options: [
        { position: 1, contentHtml: "A", isCorrect: true },
        { position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    } as unknown as QuestionDraft;
    const service = new QuestionReadinessService({
      findRevision: async () => revision,
    });

    await expect(service.validateRevision(REVISION_ID)).resolves.toMatchObject({
      revisionId: REVISION_ID,
      isReady: true,
    });
  });

  test("returns null when the revision does not exist", async () => {
    const service = new QuestionReadinessService({
      findRevision: async () => null,
    });

    await expect(service.validateRevision(REVISION_ID)).resolves.toBeNull();
  });
});
