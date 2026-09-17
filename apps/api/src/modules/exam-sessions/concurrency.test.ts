import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { RuntimeQuestionSource } from "./domain";
import { InMemoryExamRuntimeStore } from "./repository";
import {
  ExamAnswerService,
  ExamSessionAdministrationService,
  ExamSessionStartService,
  ExamSubmissionService,
} from "./service";

const id = (value: number) => String(value) as Id;
const now = "2026-01-01T10:05:00.000Z" as UtcTimestamp;
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
  shuffleQuestions: false,
  shuffleOptions: false,
  resultReleasePolicy: "MANUAL" as const,
  mainAccessCodeHash: new Uint8Array([1]),
  targetClassIds: [id(7)],
  targetParticipantIds: [],
  questionDefinitions: [{ questionRevisionId: id(2), points: "1.00" }],
};
const participant = {
  actorType: "HUMAN" as const,
  userId: id(50),
  role: "PARTICIPANT" as const,
  active: true,
  requestId: "request-0001",
};
const staff = {
  actorType: "HUMAN" as const,
  userId: id(90),
  role: "TEACHER" as const,
  active: true,
  requestId: "request-0002",
};
const context = (
  actor: typeof participant | typeof staff,
  idempotencyKey: string,
) => ({ actor, idempotencyKey });

function runtime() {
  const store = new InMemoryExamRuntimeStore({
    schedules: [schedule],
    questions: [source],
  });
  return {
    store,
    start: new ExamSessionStartService(store),
    answer: new ExamAnswerService(store),
    submit: new ExamSubmissionService(store),
    admin: new ExamSessionAdministrationService(store),
  };
}
function startInput(key: string) {
  return {
    scheduleId: id(100),
    participantName: "Siswa",
    mainAccessCodeDigest: new Uint8Array([1]),
    startIdempotencyKey: key,
    now,
  };
}

describe("runtime concurrency invariants", () => {
  test("two starts cannot create two active attempts", async () => {
    const app = runtime();
    const outcomes = await Promise.allSettled([
      app.start.startMainWithEligibility(
        context(participant, "start-a-00000001"),
        startInput("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        [id(7)],
      ),
      app.start.startMainWithEligibility(
        context(participant, "start-b-00000001"),
        startInput("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        [id(7)],
      ),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      outcomes.filter((item) => item.status === "rejected")[0]?.reason.code,
    ).toBe("SESSION_ALREADY_ACTIVE");
  });

  test("answer race is resolved by baseVersion and submit retry is idempotent", async () => {
    const app = runtime();
    const started = await app.start.startMainWithEligibility(
      context(participant, "start-c-00000001"),
      startInput("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      [id(7)],
    );
    const question = started.manifest[0]?.sessionQuestionId;
    if (!question) throw new Error("Expected manifest question");
    const saves = await Promise.all([
      app.answer.save(
        context(participant, "answer-a-00000001"),
        started.session.id,
        [
          {
            sessionQuestionId: question,
            baseVersion: 0,
            response: { selectedOptionId: id(10) },
            clientMutationId: "a",
          },
        ],
        now,
      ),
      app.answer.save(
        context(participant, "answer-b-00000001"),
        started.session.id,
        [
          {
            sessionQuestionId: question,
            baseVersion: 0,
            response: { selectedOptionId: id(11) },
            clientMutationId: "b",
          },
        ],
        now,
      ),
    ]);
    expect(
      saves
        .flatMap((item) => item.outcomes.map((outcome) => outcome.status))
        .sort(),
    ).toEqual(["CONFLICT", "SAVED"]);
    const submits = await Promise.all([
      app.submit.submit(
        context(participant, "submit-a-00000001"),
        started.session.id,
        [],
        now,
      ),
      app.submit.submit(
        context(participant, "submit-a-00000001"),
        started.session.id,
        [],
        now,
      ),
    ]);
    const first = submits[0];
    const second = submits[1];
    if (!first || !second) throw new Error("Expected two submit results");
    expect(first.result).toEqual(second.result);
  });

  test("reset race creates one pending grant and one replacement session", async () => {
    const app = runtime();
    const started = await app.start.startMainWithEligibility(
      context(participant, "start-d-00000001"),
      startInput("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
      [id(7)],
    );
    const resets = await Promise.allSettled([
      app.admin.resetAttempt(context(staff, "reset-a-00000001"), {
        scheduleId: id(100),
        participantId: id(50),
        reason: "Reset",
        resetIdempotencyKey: "reset-a-00000001",
        now,
      }),
      app.admin.resetAttempt(context(staff, "reset-b-00000001"), {
        scheduleId: id(100),
        participantId: id(50),
        reason: "Reset",
        resetIdempotencyKey: "reset-b-00000001",
        now,
      }),
    ]);
    expect(resets.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(
      resets.filter((item) => item.status === "rejected")[0]?.reason.code,
    ).toBe("RESET_NOT_ALLOWED");
    const replacement = await app.start.startMainWithEligibility(
      context(participant, "start-e-00000001"),
      startInput("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
      [id(7)],
    );
    expect(replacement.session.attemptNo).toBe(2);
    expect(started.session.id).not.toBe(replacement.session.id);
    await expect(
      app.start.startMainWithEligibility(
        context(participant, "start-f-00000001"),
        startInput("ffffffff-ffff-4fff-8fff-ffffffffffff"),
        [id(7)],
      ),
    ).rejects.toMatchObject({ code: "SESSION_ALREADY_ACTIVE" });
  });
});
