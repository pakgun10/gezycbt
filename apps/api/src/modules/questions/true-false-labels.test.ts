import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { participantManifest } from "../exam-sessions/domain";
import { canonicalQuestionValue } from "./content-hash";
import {
  type QuestionDraft,
  type QuestionDraftContent,
  resolveTrueFalseLabels,
  validateQuestionContent,
} from "./domain";
import { presentParticipantQuestion } from "./participant-presenter";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function trueFalseContent(
  overrides: Partial<QuestionDraftContent> = {},
): QuestionDraftContent {
  return {
    type: "TRUE_FALSE",
    stimulusHtml: "<p>Stimulus</p>",
    promptHtml: null,
    explanationHtml: null,
    options: [],
    statements: [
      { position: 1, statementHtml: "Satu", correctValue: true },
      { position: 2, statementHtml: "Dua", correctValue: false },
      { position: 3, statementHtml: "Tiga", correctValue: true },
    ],
    ...overrides,
  };
}

function publishedTrueFalse(
  overrides: Partial<QuestionDraft> = {},
): QuestionDraft {
  return {
    id: "40" as Id,
    questionId: "41" as Id,
    questionBank: {
      id: "20" as Id,
      subjectId: "30" as Id,
      ownerTeacherId: "10" as Id,
      name: "Bank",
      status: "ACTIVE",
    },
    questionStatus: "ACTIVE",
    revisionNo: 1,
    status: "PUBLISHED",
    ...trueFalseContent(),
    statements: [
      {
        id: "201" as Id,
        position: 1,
        statementHtml: "Satu",
        correctValue: true,
      },
      {
        id: "202" as Id,
        position: 2,
        statementHtml: "Dua",
        correctValue: false,
      },
      {
        id: "203" as Id,
        position: 3,
        statementHtml: "Tiga",
        correctValue: true,
      },
    ],
    contentHash: new Uint8Array([1, 2, 3]),
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("TRUE_FALSE labels", () => {
  test("keeps custom labels, trims them, and defaults empty labels to null", () => {
    const custom = validateQuestionContent(
      trueFalseContent({
        trueLabel: "  Memungkinkan  ",
        falseLabel: "Tidak Memungkinkan",
      }),
    );
    expect(custom.trueLabel).toBe("Memungkinkan");
    expect(custom.falseLabel).toBe("Tidak Memungkinkan");

    const empty = validateQuestionContent(
      trueFalseContent({ trueLabel: "   ", falseLabel: "" }),
    );
    expect(empty.trueLabel).toBeNull();
    expect(empty.falseLabel).toBeNull();
  });

  test("rejects identical, too-long, and HTML-like labels", () => {
    expect(() =>
      validateQuestionContent(
        trueFalseContent({ trueLabel: "Sama", falseLabel: "sama" }),
      ),
    ).toThrow("must be different");
    expect(() =>
      validateQuestionContent(trueFalseContent({ trueLabel: "x".repeat(51) })),
    ).toThrow("at most 50");
    expect(() =>
      validateQuestionContent(trueFalseContent({ trueLabel: "<b>Benar</b>" })),
    ).toThrow("plain text");
  });

  test("forces labels to null for choice questions", () => {
    const choice = validateQuestionContent({
      type: "SINGLE_CHOICE",
      stimulusHtml: "<p>Stimulus</p>",
      promptHtml: "<p>Pilih</p>",
      explanationHtml: null,
      trueLabel: "Memungkinkan",
      falseLabel: "Tidak Memungkinkan",
      options: [
        { position: 1, contentHtml: "A", isCorrect: true },
        { position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    });
    expect(choice.trueLabel).toBeNull();
    expect(choice.falseLabel).toBeNull();
  });

  test("resolves defaults for participants and null for choice questions", () => {
    expect(resolveTrueFalseLabels(trueFalseContent())).toEqual({
      trueLabel: "Benar",
      falseLabel: "Salah",
    });
    expect(
      resolveTrueFalseLabels(
        trueFalseContent({
          trueLabel: "Memungkinkan",
          falseLabel: "Tidak Memungkinkan",
        }),
      ),
    ).toEqual({
      trueLabel: "Memungkinkan",
      falseLabel: "Tidak Memungkinkan",
    });
  });

  test("keeps the historic hash when labels are unset", () => {
    const canonical = canonicalQuestionValue(trueFalseContent());
    expect(canonical).not.toContain("trueLabel");
    expect(canonical).not.toContain("falseLabel");
    const custom = canonicalQuestionValue(
      trueFalseContent({
        trueLabel: "Memungkinkan",
        falseLabel: "Tidak Memungkinkan",
      }),
    );
    expect(custom).toContain("Memungkinkan");
    expect(custom).not.toBe(canonical);
  });

  test("presents custom labels to participants without the answer key", () => {
    const result = presentParticipantQuestion(
      publishedTrueFalse({
        trueLabel: "Memungkinkan",
        falseLabel: "Tidak Memungkinkan",
      }),
    );
    expect(result.trueLabel).toBe("Memungkinkan");
    expect(result.falseLabel).toBe("Tidak Memungkinkan");
    expect(JSON.stringify(result)).not.toContain("correctValue");

    const defaults = presentParticipantQuestion(publishedTrueFalse());
    expect(defaults.trueLabel).toBe("Benar");
    expect(defaults.falseLabel).toBe("Salah");
  });

  test("carries labels through the exam-session manifest", () => {
    const source = {
      questionId: "41" as Id,
      questionRevisionId: "40" as Id,
      type: "TRUE_FALSE" as const,
      stimulusHtml: "<p>Stimulus</p>",
      promptHtml: null,
      trueLabel: "Memungkinkan",
      falseLabel: "Tidak Memungkinkan",
      options: [],
      statements: [
        {
          id: "201" as Id,
          position: 1,
          statementHtml: "Satu",
          correctValue: true,
        },
      ],
      media: [],
    };
    const manifest = participantManifest(source, {
      sessionQuestionId: "50" as Id,
      questionId: "41" as Id,
      questionRevisionId: "40" as Id,
      displayPosition: 1,
      points: "10.00",
      optionOrder: [],
      statementOrder: [],
    });
    expect(manifest.question.trueLabel).toBe("Memungkinkan");
    expect(manifest.question.falseLabel).toBe("Tidak Memungkinkan");
  });
});
