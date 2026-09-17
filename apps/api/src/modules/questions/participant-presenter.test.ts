import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { QuestionDraft } from "./domain";
import {
  type ParticipantQuestionMedia,
  presentParticipantQuestion,
} from "./participant-presenter";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

describe("participant-safe question presenter", () => {
  test.each([
    ["SINGLE_CHOICE", singleChoice()],
    ["MULTIPLE_RESPONSE", multipleResponse()],
    ["TRUE_FALSE", trueFalse()],
  ] as const)("presents %s without confidential fields", (_type, source) => {
    const result = presentParticipantQuestion(source, [
      {
        usage: "STIMULUS",
        url: "/api/v1/participant/media/30",
        altText: "Diagram",
        isDecorative: false,
      },
    ]);

    expect(result.questionId).toBe(source.questionId);
    expect(result.questionRevisionId).toBe(source.id);
    expect(JSON.stringify(result)).not.toContain("isCorrect");
    expect(JSON.stringify(result)).not.toContain("correctValue");
    expect(JSON.stringify(result)).not.toContain("explanationHtml");
    expect(JSON.stringify(result)).not.toContain("contentHash");
    expect(JSON.stringify(result)).not.toContain("questionBank");
    expect(result.media).toEqual([
      {
        usage: "STIMULUS",
        url: "/api/v1/participant/media/30",
        altText: "Diagram",
        isDecorative: false,
      },
    ]);
  });

  test("preserves safe child order and does not mutate the source", () => {
    const source = multipleResponse();
    const before = JSON.stringify(source);
    const result = presentParticipantQuestion(source);

    expect(result.options.map((option) => option.id)).toEqual([
      "101" as Id,
      "102" as Id,
      "103" as Id,
    ]);
    expect(JSON.stringify(source)).toBe(before);
  });

  test("projects media fields instead of forwarding internal metadata", () => {
    const media = [
      {
        usage: "STIMULUS",
        url: "/api/v1/participant/media/30",
        altText: "Diagram",
        isDecorative: false,
        storageKey: "media/private-key",
        sha256: "private-hash",
      },
    ] as unknown as readonly ParticipantQuestionMedia[];
    const result = presentParticipantQuestion(singleChoice(), media);

    expect(JSON.stringify(result)).not.toContain("storageKey");
    expect(JSON.stringify(result)).not.toContain("private-hash");
    expect(result.media).toEqual([
      {
        usage: "STIMULUS",
        url: "/api/v1/participant/media/30",
        altText: "Diagram",
        isDecorative: false,
      },
    ]);
  });

  test("rejects draft revisions and missing child IDs", () => {
    expect(() =>
      presentParticipantQuestion({ ...singleChoice(), status: "DRAFT" }),
    ).toThrowError(expect.objectContaining({ code: "UNPUBLISHED_QUESTION" }));
    expect(() =>
      presentParticipantQuestion({
        ...singleChoice(),
        options: [
          { position: 1, contentHtml: "A", isCorrect: true },
          { id: "102" as Id, position: 2, contentHtml: "B", isCorrect: false },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CHILD_ID" }));
  });

  test("rejects an invalid published shape instead of emitting a partial DTO", () => {
    expect(() =>
      presentParticipantQuestion({
        ...singleChoice(),
        options: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_SHAPE" }));
  });
});

function base(type: QuestionDraft["type"]): QuestionDraft {
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
    type,
    stimulusHtml: "<p>Stimulus</p>",
    promptHtml: type === "TRUE_FALSE" ? null : "<p>Prompt</p>",
    explanationHtml: "<p>Private explanation</p>",
    options: [],
    statements: [],
    contentHash: new Uint8Array([1, 2, 3]),
    publishedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function singleChoice(): QuestionDraft {
  return {
    ...base("SINGLE_CHOICE"),
    options: [
      { id: "101" as Id, position: 1, contentHtml: "A", isCorrect: true },
      { id: "102" as Id, position: 2, contentHtml: "B", isCorrect: false },
    ],
  };
}

function multipleResponse(): QuestionDraft {
  return {
    ...base("MULTIPLE_RESPONSE"),
    options: [
      { id: "101" as Id, position: 1, contentHtml: "A", isCorrect: true },
      { id: "102" as Id, position: 2, contentHtml: "B", isCorrect: false },
      { id: "103" as Id, position: 3, contentHtml: "C", isCorrect: true },
    ],
  };
}

function trueFalse(): QuestionDraft {
  return {
    ...base("TRUE_FALSE"),
    statements: [
      {
        id: "201" as Id,
        position: 1,
        statementHtml: "Pernyataan 1",
        correctValue: true,
      },
      {
        id: "202" as Id,
        position: 2,
        statementHtml: "Pernyataan 2",
        correctValue: false,
      },
      {
        id: "203" as Id,
        position: 3,
        statementHtml: "Pernyataan 3",
        correctValue: true,
      },
    ],
  };
}
