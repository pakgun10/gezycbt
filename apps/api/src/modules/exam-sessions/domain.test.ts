import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  calculateDeadline,
  deterministicShuffle,
  normalizeAnswerResponse,
  participantManifest,
  participantStartResponse,
  participantSubmitResponse,
  type RuntimeQuestionSource,
} from "./domain";

const id = (value: number) => String(value) as Id;
const source: RuntimeQuestionSource = {
  questionId: id(1),
  questionRevisionId: id(2),
  type: "MULTIPLE_RESPONSE",
  stimulusHtml: "<p>Stimulus</p>",
  promptHtml: "<p>Pilih</p>",
  options: [
    { id: id(10), position: 1, contentHtml: "A", isCorrect: true },
    { id: id(11), position: 2, contentHtml: "B", isCorrect: false },
    { id: id(12), position: 3, contentHtml: "C", isCorrect: true },
  ],
  statements: [],
};

describe("exam session domain", () => {
  test("caps deadline at schedule hard end", () => {
    expect(
      calculateDeadline(
        "2026-01-01T10:00:00.000Z" as UtcTimestamp,
        3600,
        "2026-01-01T10:30:00.000Z" as UtcTimestamp,
      ),
    ).toBe("2026-01-01T10:30:00.000Z" as UtcTimestamp);
  });

  test("shuffle is deterministic for the same seed", () => {
    const seed = new Uint8Array(32).fill(7);
    expect(deterministicShuffle([1, 2, 3, 4], seed)).toEqual(
      deterministicShuffle([1, 2, 3, 4], seed),
    );
  });

  test("normalizes multiple response into server order and allows explicit clear", () => {
    const response = normalizeAnswerResponse(
      source,
      {
        selectedOptionIds: [id(12), id(10)],
      },
      [id(10), id(11), id(12)],
    );
    expect(response).toEqual({ selectedOptionIds: [id(10), id(12)] });
    expect(normalizeAnswerResponse(source, { selectedOptionIds: [] })).toEqual({
      selectedOptionIds: [],
    });
    expect(() =>
      normalizeAnswerResponse(source, {
        selectedOptionIds: [],
        unexpected: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ANSWER_SHAPE" }));
  });

  test("participant manifest contains no answer key", () => {
    const item = participantManifest(source, {
      sessionQuestionId: id(20),
      questionId: source.questionId,
      questionRevisionId: source.questionRevisionId,
      displayPosition: 1,
      points: "2.00",
      optionOrder: [id(12), id(10), id(11)],
      statementOrder: [],
    });
    expect(item.question.options.map((option) => option.id)).toEqual([
      id(12),
      id(10),
      id(11),
    ]);
    expect(item.question.options.map((option) => option.position)).toEqual([
      1, 2, 3,
    ]);
    expect(JSON.stringify(item)).not.toContain("isCorrect");
  });

  test("participant start response strips runtime secrets", () => {
    const result = participantStartResponse({
      session: {
        id: id(20),
        scheduleId: id(30),
        examRevisionId: id(40),
        participantId: id(50),
        attemptNo: 1,
        status: "ACTIVE",
        startedAt: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
        deadlineAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
        lastSeenAt: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
        submittedAt: null,
        expiredAt: null,
        endedAt: null,
        scoredAt: null,
        finalizationReason: null,
        finalizedByUserId: null,
        finalizationNote: "private",
        participantNameSnapshot: "Siswa",
        classSnapshot: null,
        institutionSnapshot: null,
        identityExtra: {},
        randomSeed: new Uint8Array([1]),
        practice: true,
        practiceTokenHash: new Uint8Array([2]),
        practiceCredentialHash: new Uint8Array([3]),
        startIdempotencyKey: "key",
        version: 1,
      },
      manifest: [],
      serverNow: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
      replayed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("practiceTokenHash");
    expect(JSON.stringify(result)).not.toContain("randomSeed");
  });

  test("participant submit response strips runtime secrets", () => {
    const result = participantSubmitResponse({
      session: {
        id: id(20),
        scheduleId: id(30),
        examRevisionId: id(40),
        participantId: null,
        attemptNo: 1,
        status: "SCORED",
        startedAt: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
        deadlineAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
        lastSeenAt: "2026-01-01T10:30:00.000Z" as UtcTimestamp,
        submittedAt: "2026-01-01T10:30:00.000Z" as UtcTimestamp,
        expiredAt: null,
        endedAt: null,
        scoredAt: "2026-01-01T10:30:00.000Z" as UtcTimestamp,
        finalizationReason: "PARTICIPANT_SUBMIT",
        finalizedByUserId: null,
        finalizationNote: "private",
        participantNameSnapshot: "Siswa",
        classSnapshot: null,
        institutionSnapshot: null,
        identityExtra: {},
        randomSeed: new Uint8Array([1]),
        practice: true,
        practiceTokenHash: new Uint8Array([2]),
        practiceCredentialHash: new Uint8Array([3]),
        startIdempotencyKey: "key",
        version: 2,
      },
      result: {
        sessionId: id(20),
        scheduleId: id(30),
        participantId: null,
        correctCount: 1,
        incorrectCount: 0,
        unansweredCount: 0,
        earnedScore: "1.00",
        maxScore: "1.00",
        percentage: "100.00",
        scoredAt: "2026-01-01T10:30:00.000Z" as UtcTimestamp,
        releasedAt: null,
      },
      serverNow: "2026-01-01T10:30:00.000Z" as UtcTimestamp,
      replayed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("practiceCredentialHash");
    expect(JSON.stringify(result)).not.toContain("randomSeed");
  });
});
