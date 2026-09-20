import { describe, expect, test } from "bun:test";
import { TypeCompiler } from "elysia/type-system";
import {
  PARTICIPANT_FORBIDDEN_FIELDS,
  participantSchemaContainsForbiddenFields,
  QUESTION_API_ROUTE_PATHS,
  questionApiOpenApiSchemas,
  questionApiRoutes,
  questionApiSchemas,
} from "./api-contract";
import { questionApiOpenApi } from "./openapi";

const NOW = "2026-09-17T00:00:00.000Z";

describe("question API contracts", () => {
  test("accepts all three discriminated question shapes", () => {
    const check = TypeCompiler.Compile(questionApiSchemas.questionContent);
    expect(
      check.Check({
        type: "SINGLE_CHOICE",
        stimulusHtml: "",
        promptHtml: "Pilih jawaban",
        explanationHtml: null,
        options: [
          { position: 1, contentHtml: "A", isCorrect: true },
          { position: 2, contentHtml: "B", isCorrect: false },
        ],
        statements: [],
      }),
    ).toBe(true);
    expect(
      check.Check({
        type: "MULTIPLE_RESPONSE",
        stimulusHtml: "Stimulus",
        promptHtml: "Pilih semua",
        explanationHtml: "Pembahasan",
        options: [
          { position: 1, contentHtml: "A", isCorrect: true },
          { position: 2, contentHtml: "B", isCorrect: true },
        ],
        statements: [],
      }),
    ).toBe(true);
    expect(
      check.Check({
        type: "TRUE_FALSE",
        stimulusHtml: "Stimulus",
        promptHtml: null,
        explanationHtml: null,
        options: [],
        statements: [
          { position: 1, statementHtml: "Satu", correctValue: true },
          { position: 2, statementHtml: "Dua", correctValue: false },
          { position: 3, statementHtml: "Tiga", correctValue: true },
        ],
      }),
    ).toBe(true);
  });

  test("rejects cross-type children and malformed IDs", () => {
    const check = TypeCompiler.Compile(questionApiSchemas.questionContent);
    expect(
      check.Check({
        type: "TRUE_FALSE",
        stimulusHtml: "Stimulus",
        promptHtml: "Tidak boleh",
        explanationHtml: null,
        options: [],
        statements: [],
      }),
    ).toBe(false);
    expect(
      check.Check({
        type: "SINGLE_CHOICE",
        stimulusHtml: "Stimulus",
        promptHtml: "Pilih",
        explanationHtml: null,
        options: [
          { id: "01", position: 1, contentHtml: "A", isCorrect: true },
          { position: 2, contentHtml: "B", isCorrect: false },
        ],
        statements: [],
      }),
    ).toBe(false);
  });

  test("requires optimistic version for update and publish", () => {
    const updateCheck = TypeCompiler.Compile(
      questionApiSchemas.updateQuestionRevisionBody,
    );
    const publishCheck = TypeCompiler.Compile(
      questionApiSchemas.publishQuestionRevisionBody,
    );
    const content = {
      type: "SINGLE_CHOICE",
      stimulusHtml: "Stimulus",
      promptHtml: "Pilih",
      explanationHtml: null,
      options: [
        { position: 1, contentHtml: "A", isCorrect: true },
        { position: 2, contentHtml: "B", isCorrect: false },
      ],
      statements: [],
    };
    expect(updateCheck.Check({ ...content })).toBe(false);
    expect(updateCheck.Check({ ...content, expectedUpdatedAt: NOW })).toBe(
      true,
    );
    expect(publishCheck.Check({ expectedUpdatedAt: NOW })).toBe(true);
    expect(publishCheck.Check({})).toBe(false);
  });

  test("requires CSRF and bounded idempotency headers for mutations", () => {
    const check = TypeCompiler.Compile(questionApiSchemas.mutationHeaders);
    expect(
      check.Check({
        "x-csrf-token": "csrf-secret",
        "idempotency-key": "question-mutation-0001",
      }),
    ).toBe(true);
    expect(
      check.Check({
        "x-csrf-token": "csrf-secret",
        "idempotency-key": "short",
      }),
    ).toBe(false);
    expect(check.Check({})).toBe(false);
  });

  test("keeps participant schema free of authoring and storage fields", () => {
    expect(participantSchemaContainsForbiddenFields()).toEqual([]);
    const participantSchema = JSON.stringify(
      questionApiOpenApiSchemas.ParticipantQuestion,
    );
    for (const field of PARTICIPANT_FORBIDDEN_FIELDS) {
      expect(participantSchema).not.toContain(`"${field}"`);
    }
    expect(
      JSON.stringify(questionApiOpenApiSchemas.QuestionRevision),
    ).toContain('"isCorrect"');
  });

  test("publishes the canonical teacher route inventory to OpenAPI", () => {
    expect(QUESTION_API_ROUTE_PATHS).toHaveLength(18);
    expect(new Set(QUESTION_API_ROUTE_PATHS).size).toBe(18);
    expect(
      questionApiRoutes.every((route) =>
        route.path.startsWith("/api/v1/teacher/"),
      ),
    ).toBe(true);
    expect(
      questionApiRoutes.every(
        (route) =>
          route.response !== undefined &&
          (route.response.status === 204 ||
            route.response.schemaName !== undefined),
      ),
    ).toBe(true);

    const paths = questionApiOpenApi.paths;
    expect(paths["/api/v1/teacher/question-banks/{id}"]).toBeDefined();
    expect(
      paths["/api/v1/teacher/question-revisions/{id}/publish"],
    ).toBeDefined();
    expect(
      paths["/api/v1/teacher/question-revisions/{id}/media/{mediaId}"],
    ).toBeDefined();
    expect(paths["/api/v1/teacher/question-imports/preview"]).toBeDefined();
    expect(questionApiOpenApi.openapi).toBe("3.1.0");
    expect(
      questionApiOpenApi.components.schemas.QuestionBankPage,
    ).toBeDefined();
    expect(
      questionApiOpenApi.components.schemas.QuestionRevisionPage,
    ).toBeDefined();
    expect(
      questionApiOpenApi.components.schemas.ParticipantQuestion,
    ).toBeDefined();
    expect(() => JSON.parse(JSON.stringify(questionApiOpenApi))).not.toThrow();
  });
});
