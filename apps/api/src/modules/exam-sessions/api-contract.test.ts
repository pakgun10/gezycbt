import { describe, expect, test } from "bun:test";
import { TypeCompiler } from "elysia/type-system";
import { examSessionApiRoutes, examSessionApiSchemas } from "./api-contract";
import { examSessionApiOpenApi } from "./openapi";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("exam session API contracts", () => {
  test("accepts the three response shapes and bounds session payloads", () => {
    const answer = TypeCompiler.Compile(examSessionApiSchemas.answerBatchBody);
    expect(
      answer.Check({
        items: [
          {
            sessionQuestionId: "10",
            baseVersion: 0,
            response: { selectedOptionId: null },
            clientMutationId: "mutation-1",
          },
          {
            sessionQuestionId: "11",
            baseVersion: 1,
            response: { selectedOptionIds: ["20", "21"] },
            clientMutationId: "mutation-2",
          },
          {
            sessionQuestionId: "12",
            baseVersion: 2,
            response: {
              statements: [
                { statementId: "30", value: true },
                { statementId: "31", value: false },
                { statementId: "32", value: true },
              ],
            },
            clientMutationId: "mutation-3",
          },
        ],
      }),
    ).toBe(true);
    expect(
      answer.Check({
        items: [
          {
            sessionQuestionId: "10",
            baseVersion: 0,
            response: { selectedOptionId: null, extra: true },
            clientMutationId: "mutation-1",
          },
        ],
      }),
    ).toBe(false);
  });

  test("requires UUID start keys and keeps access modes explicit", () => {
    const main = TypeCompiler.Compile(examSessionApiSchemas.startMainBody);
    const practice = TypeCompiler.Compile(
      examSessionApiSchemas.startPracticeBody,
    );
    expect(
      main.Check({
        startIdempotencyKey: UUID,
      }),
    ).toBe(true);
    expect(
      practice.Check({
        scheduleId: "100",
        token: "ABCDE",
        identity: { name: "Siswa" },
        startIdempotencyKey: UUID,
      }),
    ).toBe(true);
    const resolve = TypeCompiler.Compile(
      examSessionApiSchemas.resolvePracticeBody,
    );
    expect(resolve.Check({ token: "ABCDE" })).toBe(true);
    expect(resolve.Check({ scheduleId: "100", token: "ABCDE" })).toBe(false);
    expect(
      practice.Check({
        scheduleId: "100",
        token: "ABCDE",
        identity: { name: "Siswa" },
        startIdempotencyKey: "short-key",
      }),
    ).toBe(false);
  });

  test("publishes all runtime paths with OR security for main/practice access", () => {
    const paths = examSessionApiOpenApi.paths as Record<
      string,
      Record<string, { security?: unknown }>
    >;
    expect(new Set(examSessionApiRoutes.map((route) => route.path)).size).toBe(
      examSessionApiRoutes.length,
    );
    expect(
      paths["/api/v1/participant/exam-sessions/{id}"]?.get?.security,
    ).toEqual([{ participantCookie: [] }, { practiceCookie: [] }]);
    expect(
      paths["/api/v1/participant/practice/sessions"]?.post?.security,
    ).toEqual([]);
    expect(paths["/api/v1/participant/schedules"]?.get?.security).toEqual([
      { participantCookie: [] },
    ]);
    expect(examSessionApiRoutes.map((route) => route.operationId)).toContain(
      "getParticipantResult",
    );
    expect(() =>
      JSON.parse(JSON.stringify(examSessionApiOpenApi)),
    ).not.toThrow();
  });
});
