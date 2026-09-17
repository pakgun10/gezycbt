import { describe, expect, test } from "bun:test";
import { ApiClientError } from "../../lib/api";
import type { ParticipantApi } from "../participant/api";
import type {
  AnswerSaveResponse,
  FinalAnswer,
  ParticipantResultResponse,
  ParticipantSchedule,
  ParticipantSessionView,
  PracticeResolveResponse,
  RuntimeQuestionManifest,
  SessionStartResponse,
  SubmitResponse,
} from "../participant/types";
import { createMemoryOutbox } from "./outbox";
import { ExamSessionController } from "./session-controller";

const session = {
  id: "900",
  scheduleId: "100",
  examRevisionId: "200",
  participantId: "50",
  attemptNo: 1,
  status: "ACTIVE" as const,
  startedAt: "2026-01-01T10:00:00.000Z",
  deadlineAt: "2026-01-01T11:00:00.000Z",
  lastSeenAt: "2026-01-01T10:00:00.000Z",
  submittedAt: null,
  expiredAt: null,
  endedAt: null,
  scoredAt: null,
  finalizationReason: null,
  finalizedByUserId: null,
  participantNameSnapshot: "Siswa",
  classSnapshot: null,
  institutionSnapshot: null,
  identityExtra: {},
  startIdempotencyKey: "11111111-1111-4111-8111-111111111111",
  practice: false,
  version: 0,
};

const singleManifest: RuntimeQuestionManifest = {
  sessionQuestionId: "901",
  questionId: "1",
  questionRevisionId: "2",
  displayPosition: 1,
  points: "1.00",
  optionOrder: ["10", "11"],
  statementOrder: [],
  question: {
    questionId: "1",
    questionRevisionId: "2",
    type: "SINGLE_CHOICE",
    stimulusHtml: "Stimulus",
    promptHtml: "Prompt",
    options: [
      { id: "10", position: 1, contentHtml: "A" },
      { id: "11", position: 2, contentHtml: "B" },
    ],
    statements: [],
    media: [],
  },
};

const trueFalseManifest: RuntimeQuestionManifest = {
  ...singleManifest,
  sessionQuestionId: "902",
  questionId: "3",
  questionRevisionId: "4",
  question: {
    ...singleManifest.question,
    questionId: "3",
    questionRevisionId: "4",
    type: "TRUE_FALSE",
    options: [],
    statements: [
      { id: "31", position: 1, statementHtml: "Satu" },
      { id: "32", position: 2, statementHtml: "Dua" },
      { id: "33", position: 3, statementHtml: "Tiga" },
    ],
  },
  optionOrder: [],
  statementOrder: ["31", "32", "33"],
};

const startData: SessionStartResponse["data"] = {
  session,
  manifest: [singleManifest],
  serverNow: "2026-01-01T10:00:00.000Z",
  replayed: false,
};

