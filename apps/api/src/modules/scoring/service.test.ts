import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import {
  type ScoringAnswer,
  type ScoringQuestionSnapshot,
  ScoringValidationError,
  scoreQuestion,
} from "./domain";
import {
  DefaultExactMatchScoringService,
  type ExactMatchScoreInput,
} from "./service";

const service = new DefaultExactMatchScoringService();

describe("exact-match scoring service", () => {
  test.each([
    ["single exact", singleChoice(), singleAnswer("a"), "CORRECT", "2.50"],
    ["single wrong", singleChoice(), singleAnswer("b"), "INCORRECT", "0.00"],
    ["single empty", singleChoice(), singleAnswer(null), "UNANSWERED", "0.00"],
    [
      "multiple exact",
      multipleResponse(),
      multipleAnswer(["a", "c"]),
      "CORRECT",
      "1.25",
    ],
    [
      "multiple reordered exact",
      multipleResponse(),
      multipleAnswer(["c", "a"]),
      "CORRECT",
      "1.25",
    ],
    [
      "multiple incomplete set",
      multipleResponse(),
      multipleAnswer(["a"]),
      "INCORRECT",
      "0.00",
    ],
    [
      "multiple empty",
      multipleResponse(),
      multipleAnswer([]),
      "UNANSWERED",
      "0.00",
    ],
    [
      "true false exact",
      trueFalse(),
      trueFalseAnswer([
        ["s3", true],
        ["s1", true],
        ["s2", false],
      ]),
      "CORRECT",
      "3.00",
    ],
    [
      "true false wrong",
      trueFalse(),
      trueFalseAnswer([
        ["s1", false],
        ["s2", false],
        ["s3", true],
      ]),
      "INCORRECT",
      "0.00",
    ],
    [
      "true false incomplete",
      trueFalse(),
      trueFalseAnswer([
        ["s1", true],
        ["s2", false],
      ]),
      "UNANSWERED",
      "0.00",
    ],
  ] as const)("scores %s", (_name, question, answer, outcome, points) => {
    const result = scoreQuestion(question, answer.response);
    expect(result.outcome).toBe(outcome);
    expect(result.awardedPoints).toBe(points);
  });

  test("aggregates weighted points and counts", () => {
    const input: ExactMatchScoreInput = {
      questions: [
        { ...singleChoice(), questionId: id("q1"), points: "1" },
        { ...multipleResponse(), questionId: id("q2"), points: "2" },
        { ...trueFalse(), questionId: id("q3"), points: "1" },
      ],
      answers: [
        answer("q1", singleAnswer("a").response),
        answer("q2", multipleAnswer(["b"]).response),
        // q3 is deliberately absent and therefore unanswered.
      ],
    };
    expect(service.score(input)).toEqual({
      questionScores: [
        {
          questionId: id("q1"),
          questionRevisionId: id("r1"),
          outcome: "CORRECT",
          reason: "EXACT_MATCH",
          awardedPoints: "1.00",
          maxPoints: "1.00",
        },
        {
          questionId: id("q2"),
          questionRevisionId: id("r1"),
          outcome: "INCORRECT",
          reason: "MISMATCH",
          awardedPoints: "0.00",
          maxPoints: "2.00",
        },
        {
          questionId: id("q3"),
          questionRevisionId: id("r1"),
          outcome: "UNANSWERED",
          reason: "EMPTY",
          awardedPoints: "0.00",
          maxPoints: "1.00",
        },
      ],
      correctCount: 1,
      incorrectCount: 1,
      unansweredCount: 1,
      earnedScore: "1.00",
      maxScore: "4.00",
      percentage: "25.00",
    });
  });

  test("rounds percentage half-up to two decimal places", () => {
    const result = service.score({
      questions: [
        { ...singleChoice(), questionId: id("q1"), points: "1" },
        { ...singleChoice(), questionId: id("q2"), points: "1" },
        { ...singleChoice(), questionId: id("q3"), points: "1" },
      ],
      answers: [answer("q1", singleAnswer("a").response)],
    });
    expect(result.percentage).toBe("33.33");
  });

  test("rejects duplicate and foreign response IDs", () => {
    expect(() =>
      scoreQuestion(multipleResponse(), {
        selectedOptionIds: [id("a"), id("a")],
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_OPTION" }));
    expect(() =>
      scoreQuestion(multipleResponse(), {
        selectedOptionIds: [id("unknown")],
      }),
    ).toThrowError(expect.objectContaining({ code: "FOREIGN_OPTION" }));
    expect(() =>
      scoreQuestion(trueFalse(), {
        statements: [
          { statementId: id("s1"), value: true },
          { statementId: id("s1"), value: true },
          { statementId: id("s2"), value: false },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_STATEMENT" }));
  });

  test("rejects duplicate questions before scoring", () => {
    const question = singleChoice();
    expect(() =>
      service.score({
        questions: [question, question],
        answers: [answer("q1", singleAnswer("a").response)],
      }),
    ).toThrowError(ScoringValidationError);
  });

  test("rejects unpublished snapshots and invalid answer keys", () => {
    expect(() =>
      service.score({
        questions: [{ ...singleChoice(), status: "DRAFT" }],
        answers: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "QUESTION_NOT_PUBLISHED" }));
    expect(() =>
      service.score({
        questions: [
          {
            ...singleChoice(),
            options: [
              { id: id("a"), isCorrect: false },
              { id: id("b"), isCorrect: false },
            ],
          },
        ],
        answers: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ANSWER_KEY" }));
  });

  test("score output contains no answer key fields", () => {
    const output = service.score({
      questions: [singleChoice()],
      answers: [answer("q1", singleAnswer("a").response)],
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("isCorrect");
    expect(serialized).not.toContain("correctValue");
    expect(serialized).not.toContain("selectedOptionId");
  });
});

function answer(
  questionId: string,
  response: ScoringAnswer["response"],
): ScoringAnswer {
  return { questionId: id(questionId), response };
}

function singleChoice(): ScoringQuestionSnapshot {
  return {
    questionId: id("q1"),
    questionRevisionId: id("r1"),
    status: "PUBLISHED",
    type: "SINGLE_CHOICE",
    points: "2.50",
    options: [
      { id: id("a"), isCorrect: true },
      { id: id("b"), isCorrect: false },
    ],
    statements: [],
  };
}

function multipleResponse(): ScoringQuestionSnapshot {
  return {
    questionId: id("q1"),
    questionRevisionId: id("r1"),
    status: "PUBLISHED",
    type: "MULTIPLE_RESPONSE",
    points: "1.25",
    options: [
      { id: id("a"), isCorrect: true },
      { id: id("b"), isCorrect: false },
      { id: id("c"), isCorrect: true },
    ],
    statements: [],
  };
}

function trueFalse(): ScoringQuestionSnapshot {
  return {
    questionId: id("q1"),
    questionRevisionId: id("r1"),
    status: "PUBLISHED",
    type: "TRUE_FALSE",
    points: "3.00",
    options: [],
    statements: [
      { id: id("s1"), correctValue: true },
      { id: id("s2"), correctValue: false },
      { id: id("s3"), correctValue: true },
    ],
  };
}

function singleAnswer(selectedOptionId: string | null): ScoringAnswer {
  return {
    questionId: id("q1"),
    response: {
      selectedOptionId: selectedOptionId === null ? null : id(selectedOptionId),
    },
  };
}

function multipleAnswer(selectedOptionIds: readonly string[]): ScoringAnswer {
  return {
    questionId: id("q1"),
    response: { selectedOptionIds: selectedOptionIds.map(id) },
  };
}

function trueFalseAnswer(
  values: readonly (readonly [string, boolean])[],
): ScoringAnswer {
  return {
    questionId: id("q1"),
    response: {
      statements: values.map(([statementId, value]) => ({
        statementId: id(statementId),
        value,
      })),
    },
  };
}

function id(value: string): Id {
  return value as Id;
}
