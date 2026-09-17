import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import {
  type ParticipantSessionView,
  participantStartResponse,
  type SessionStartResult,
  type SubmitResult,
} from "./domain";
import {
  createPracticeCredential,
  type PracticeCredential,
} from "./practice-credential";
import { createExamSessionRoutes } from "./routes";

const now = "2026-01-01T10:05:00.000Z" as UtcTimestamp;
const participantId = "50" as Id;

function internalSession() {
  return {
    id: "1000" as Id,
    scheduleId: "100" as Id,
    examRevisionId: "200" as Id,
    participantId,
    attemptNo: 1,
    status: "SCORED" as const,
    startedAt: now,
    deadlineAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
    lastSeenAt: now,
    submittedAt: now,
    expiredAt: null,
    endedAt: null,
    scoredAt: now,
    finalizationReason: "PARTICIPANT_SUBMIT" as const,
    finalizedByUserId: null,
    finalizationNote: "internal note",
    participantNameSnapshot: "Server Name",
    classSnapshot: null,
    institutionSnapshot: null,
    identityExtra: {},
    randomSeed: new Uint8Array([1, 2, 3]),
    startIdempotencyKey: "11111111-1111-4111-8111-111111111111",
    practice: false,
    version: 2,
  };
}

function appWith(options: {
  readonly submit?: () => Promise<SubmitResult>;
  readonly startPractice?: () => Promise<
    SessionStartResult & { readonly practiceCredential?: PracticeCredential }
  >;
}) {
  const routes = createExamSessionRoutes({
    startService: {
      async resolvePractice() {
        return {
          scheduleId: "101" as Id,
          title: "Latihan",
          identityFields: [{ key: "name", required: true }],
          startsAt: now,
          endsAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
          durationSeconds: 3600,
        };
      },
      async startMainWithEligibility() {
        return {
          session: internalSession(),
          manifest: [],
          serverNow: now,
          replayed: false,
        };
      },
      async startPracticeWithCredential() {
        return (
          (await options.startPractice?.()) ?? {
            session: {
              ...internalSession(),
              participantId: null,
              practice: true,
            },
            manifest: [],
            serverNow: now,
            replayed: false,
          }
        );
      },
    },
    answerService: {
      async save() {
        return {
          sessionId: "1000" as Id,
          outcomes: [],
          serverNow: now,
          deadlineAt: now,
        };
      },
    },
    queryService: {
      async getParticipantSession(): Promise<ParticipantSessionView> {
        const safe = participantStartResponse({
          session: internalSession(),
          manifest: [],
          serverNow: now,
          replayed: false,
        });
        return { ...safe, answers: [] };
      },
      async getParticipantResult() {
        return {
          result: {
            sessionId: "1000" as Id,
            scheduleId: "100" as Id,
            participantId,
            correctCount: 1,
            incorrectCount: 0,
            unansweredCount: 0,
            earnedScore: "1.00",
            maxScore: "1.00",
            percentage: "100.00",
            scoredAt: now,
            releasedAt: now,
          },
          canRetry: false,
          canRetryReason: "ATTEMPT_LIMIT_REACHED" as const,
        };
      },
    },
    submissionService: {
      async submit() {
        return (
          (await options.submit?.()) ?? {
            session: internalSession(),
            result: {
              sessionId: "1000" as Id,
              scheduleId: "100" as Id,
              participantId,
              correctCount: 1,
              incorrectCount: 0,
              unansweredCount: 0,
              earnedScore: "1.00",
              maxScore: "1.00",
              percentage: "100.00",
              scoredAt: now,
              releasedAt: null,
            },
            serverNow: now,
            replayed: false,
          }
        );
      },
    },
    async participantContext() {
      return {
        actor: {
          actorType: "HUMAN" as const,
          userId: participantId,
          role: "PARTICIPANT" as const,
          active: true,
          requestId: "request-0001",
        },
        idempotencyKey: "request-key-0000001",
      };
    },
    async participantSnapshot() {
      return { participantName: "Server Name" };
    },
    async participantSchedules({ participantId }) {
      expect(participantId).toBe("50" as Id);
      return [
        {
          id: "100" as Id,
          title: "Ujian Peserta",
          mode: "MAIN" as const,
          status: "OPEN" as const,
          startsAt: "2026-01-01T10:00:00.000Z" as UtcTimestamp,
          endsAt: "2026-01-01T11:00:00.000Z" as UtcTimestamp,
          durationSeconds: 3600,
          maxAttempts: 1,
          attemptsUsed: 0,
          activeSessionId: null,
          resultSessionId: null,
          resultReleased: false,
          attemptResetAvailable: false,
        },
      ];
    },
    async mainAccessCodeDigest(value) {
      expect(value).toBe("ABCDE");
      return new Uint8Array([1]);
    },
    async practiceTokenDigest() {
      return new Uint8Array([2]);
    },
  });
  return new Elysia().use(routes).onError(({ error, set }) => {
    set.status =
      error instanceof Error && "status" in error ? Number(error.status) : 500;
    return { error: { code: error instanceof Error ? error.name : "ERROR" } };
  });
}

test("participant runtime routes use server identity and sanitize submit", async () => {
  const app = appWith({});
  const schedulesResponse = await app.handle(
    new Request("https://cbt.example.test/api/v1/participant/schedules"),
  );
  expect(schedulesResponse.status).toBe(200);
  expect(await schedulesResponse.json()).toMatchObject({
    data: { items: [{ id: "100", mode: "MAIN" }] },
  });
  const startResponse = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/participant/schedules/100/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          participantName: "spoofed",
          mainAccessCode: "ab-cde",
          startIdempotencyKey: "11111111-1111-4111-8111-111111111111",
        }),
      },
    ),
  );
  expect(startResponse.status).toBe(201);
  expect(
    (await startResponse.json()).data.session.participantNameSnapshot,
  ).toBe("Server Name");

  const resolveResponse = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/participant/practice/resolve",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "abc-de" }),
      },
    ),
  );
  expect(resolveResponse.status).toBe(200);
  expect(await resolveResponse.json()).toMatchObject({
    data: { scheduleId: "101", title: "Latihan" },
  });

  const submitResponse = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/participant/exam-sessions/1000/submit",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "submit-key-00000001",
        },
        body: JSON.stringify({ finalAnswers: [] }),
      },
    ),
  );
  const body = await submitResponse.text();
  expect(submitResponse.status).toBe(200);
  expect(body).not.toContain("randomSeed");
  expect(body).not.toContain("internal note");

  const resultResponse = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/participant/exam-sessions/1000/result",
    ),
  );
  expect(resultResponse.status).toBe(200);
  expect(await resultResponse.json()).toMatchObject({
    data: {
      canRetry: false,
      canRetryReason: "ATTEMPT_LIMIT_REACHED",
    },
  });
});

test("practice start sets the isolated credential cookie", async () => {
  const credential = await createPracticeCredential("1000" as Id);
  const app = appWith({
    async startPractice() {
      return {
        session: { ...internalSession(), participantId: null, practice: true },
        manifest: [],
        serverNow: now,
        replayed: false,
        practiceCredential: credential,
      };
    },
  });
  const response = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/participant/practice/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scheduleId: "101",
          token: "abcde",
          identity: { name: "Siswa" },
          startIdempotencyKey: "11111111-1111-4111-8111-111111111111",
        }),
      },
    ),
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toContain(
    "__Host-gezycbt-practice=",
  );
});