function fakeApi(overrides: Partial<ParticipantApi> = {}): ParticipantApi {
  return {
    login: async () => {
      throw new Error("not used");
    },
    me: async () => {
      throw new Error("not used");
    },
    schedules: async (): Promise<readonly ParticipantSchedule[]> => [],
    resolvePractice: async (): Promise<PracticeResolveResponse["data"]> => {
      throw new Error("not used");
    },
    startMain: async (): Promise<SessionStartResponse["data"]> => startData,
    startPractice: async (): Promise<SessionStartResponse["data"]> => startData,
    session: async (): Promise<ParticipantSessionView> => ({
      session,
      manifest: [singleManifest],
      answers: [],
      serverNow: "2026-01-01T10:00:00.000Z",
    }),
    saveAnswers: async (): Promise<AnswerSaveResponse["data"]> => ({
      sessionId: "900",
      outcomes: [],
      serverNow: "2026-01-01T10:00:00.000Z",
      deadlineAt: session.deadlineAt,
    }),
    submit: async (): Promise<SubmitResponse["data"]> => ({
      session: { ...session, status: "SCORED" },
      result: {
        sessionId: "900",
        scheduleId: "100",
        participantId: "50",
        correctCount: 1,
        incorrectCount: 0,
        unansweredCount: 0,
        earnedScore: "1.00",
        maxScore: "1.00",
        percentage: "100.00",
        scoredAt: "2026-01-01T10:30:00.000Z",
        releasedAt: "2026-01-01T10:30:00.000Z",
      },
      serverNow: "2026-01-01T10:30:00.000Z",
      replayed: false,
    }),
    result: async (): Promise<ParticipantResultResponse["data"]> => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

describe("ExamSessionController", () => {
  test("keeps only the latest local mutation and flushes it after reconnect", async () => {
    let online = false;
    let saves = 0;
    const storage = createMemoryOutbox();
    const api = fakeApi({
      saveAnswers: async (_id, items) => {
        saves += 1;
        return {
          sessionId: "900",
          outcomes: items.map((item) => ({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "SAVED" as const,
            version: 1,
          })),
          serverNow: "2026-01-01T10:01:00.000Z",
          deadlineAt: session.deadlineAt,
        };
      },
    });
    const controller = new ExamSessionController({
      api,
      storage,
      online: () => online,
      now: () => Date.parse("2026-01-01T10:00:00.000Z"),
    });
    await controller.start(startData);
    await controller.setAnswer("901", { selectedOptionId: "10" });
    await controller.setAnswer("901", { selectedOptionId: "11" });
    expect(await storage.listOutbox("900")).toHaveLength(1);
    expect((await storage.listOutbox("900"))[0]?.response).toEqual({
      selectedOptionId: "11",
    });
    expect(controller.state).toBe("OFFLINE_DIRTY");
    online = true;
    await controller.flush();
    expect(saves).toBe(1);
    expect(await storage.listOutbox("900")).toHaveLength(0);
    expect(controller.state).toBe("READY");
    expect(controller.answers.get("901")?.version).toBe(1);
    controller.dispose();
  });

  test("offers explicit server or local resolution for optimistic conflicts", async () => {
    const storage = createMemoryOutbox();
    const controller = new ExamSessionController({
      api: fakeApi({
        saveAnswers: async (_id, items) => ({
          sessionId: "900",
          outcomes: items.map((item) => ({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "CONFLICT" as const,
            version: 2,
            response: { selectedOptionId: "10" },
          })),
          serverNow: "2026-01-01T10:01:00.000Z",
          deadlineAt: session.deadlineAt,
        }),
      }),
      storage,
      online: () => true,
    });
    await controller.start(startData);
    await controller.setAnswer("901", { selectedOptionId: "11" });
    await controller.flush();
    expect(controller.state).toBe("CONFLICT");
    await controller.resolveConflict("901", "local");
    expect(controller.state).toBe("DIRTY");
    expect((await storage.listOutbox("900"))[0]?.baseVersion).toBe(2);
    await controller.setAnswer("901", { selectedOptionId: "11" });
    await controller.flush();
    await controller.resolveConflict("901", "server");
    expect(controller.state).toBe("READY");
    expect(controller.answers.get("901")?.response).toEqual({
      selectedOptionId: "10",
    });
    expect(await storage.listOutbox("900")).toHaveLength(0);
    controller.dispose();
  });

  test("does not enqueue incomplete true/false answers and submits them as unanswered", async () => {
    let received: readonly FinalAnswer[] = [];
    const storage = createMemoryOutbox();
    const controller = new ExamSessionController({
      api: fakeApi({
        submit: async (_id, answers) => {
          received = answers;
          return fakeApi().submit("", [], "");
        },
      }),
      storage,
      online: () => true,
    });
    await controller.start({ ...startData, manifest: [trueFalseManifest] });
    await controller.setAnswer("902", {
      statements: [{ statementId: "31", value: true }],
    });
    expect(await storage.listOutbox("900")).toHaveLength(0);
    await controller.submit();
    expect(received).toEqual([
      {
        sessionQuestionId: "902",
        baseVersion: 0,
        response: { statements: [] },
      },
    ]);
    expect(controller.state).toBe("ENDED");
    controller.dispose();
  });

  test("clears a previously committed true/false answer when it becomes incomplete", async () => {
    const storage = createMemoryOutbox();
    const controller = new ExamSessionController({
      api: fakeApi({
        saveAnswers: async (_id, items) => ({
          sessionId: "900",
          outcomes: items.map((item) => ({
            sessionQuestionId: item.sessionQuestionId,
            clientMutationId: item.clientMutationId,
            status: "SAVED" as const,
            version: 1,
          })),
          serverNow: "2026-01-01T10:01:00.000Z",
          deadlineAt: session.deadlineAt,
        }),
      }),
      storage,
      online: () => true,
    });
    await controller.start({ ...startData, manifest: [trueFalseManifest] });
    await controller.setAnswer("902", {
      statements: [
        { statementId: "31", value: true },
        { statementId: "32", value: false },
        { statementId: "33", value: true },
      ],
    });
    await controller.flush();
    expect(controller.answers.get("902")?.version).toBe(1);
    await controller.setAnswer("902", {
      statements: [{ statementId: "31", value: true }],
    });
    expect((await storage.listOutbox("900"))[0]?.response).toEqual({
      statements: [],
    });
    controller.dispose();
  });

  test("keeps outbox and notifies the view when auth expires", async () => {
    const storage = createMemoryOutbox();
    let expired = false;
    const controller = new ExamSessionController({
      api: fakeApi({
        saveAnswers: async () => {
          throw new ApiClientError(
            401,
            "AUTH_SESSION_EXPIRED",
            "Sesi login berakhir.",
          );
        },
      }),
      storage,
      online: () => true,
      onAuthExpired: () => {
        expired = true;
      },
    });
    await controller.start(startData);
    await controller.setAnswer("901", { selectedOptionId: "10" });
    await expect(controller.flush()).rejects.toBeInstanceOf(ApiClientError);
    expect(expired).toBe(true);
    expect(await storage.listOutbox("900")).toHaveLength(1);
    expect(controller.state).toBe("DIRTY");
    controller.dispose();
  });
});
