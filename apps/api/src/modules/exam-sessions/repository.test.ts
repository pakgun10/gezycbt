import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { RuntimeQuestionSource } from "./domain";
import { InMemoryExamRuntimeStore } from "./repository";
import {
  ExamAnswerService,
  ExamSessionAdministrationService,
  ExamSessionQueryService,
  ExamSessionStartService,
  ExamSubmissionService,
  ExamTimeoutFinalizer,
} from "./service";

const id = (value: number) => String(value) as Id;
const now = "2026-01-01T10:05:00.000Z" as UtcTimestamp;
const participant = {
  actorType: "HUMAN" as const,
  userId: id(50),
  role: "PARTICIPANT" as const,
  active: true,
  requestId: "request-1",
};
const staff = {
  actorType: "HUMAN" as const,
  userId: id(90),
  role: "TEACHER" as const,
  active: true,
  requestId: "request-2",
};
const source: RuntimeQuestionSource = {
  questionId: id(1),
  questionRevisionId: id(2),
  type: "SINGLE_CHOICE",
  stimulusHtml: "S",
  promptHtml: "P",
  options: [
    { id: id(10), position: 1, contentHtml: "A", isCorrect: true },
    { id: id(11), position: 2, contentHtml: "B", isCorrect: false },
  ],
  statements: [],
};
const schedule = {
  id: id(100),
  mode: "MAIN" as const,
  status: "OPEN" as const,
  startsAt: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
  endsAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
  durationSeconds: 3600,
  maxAttempts: 1,
  allowLateStart: true,
  hardEnd: true as const,
  examRevisionId: id(200),
  examTitle: "Ujian",
  instructionsHtml: "",
  shuffleQuestions: true,
  shuffleOptions: true,
  resultReleasePolicy: "MANUAL" as const,
  mainAccessCodeHash: new Uint8Array([1, 2, 3]),
  targetClassIds: [id(7)],
  targetParticipantIds: [],
  questionDefinitions: [{ questionRevisionId: id(2), points: "2.00" }],
};

function setup() {
  const store = new InMemoryExamRuntimeStore({
    schedules: [schedule],
    questions: [source],
  });
  const start = new ExamSessionStartService(store);
  const answer = new ExamAnswerService(store);
  const query = new ExamSessionQueryService(store);
  const submit = new ExamSubmissionService(store);
  const admin = new ExamSessionAdministrationService(store);
  return {
    store,
    start,
    answer,
    query,
    submit,
    admin,
    timeout: new ExamTimeoutFinalizer(store),
  };
}
const context = (actor: typeof participant | typeof staff, key: string) => ({
  actor,
  idempotencyKey: key,
});

