import { type TSchema, t } from "elysia";

const id = t.String({
  pattern: "^(?:0|[1-9][0-9]*)$",
  minLength: 1,
  maxLength: 20,
});
const timestamp = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
  minLength: 24,
  maxLength: 24,
});
const startIdempotencyKey = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89a-fA-F][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  minLength: 36,
  maxLength: 36,
});
const mutationHeaders = t.Object(
  {
    "x-csrf-token": t.String({ minLength: 1, maxLength: 256 }),
    "idempotency-key": t.String({ minLength: 16, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const answerResponse = t.Union([
  t.Object(
    { selectedOptionId: t.Union([id, t.Null()]) },
    { additionalProperties: false },
  ),
  t.Object(
    { selectedOptionIds: t.Array(id, { maxItems: 10 }) },
    { additionalProperties: false },
  ),
  t.Object(
    {
      statements: t.Array(
        t.Object(
          { statementId: id, value: t.Boolean() },
          { additionalProperties: false },
        ),
        { maxItems: 3 },
      ),
    },
    { additionalProperties: false },
  ),
]);
const answerItem = t.Object(
  {
    sessionQuestionId: id,
    baseVersion: t.Integer({ minimum: 0 }),
    response: answerResponse,
    clientMutationId: t.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const finalAnswerItem = t.Object(
  {
    sessionQuestionId: id,
    baseVersion: t.Integer({ minimum: 0 }),
    response: answerResponse,
  },
  { additionalProperties: false },
);
const sessionParams = t.Object({ id }, { additionalProperties: false });
const startMainBody = t.Object(
  {
    mainAccessCode: t.Optional(t.String({ minLength: 5, maxLength: 20 })),
    startIdempotencyKey,
  },
  { additionalProperties: false },
);
const startPracticeBody = t.Object(
  {
    scheduleId: id,
    token: t.String({ minLength: 5, maxLength: 20 }),
    identity: t.Record(
      t.String({ minLength: 1, maxLength: 50 }),
      t.String({ maxLength: 200 }),
    ),
    startIdempotencyKey,
  },
  { additionalProperties: false },
);
const resolvePracticeBody = t.Object(
  {
    token: t.String({ minLength: 5, maxLength: 20 }),
  },
  { additionalProperties: false },
);

export const examSessionApiSchemas = {
  mutationHeaders,
  sessionParams,
  startMainBody,
  startPracticeBody,
  resolvePracticeBody,
  answerBatchBody: t.Object(
    { items: t.Array(answerItem, { minItems: 1, maxItems: 20 }) },
    { additionalProperties: false },
  ),
  submitBody: t.Object(
    { finalAnswers: t.Array(finalAnswerItem, { maxItems: 500 }) },
    { additionalProperties: false },
  ),
  sessionResponse: t.Object(
    {
      data: t.Object({
        session: t.Any(),
        manifest: t.Array(t.Any()),
        serverNow: timestamp,
        replayed: t.Boolean(),
      }),
    },
    { additionalProperties: false },
  ),
  participantResultResponse: t.Object(
    {
      data: t.Object({
        result: t.Any(),
        canRetry: t.Boolean(),
        canRetryReason: t.Union([
          t.Literal("SCHEDULE_CLOSED"),
          t.Literal("ATTEMPT_LIMIT_REACHED"),
          t.Literal("TOKEN_INVALID_OR_EXPIRED"),
          t.Null(),
        ]),
      }),
    },
    { additionalProperties: false },
  ),
  participantScheduleResponse: t.Object(
    {
      data: t.Object({ items: t.Array(t.Any(), { maxItems: 200 }) }),
    },
    { additionalProperties: false },
  ),
  errorResponse: t.Any(),
} as const;

export interface ExamSessionApiRouteContract {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly operationId: string;
  readonly security?: readonly Readonly<Record<string, readonly string[]>>[];
  readonly request?: {
    readonly params?: TSchema;
    readonly headers?: TSchema;
    readonly body?: TSchema;
  };
}

export const examSessionApiRoutes: readonly ExamSessionApiRouteContract[] = [
  {
    method: "GET",
    path: "/api/v1/participant/schedules",
    operationId: "listParticipantSchedules",
    security: [{ participantCookie: [] }],
    request: {},
  },
  {
    method: "POST",
    path: "/api/v1/participant/schedules/:id/sessions",
    operationId: "startMainSession",
    security: [{ participantCookie: [] }],
    request: {
      params: sessionParams,
      headers: mutationHeaders,
      body: startMainBody,
    },
  },
  {
    method: "POST",
    path: "/api/v1/participant/practice/resolve",
    operationId: "resolvePracticeSchedule",
    security: [],
    request: { body: resolvePracticeBody },
  },
  {
    method: "POST",
    path: "/api/v1/participant/practice/sessions",
    operationId: "startPracticeSession",
    security: [],
    request: { body: startPracticeBody },
  },
  {
    method: "GET",
    path: "/api/v1/participant/exam-sessions/:id",
    operationId: "getParticipantSession",
    security: [{ participantCookie: [] }, { practiceCookie: [] }],
    request: { params: sessionParams },
  },
  {
    method: "POST",
    path: "/api/v1/participant/exam-sessions/:id/answers",
    operationId: "saveAnswers",
    security: [{ participantCookie: [] }, { practiceCookie: [] }],
    request: {
      params: sessionParams,
      headers: mutationHeaders,
      body: examSessionApiSchemas.answerBatchBody,
    },
  },
  {
    method: "GET",
    path: "/api/v1/participant/exam-sessions/:id/result",
    operationId: "getParticipantResult",
    security: [{ participantCookie: [] }, { practiceCookie: [] }],
    request: { params: sessionParams },
  },
  {
    method: "POST",
    path: "/api/v1/participant/exam-sessions/:id/submit",
    operationId: "submitSession",
    security: [{ participantCookie: [] }, { practiceCookie: [] }],
    request: {
      params: sessionParams,
      headers: mutationHeaders,
      body: examSessionApiSchemas.submitBody,
    },
  },
];

export const examSessionApiOpenApiSchemas: Readonly<Record<string, TSchema>> =
  examSessionApiSchemas;