describe("in-memory exam runtime", () => {
  test("practice resolve/start rejects generic token errors and freezes identity", async () => {
    const { mainAccessCodeHash: _mainCode, ...mainSchedule } = schedule;
    const practiceSchedule = {
      ...mainSchedule,
      id: id(101),
      mode: "PRACTICE" as const,
      resultReleasePolicy: "IMMEDIATE_SCORE" as const,
      practiceTokenHash: new Uint8Array([9, 9, 9]),
      targetClassIds: [],
      targetParticipantIds: [],
      identityFields: [
        { key: "name", label: "Nama", type: "TEXT" as const, required: true },
        {
          key: "class",
          label: "Kelas",
          type: "TEXT" as const,
          required: false,
        },
      ],
    };
    const store = new InMemoryExamRuntimeStore({
      schedules: [practiceSchedule],
      questions: [source],
    });
    const start = new ExamSessionStartService(store);
    await expect(
      start.resolvePractice({
        scheduleId: id(101),
        practiceTokenDigest: new Uint8Array([1]),
        now,
      }),
    ).rejects.toMatchObject({ code: "PRACTICE_ACCESS_INVALID", status: 401 });
    const started = await start.startPracticeWithCredential({
      scheduleId: id(101),
      practiceTokenDigest: new Uint8Array([9, 9, 9]),
      participantName: "  Nama  ",
      classSnapshot: "  X  ",
      startIdempotencyKey: "55555555-5555-4555-8555-555555555555",
      now,
    });
    expect(started.practiceCredential).toBeDefined();
    expect(started.session.participantId).toBeNull();
    expect(started.session.participantNameSnapshot).toBe("Nama");
    expect(started.session.classSnapshot).toBe("X");
    await expect(
      store.getParticipantSession(
        started.session.id,
        undefined,
        new Uint8Array([1]),
        now,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    const replay = await start.startPracticeWithCredential({
      scheduleId: id(101),
      practiceTokenDigest: new Uint8Array([9, 9, 9]),
      participantName: "  Nama  ",
      classSnapshot: "  X  ",
      startIdempotencyKey: "55555555-5555-4555-8555-555555555555",
      now,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.practiceCredential).toBeUndefined();
    await expect(
      store.getParticipantSession(
        started.session.id,
        undefined,
        started.practiceCredential?.digest,
        now,
      ),
    ).resolves.toBeDefined();
    const practiceView = await store.getParticipantSession(
      started.session.id,
      undefined,
      started.practiceCredential?.digest,
      now,
    );
    expect(JSON.stringify(practiceView)).not.toContain("practiceTokenHash");
    expect(JSON.stringify(practiceView)).not.toContain(
      "practiceCredentialHash",
    );
    if (!started.practiceCredential) throw new Error("credential missing");
    const answer = new ExamAnswerService(store);
    const submit = new ExamSubmissionService(store);
    const guest = {
      actor: {
        actorType: "RECOVERY" as const,
        requestId: "guest-practice-request",
      },
      idempotencyKey: "guest-answer-key-0001",
    };
    const questionId = started.manifest[0]?.sessionQuestionId;
    if (!questionId) throw new Error("manifest missing");
    await expect(
      answer.save(
        guest,
        started.session.id,
        [
          {
            sessionQuestionId: questionId,
            baseVersion: 0,
            response: { selectedOptionId: id(10) },
            clientMutationId: "guest-answer",
          },
        ],
        now,
        started.practiceCredential.digest,
      ),
    ).resolves.toMatchObject({ outcomes: [{ status: "SAVED" }] });
    await expect(
      submit.submit(
        { ...guest, idempotencyKey: "guest-submit-key-0001" },
        started.session.id,
        [
          {
            sessionQuestionId: questionId,
            baseVersion: 1,
            response: { selectedOptionId: id(10) },
          },
        ],
        now,
        started.practiceCredential.digest,
      ),
    ).resolves.toMatchObject({ result: { correctCount: 1 } });
  });

  test("main start is idempotent and eligibility is enforced", async () => {
    const runtime = setup();
    const input = {
      scheduleId: id(100),
      participantName: "Siswa",
      mainAccessCodeDigest: new Uint8Array([1, 2, 3]),
      startIdempotencyKey: "11111111-1111-4111-8111-111111111111",
      now,
    };
    const first = await runtime.start.startMainWithEligibility(
      context(participant, "start-key-00000001"),
      input,
      [id(7)],
    );
    const replay = await runtime.start.startMainWithEligibility(
      context(participant, "start-key-00000002"),
      input,
      [id(7)],
    );
    expect(replay.replayed).toBe(true);
    expect(replay.session.id).toBe(first.session.id);
    await expect(
      runtime.start.startMainWithEligibility(
        context({ ...participant, userId: id(51) }, "start-key-00000003"),
        input,
        [id(7)],
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("answer save returns partial conflicts and resume is participant-safe", async () => {
    const runtime = setup();
    const started = await runtime.start.startMainWithEligibility(
      context(participant, "start-key-00000004"),
      {
        scheduleId: id(100),
        participantName: "Siswa",
        mainAccessCodeDigest: new Uint8Array([1, 2, 3]),
        startIdempotencyKey: "22222222-2222-4222-8222-222222222222",
        now,
      },
      [id(7)],
    );
    const questionId = started.manifest[0]?.sessionQuestionId;
    if (!questionId) throw new Error("Expected manifest question");
    const saved = await runtime.answer.save(
      context(participant, "answer-key-00000001"),
      started.session.id,
      [
        {
          sessionQuestionId: questionId,
          baseVersion: 0,
          response: { selectedOptionId: id(10) },
          clientMutationId: "m1",
        },
        {
          sessionQuestionId: questionId,
          baseVersion: 0,
          response: { selectedOptionId: id(11) },
          clientMutationId: "m2",
        },
      ],
      now,
    );
    expect(saved.outcomes.map((item) => item.status)).toEqual([
      "SAVED",
      "CONFLICT",
    ]);
    const view = await runtime.query.getParticipantSession(
      { actor: participant },
      started.session.id,
      undefined,
      now,
    );
    expect(view.answers[0]?.response).toEqual({ selectedOptionId: id(10) });
    expect(JSON.stringify(view)).not.toContain("isCorrect");
    expect(JSON.stringify(view)).not.toContain("practiceTokenHash");
    expect(JSON.stringify(view)).not.toContain("practiceCredentialHash");
    await expect(
      runtime.answer.save(
        context({ ...participant, userId: id(51) }, "answer-key-00000002"),
        started.session.id,
        [
          {
            sessionQuestionId: questionId,
            baseVersion: 0,
            response: { selectedOptionId: id(11) },
            clientMutationId: "foreign",
          },
        ],
        now,
      ),
    ).rejects.toMatchObject({ code: "SCHEDULE_NOT_AVAILABLE" });
  });

  test("submit scores atomically and retry returns the same result", async () => {
    const runtime = setup();
    const started = await runtime.start.startMainWithEligibility(
      context(participant, "start-key-00000005"),
      {
        scheduleId: id(100),
        participantName: "Siswa",
        mainAccessCodeDigest: new Uint8Array([1, 2, 3]),
        startIdempotencyKey: "33333333-3333-4333-8333-333333333333",
        now,
      },
      [id(7)],
    );
    const questionId = started.manifest[0]?.sessionQuestionId;
    if (!questionId) throw new Error("Expected manifest question");
    const first = await runtime.submit.submit(
      context(participant, "submit-key-00000001"),
      started.session.id,
      [
        {
          sessionQuestionId: questionId,
          baseVersion: 0,
          response: { selectedOptionId: id(10) },
        },
      ],
      now,
    );
    const replay = await runtime.submit.submit(
      context(participant, "submit-key-00000001"),
      started.session.id,
      [
        {
          sessionQuestionId: questionId,
          baseVersion: 0,
          response: { selectedOptionId: id(10) },
        },
      ],
      now,
    );
    expect(first.result.correctCount).toBe(1);
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(first.result);
  });

  test("timeout, extension, end, close, and reset preserve finalization reasons", async () => {
    const runtime = setup();
    const started = await runtime.start.startMainWithEligibility(
      context(participant, "start-key-00000006"),
      {
        scheduleId: id(100),
        participantName: "Siswa",
        mainAccessCodeDigest: new Uint8Array([1, 2, 3]),
        startIdempotencyKey: "44444444-4444-4444-8444-444444444444",
        now,
      },
      [id(7)],
    );
    const extended = await runtime.admin.extendTime(
      context(staff, "extend-key-00000001"),
      {
        sessionId: started.session.id,
        additionalMinutes: 5,
        reason: "Akomodasi",
        expectedVersion: 1,
        now,
      },
    );
    expect(extended.deadlineAt).toBe(
      "2026-01-01T11:00:00.000Z" as UtcTimestamp,
    );
    const ended = await runtime.admin.endSession(
      context(staff, "end-key-000000001"),
      { sessionId: started.session.id, reason: "Gangguan perangkat", now },
    );
    expect(ended.session.finalizationReason).toBe("STAFF_END");
    const grant = await runtime.admin.resetAttempt(
      context(staff, "reset-key-00000001"),
      {
        scheduleId: id(100),
        participantId: id(50),
        reason: "Ulang",
        resetIdempotencyKey: "reset-0000000001",
        now,
      },
    );
    expect(grant.grantedAttemptNo).toBe(2);
  });
});
