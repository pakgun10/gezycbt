import type {
  QuestionBankStatusContract,
  QuestionRevisionStatusContract,
  QuestionTypeContract,
} from "@gezycbt/contracts";
import { type TSchema, t } from "elysia";

const ID_PATTERN = "^(?:0|[1-9][0-9]*)$";
const UTC_TIMESTAMP_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
const HEX_SHA256_PATTERN = "^[0-9a-f]{64}$";

const idSchema = t.String({ pattern: ID_PATTERN, minLength: 1, maxLength: 20 });
const utcTimestampSchema = t.String({
  pattern: UTC_TIMESTAMP_PATTERN,
  minLength: 24,
  maxLength: 24,
});
const htmlSchema = t.String({ minLength: 1, maxLength: 100_000 });
const nullableHtmlSchema = t.Union([
  t.Null(),
  t.String({ maxLength: 100_000 }),
]);
const queryTextSchema = t.String({ minLength: 1, maxLength: 200 });

const questionTypeSchema = t.Union([
  t.Literal("SINGLE_CHOICE"),
  t.Literal("MULTIPLE_RESPONSE"),
  t.Literal("TRUE_FALSE"),
]);
const questionBankStatusSchema = t.Union([
  t.Literal("ACTIVE"),
  t.Literal("ARCHIVED"),
]);
const revisionStatusSchema = t.Union([
  t.Literal("DRAFT"),
  t.Literal("PUBLISHED"),
]);
const mediaUsageSchema = t.Union([
  t.Literal("STIMULUS"),
  t.Literal("PROMPT"),
  t.Literal("EXPLANATION"),
  t.Literal("OPTION"),
  t.Literal("STATEMENT"),
]);

const questionBankSummarySchema = t.Object(
  {
    id: idSchema,
    subjectId: idSchema,
    ownerTeacherId: idSchema,
    name: t.String({ minLength: 1, maxLength: 200 }),
    status: questionBankStatusSchema,
  },
  { additionalProperties: false, $id: "QuestionBank" },
);

const questionOptionInputSchema = t.Object(
  {
    id: t.Optional(idSchema),
    position: t.Integer({ minimum: 1, maximum: 10 }),
    contentHtml: t.String({ maxLength: 20_000 }),
    isCorrect: t.Boolean(),
  },
  { additionalProperties: false, $id: "QuestionOptionInput" },
);

const trueFalseStatementInputSchema = t.Object(
  {
    id: t.Optional(idSchema),
    position: t.Integer({ minimum: 1, maximum: 3 }),
    statementHtml: t.String({ maxLength: 20_000 }),
    correctValue: t.Boolean(),
  },
  { additionalProperties: false, $id: "TrueFalseStatementInput" },
);

const emptyArraySchema = t.Array(t.Never(), { maxItems: 0 });

const choiceContentProperties = (
  type: "SINGLE_CHOICE" | "MULTIPLE_RESPONSE",
) => ({
  type: t.Literal(type),
  stimulusHtml: htmlSchema,
  promptHtml: t.String({ minLength: 1, maxLength: 100_000 }),
  explanationHtml: nullableHtmlSchema,
  options: t.Array(questionOptionInputSchema, { maxItems: 10 }),
  statements: emptyArraySchema,
});

const choiceContentSchema = (type: "SINGLE_CHOICE" | "MULTIPLE_RESPONSE") =>
  t.Object(choiceContentProperties(type), { additionalProperties: false });

const trueFalseContentProperties = {
  type: t.Literal("TRUE_FALSE"),
  stimulusHtml: htmlSchema,
  promptHtml: t.Null(),
  explanationHtml: nullableHtmlSchema,
  options: emptyArraySchema,
  statements: t.Array(trueFalseStatementInputSchema, { maxItems: 3 }),
};
const trueFalseContentSchema = t.Object(trueFalseContentProperties, {
  additionalProperties: false,
});

export const questionContentSchema = t.Union([
  choiceContentSchema("SINGLE_CHOICE"),
  choiceContentSchema("MULTIPLE_RESPONSE"),
  trueFalseContentSchema,
]);

// The bank ID is authoritative in the nested route path. It is deliberately
// absent from the body so a client cannot send two conflicting resource IDs.
const createQuestionDraftBodySchema = questionContentSchema;

const updateQuestionRevisionBodySchema = t.Union([
  t.Object(
    {
      ...choiceContentProperties("SINGLE_CHOICE"),
      expectedUpdatedAt: utcTimestampSchema,
    },
    { additionalProperties: false },
  ),
  t.Object(
    {
      ...choiceContentProperties("MULTIPLE_RESPONSE"),
      expectedUpdatedAt: utcTimestampSchema,
    },
    { additionalProperties: false },
  ),
  t.Object(
    { ...trueFalseContentProperties, expectedUpdatedAt: utcTimestampSchema },
    { additionalProperties: false },
  ),
]);

const publishQuestionRevisionBodySchema = t.Object(
  { expectedUpdatedAt: utcTimestampSchema },
  { additionalProperties: false },
);

const mutationHeadersSchema = t.Object(
  {
    "x-csrf-token": t.String({ minLength: 1, maxLength: 256 }),
    "idempotency-key": t.String({ minLength: 16, maxLength: 128 }),
  },
  { additionalProperties: false },
);

const cursorQueryProperties = {
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
};

const questionBankListQuerySchema = t.Object(
  {
    ...cursorQueryProperties,
    subjectId: t.Optional(idSchema),
    status: t.Optional(questionBankStatusSchema),
    q: t.Optional(queryTextSchema),
  },
  { additionalProperties: false },
);

const questionListQuerySchema = t.Object(
  {
    ...cursorQueryProperties,
    q: t.Optional(queryTextSchema),
    subjectId: t.Optional(idSchema),
    questionBankId: t.Optional(idSchema),
    status: t.Optional(questionBankStatusSchema),
    revisionStatus: t.Optional(revisionStatusSchema),
    type: t.Optional(questionTypeSchema),
  },
  { additionalProperties: false },
);
const questionBankQuestionsQuerySchema = t.Object(
  {
    ...cursorQueryProperties,
    q: t.Optional(queryTextSchema),
    revisionStatus: t.Optional(revisionStatusSchema),
    type: t.Optional(questionTypeSchema),
  },
  { additionalProperties: false },
);

const questionBankIdParamsSchema = t.Object(
  { id: idSchema },
  { additionalProperties: false },
);
const questionIdParamsSchema = t.Object(
  { id: idSchema },
  { additionalProperties: false },
);
const revisionIdParamsSchema = t.Object(
  { id: idSchema },
  { additionalProperties: false },
);
const revisionMediaParamsSchema = t.Object(
  { id: idSchema, mediaId: idSchema },
  { additionalProperties: false },
);

const questionBankCreateBodySchema = t.Object(
  {
    subjectId: idSchema,
    name: t.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);
const questionBankUpdateBodySchema = t.Object(
  {
    name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    status: t.Optional(questionBankStatusSchema),
    expectedUpdatedAt: utcTimestampSchema,
  },
  { additionalProperties: false },
);

const questionOptionResourceSchema = t.Object(
  {
    id: idSchema,
    position: t.Integer({ minimum: 1, maximum: 10 }),
    contentHtml: t.String({ maxLength: 20_000 }),
    isCorrect: t.Boolean(),
  },
  { additionalProperties: false, $id: "QuestionOption" },
);
const trueFalseStatementResourceSchema = t.Object(
  {
    id: idSchema,
    position: t.Integer({ minimum: 1, maximum: 3 }),
    statementHtml: t.String({ maxLength: 20_000 }),
    correctValue: t.Boolean(),
  },
  { additionalProperties: false, $id: "TrueFalseStatement" },
);
const questionMediaResourceSchema = t.Object(
  {
    mediaAssetId: idSchema,
    usage: mediaUsageSchema,
    url: t.String({ format: "uri", maxLength: 2_048 }),
    altText: t.Union([t.Null(), t.String({ maxLength: 500 })]),
    isDecorative: t.Boolean(),
  },
  { additionalProperties: false, $id: "QuestionMedia" },
);
const questionRevisionSummarySchema = t.Object(
  {
    id: idSchema,
    questionId: idSchema,
    questionBank: questionBankSummarySchema,
    questionStatus: questionBankStatusSchema,
    revisionNo: t.Integer({ minimum: 1 }),
    type: questionTypeSchema,
    status: revisionStatusSchema,
    publishedAt: t.Union([t.Null(), utcTimestampSchema]),
    updatedAt: utcTimestampSchema,
  },
  { additionalProperties: false, $id: "QuestionRevisionSummary" },
);
const questionRevisionResourceSchema = t.Object(
  {
    ...questionRevisionSummarySchema.properties,
    stimulusHtml: htmlSchema,
    promptHtml: nullableHtmlSchema,
    explanationHtml: nullableHtmlSchema,
    contentHash: t.String({
      pattern: HEX_SHA256_PATTERN,
      minLength: 64,
      maxLength: 64,
    }),
    options: t.Array(questionOptionResourceSchema, { maxItems: 10 }),
    statements: t.Array(trueFalseStatementResourceSchema, { maxItems: 3 }),
    media: t.Array(questionMediaResourceSchema, { maxItems: 100 }),
    createdAt: utcTimestampSchema,
  },
  { additionalProperties: false, $id: "QuestionRevision" },
);
const readinessIssueSchema = t.Object(
  {
    severity: t.Union([t.Literal("ERROR"), t.Literal("WARNING")]),
    code: t.String({ minLength: 1, maxLength: 100 }),
    entityId: idSchema,
    fieldPath: t.String({ minLength: 1, maxLength: 200 }),
    message: t.String({ minLength: 1, maxLength: 500 }),
    remediationHint: t.Optional(t.String({ maxLength: 500 })),
  },
  { additionalProperties: false, $id: "QuestionReadinessIssue" },
);
const readinessReportSchema = t.Object(
  {
    revisionId: idSchema,
    isReady: t.Boolean(),
    errorCount: t.Integer({ minimum: 0 }),
    warningCount: t.Integer({ minimum: 0 }),
    issues: t.Array(readinessIssueSchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false, $id: "QuestionReadinessReport" },
);
const mediaAssetResourceSchema = t.Object(
  {
    id: idSchema,
    originalName: t.String({ minLength: 1, maxLength: 255 }),
    mimeType: t.Union([
      t.Literal("image/jpeg"),
      t.Literal("image/png"),
      t.Literal("image/webp"),
    ]),
    byteSize: t.Integer({ minimum: 1, maximum: 2 * 1024 * 1024 }),
    width: t.Integer({ minimum: 1, maximum: 2_500 }),
    height: t.Integer({ minimum: 1, maximum: 2_500 }),
    status: t.Union([t.Literal("READY"), t.Literal("DELETED")]),
  },
  { additionalProperties: false, $id: "MediaAsset" },
);

const participantOptionSchema = t.Object(
  {
    id: idSchema,
    position: t.Integer({ minimum: 1, maximum: 10 }),
    contentHtml: t.String({ maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
const participantStatementSchema = t.Object(
  {
    id: idSchema,
    position: t.Integer({ minimum: 1, maximum: 3 }),
    statementHtml: t.String({ maxLength: 20_000 }),
  },
  { additionalProperties: false },
);
const participantMediaSchema = t.Object(
  {
    usage: mediaUsageSchema,
    url: t.String({ format: "uri", maxLength: 2_048 }),
    altText: t.Union([t.Null(), t.String({ maxLength: 500 })]),
    isDecorative: t.Boolean(),
  },
  { additionalProperties: false },
);
const participantQuestionResourceSchema = t.Object(
  {
    questionId: idSchema,
    questionRevisionId: idSchema,
    type: questionTypeSchema,
    stimulusHtml: htmlSchema,
    promptHtml: nullableHtmlSchema,
    options: t.Array(participantOptionSchema, { maxItems: 10 }),
    statements: t.Array(participantStatementSchema, { maxItems: 3 }),
    media: t.Array(participantMediaSchema, { maxItems: 100 }),
  },
  { additionalProperties: false, $id: "ParticipantQuestion" },
);

const questionBankPageSchema = t.Object(
  {
    items: t.Array(questionBankSummarySchema),
    nextCursor: t.Union([t.Null(), t.String()]),
  },
  { additionalProperties: false, $id: "QuestionBankPage" },
);
const questionRevisionPageSchema = t.Object(
  {
    items: t.Array(questionRevisionSummarySchema),
    nextCursor: t.Union([t.Null(), t.String()]),
  },
  { additionalProperties: false, $id: "QuestionRevisionPage" },
);
const emptyBodySchema = t.Object({}, { additionalProperties: false });
const attachMediaBodySchema = t.Object(
  {
    mediaAssetId: idSchema,
    usage: mediaUsageSchema,
    altText: t.Union([t.Null(), t.String({ maxLength: 500 })]),
    isDecorative: t.Boolean(),
  },
  { additionalProperties: false },
);
const mediaUploadBodySchema = t.Object(
  {
    file: t.File({
      maxSize: "2m",
      type: ["image/jpeg", "image/png", "image/webp"],
    }),
    originalName: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  },
  { additionalProperties: false },
);
const questionImportPreviewBodySchema = t.Object(
  {
    questionBankId: idSchema,
    csv: t.String({ minLength: 1, maxLength: 1_100_000 }),
  },
  { additionalProperties: false },
);
const questionImportCommitBodySchema = t.Object(
  {
    questionBankId: idSchema,
    csv: t.String({ minLength: 1, maxLength: 1_100_000 }),
    sourceHash: t.String({
      pattern: HEX_SHA256_PATTERN,
      minLength: 64,
      maxLength: 64,
    }),
  },
  { additionalProperties: false },
);
const questionImportErrorSchema = t.Object(
  {
    field: t.String({ minLength: 1, maxLength: 200 }),
    code: t.String({ minLength: 1, maxLength: 100 }),
    message: t.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);
const questionImportPreviewRowSchema = t.Object(
  {
    rowNumber: t.Integer({ minimum: 2, maximum: 301 }),
    type: t.Union([t.Null(), t.String({ maxLength: 30 })]),
    label: t.Union([t.Null(), t.String({ maxLength: 120 })]),
    status: t.Union([t.Literal("VALID"), t.Literal("ERROR")]),
    errors: t.Array(questionImportErrorSchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);
const questionImportPreviewSchema = t.Object(
  {
    sourceHash: t.String({
      pattern: HEX_SHA256_PATTERN,
      minLength: 64,
      maxLength: 64,
    }),
    totalRows: t.Integer({ minimum: 1, maximum: 300 }),
    validCount: t.Integer({ minimum: 0, maximum: 300 }),
    errorCount: t.Integer({ minimum: 0, maximum: 300 }),
    rows: t.Array(questionImportPreviewRowSchema, { maxItems: 300 }),
  },
  { additionalProperties: false, $id: "QuestionImportPreview" },
);
const questionImportCommitResultSchema = t.Object(
  { createdCount: t.Integer({ minimum: 1, maximum: 300 }) },
  { additionalProperties: false, $id: "QuestionImportCommitResult" },
);

const success = <T extends TSchema>(schema: T) =>
  t.Object({ data: schema }, { additionalProperties: false });

export const questionApiSchemas = {
  questionBankListQuery: questionBankListQuerySchema,
  questionListQuery: questionListQuerySchema,
  questionBankQuestionsQuery: questionBankQuestionsQuerySchema,
  questionBankIdParams: questionBankIdParamsSchema,
  questionIdParams: questionIdParamsSchema,
  revisionIdParams: revisionIdParamsSchema,
  revisionMediaParams: revisionMediaParamsSchema,
  mutationHeaders: mutationHeadersSchema,
  questionBankCreateBody: questionBankCreateBodySchema,
  questionBankUpdateBody: questionBankUpdateBodySchema,
  createQuestionDraftBody: createQuestionDraftBodySchema,
  updateQuestionRevisionBody: updateQuestionRevisionBodySchema,
  publishQuestionRevisionBody: publishQuestionRevisionBodySchema,
  attachMediaBody: attachMediaBodySchema,
  mediaUploadBody: mediaUploadBodySchema,
  questionImportPreviewBody: questionImportPreviewBodySchema,
  questionImportCommitBody: questionImportCommitBodySchema,
  emptyBody: emptyBodySchema,
  questionContent: questionContentSchema,
  questionBank: questionBankSummarySchema,
  questionBankPage: questionBankPageSchema,
  questionRevisionSummary: questionRevisionSummarySchema,
  questionRevision: questionRevisionResourceSchema,
  questionRevisionPage: questionRevisionPageSchema,
  readinessReport: readinessReportSchema,
  mediaAsset: mediaAssetResourceSchema,
  questionMedia: questionMediaResourceSchema,
  participantQuestion: participantQuestionResourceSchema,
  questionImportPreview: questionImportPreviewSchema,
  questionImportCommitResult: questionImportCommitResultSchema,
  questionBankListResponse: success(questionBankPageSchema),
  questionBankResponse: success(questionBankSummarySchema),
  questionRevisionPageResponse: success(questionRevisionPageSchema),
  questionRevisionResponse: success(questionRevisionResourceSchema),
  readinessResponse: success(readinessReportSchema),
  mediaAssetResponse: success(mediaAssetResourceSchema),
  questionMediaResponse: success(questionMediaResourceSchema),
  questionImportPreviewResponse: success(questionImportPreviewSchema),
  questionImportCommitResponse: success(questionImportCommitResultSchema),
  emptyResponse: success(emptyBodySchema),
} as const;

export type QuestionApiSchemaName = keyof typeof questionApiSchemas;

export type QuestionApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface QuestionApiRouteContract {
  readonly method: QuestionApiMethod;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly request?: {
    readonly params?: TSchema;
    readonly query?: TSchema;
    readonly headers?: TSchema;
    readonly body?: TSchema;
  };
  readonly response?: {
    readonly status: 200 | 201 | 204;
    readonly schemaName?: QuestionApiSchemaName;
    readonly schema?: TSchema;
  };
}

const teacherMutationHeaders = mutationHeadersSchema;

export const questionApiRoutes: readonly QuestionApiRouteContract[] = [
  {
    method: "GET",
    path: "/api/v1/teacher/question-banks",
    operationId: "listQuestionBanks",
    summary: "List dan search question bank dalam scope guru",
    request: { query: questionBankListQuerySchema },
    response: {
      status: 200,
      schemaName: "questionBankListResponse",
      schema: success(questionBankPageSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-banks",
    operationId: "createQuestionBank",
    summary: "Buat question bank",
    request: {
      headers: teacherMutationHeaders,
      body: questionBankCreateBodySchema,
    },
    response: {
      status: 201,
      schemaName: "questionBankResponse",
      schema: success(questionBankSummarySchema),
    },
  },
  {
    method: "GET",
    path: "/api/v1/teacher/question-banks/:id",
    operationId: "getQuestionBank",
    summary: "Detail question bank",
    request: { params: questionBankIdParamsSchema },
    response: {
      status: 200,
      schemaName: "questionBankResponse",
      schema: success(questionBankSummarySchema),
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/teacher/question-banks/:id",
    operationId: "updateQuestionBank",
    summary: "Ubah atau archive question bank",
    request: {
      params: questionBankIdParamsSchema,
      headers: teacherMutationHeaders,
      body: questionBankUpdateBodySchema,
    },
    response: {
      status: 200,
      schemaName: "questionBankResponse",
      schema: success(questionBankSummarySchema),
    },
  },
  {
    method: "GET",
    path: "/api/v1/teacher/question-banks/:id/questions",
    operationId: "listQuestionBankQuestions",
    summary: "List revision question dalam question bank",
    request: {
      params: questionBankIdParamsSchema,
      query: questionBankQuestionsQuerySchema,
    },
    response: {
      status: 200,
      schemaName: "questionRevisionPageResponse",
      schema: success(questionRevisionPageSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-banks/:id/questions",
    operationId: "createQuestionDraft",
    summary: "Buat logical question dan draft revision pertama",
    request: {
      params: questionBankIdParamsSchema,
      headers: teacherMutationHeaders,
      body: createQuestionDraftBodySchema,
    },
    response: {
      status: 201,
      schemaName: "questionRevisionResponse",
      schema: success(questionRevisionResourceSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-imports/preview",
    operationId: "previewQuestionImport",
    summary:
      "Validasi file CSV soal tanpa menyimpan file atau membuat revision",
    request: { body: questionImportPreviewBodySchema },
    response: {
      status: 200,
      schemaName: "questionImportPreviewResponse",
      schema: success(questionImportPreviewSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-imports/commit",
    operationId: "commitQuestionImport",
    summary:
      "Buat seluruh draft soal dari CSV yang telah dipreview secara atomic",
    request: {
      headers: teacherMutationHeaders,
      body: questionImportCommitBodySchema,
    },
    response: {
      status: 200,
      schemaName: "questionImportCommitResponse",
      schema: success(questionImportCommitResultSchema),
    },
  },
  {
    method: "GET",
    path: "/api/v1/teacher/questions",
    operationId: "searchQuestions",
    summary: "Search question revision untuk picker",
    request: { query: questionListQuerySchema },
    response: {
      status: 200,
      schemaName: "questionRevisionPageResponse",
      schema: success(questionRevisionPageSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/questions/:id/revisions",
    operationId: "createQuestionRevision",
    summary: "Buat draft revision dari logical question",
    request: {
      params: questionIdParamsSchema,
      headers: teacherMutationHeaders,
      body: questionContentSchema,
    },
    response: {
      status: 201,
      schemaName: "questionRevisionResponse",
      schema: success(questionRevisionResourceSchema),
    },
  },
  {
    method: "GET",
    path: "/api/v1/teacher/question-revisions/:id",
    operationId: "getQuestionRevision",
    summary: "Detail revision guru termasuk answer key",
    request: { params: revisionIdParamsSchema },
    response: {
      status: 200,
      schemaName: "questionRevisionResponse",
      schema: success(questionRevisionResourceSchema),
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/teacher/question-revisions/:id",
    operationId: "updateQuestionRevision",
    summary: "Update draft atau buat draft baru dari revision published",
    request: {
      params: revisionIdParamsSchema,
      headers: teacherMutationHeaders,
      body: updateQuestionRevisionBodySchema,
    },
    response: {
      status: 200,
      schemaName: "questionRevisionResponse",
      schema: success(questionRevisionResourceSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-revisions/:id/validate",
    operationId: "validateQuestionRevision",
    summary: "Buat readiness report tanpa mengubah revision",
    request: { params: revisionIdParamsSchema },
    response: {
      status: 200,
      schemaName: "readinessResponse",
      schema: success(readinessReportSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-revisions/:id/publish",
    operationId: "publishQuestionRevision",
    summary: "Publish revision secara atomic dan immutable",
    request: {
      params: revisionIdParamsSchema,
      headers: teacherMutationHeaders,
      body: publishQuestionRevisionBodySchema,
    },
    response: {
      status: 200,
      schemaName: "questionRevisionResponse",
      schema: success(questionRevisionResourceSchema),
    },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/media",
    operationId: "uploadQuestionMedia",
    summary: "Upload image asset dengan pemeriksaan magic bytes dan decode",
    request: { headers: teacherMutationHeaders, body: mediaUploadBodySchema },
    response: {
      status: 201,
      schemaName: "mediaAssetResponse",
      schema: success(mediaAssetResourceSchema),
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/teacher/media/:id",
    operationId: "deleteQuestionMedia",
    summary: "Hapus asset yang orphan atau hanya direferensikan draft",
    request: {
      params: revisionIdParamsSchema,
      headers: teacherMutationHeaders,
    },
    response: { status: 204 },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/question-revisions/:id/media",
    operationId: "attachQuestionMedia",
    summary: "Attach asset ke draft revision dengan alt policy",
    request: {
      params: revisionIdParamsSchema,
      headers: teacherMutationHeaders,
      body: attachMediaBodySchema,
    },
    response: {
      status: 200,
      schemaName: "questionMediaResponse",
      schema: success(questionMediaResourceSchema),
    },
  },
  {
    method: "DELETE",
    path: "/api/v1/teacher/question-revisions/:id/media/:mediaId",
    operationId: "detachQuestionMedia",
    summary: "Detach asset dari draft revision",
    request: {
      params: revisionMediaParamsSchema,
      headers: teacherMutationHeaders,
    },
    response: { status: 204 },
  },
] as const;

export const QUESTION_API_ROUTE_PATHS = questionApiRoutes.map(
  (route) => `${route.method} ${route.path}`,
);

export function questionApiRoute<
  TMethod extends QuestionApiMethod,
  TPath extends string,
>(method: TMethod, path: TPath): QuestionApiRouteContract | undefined {
  return questionApiRoutes.find(
    (route) => route.method === method && route.path === path,
  );
}

export type QuestionApiQuestionType = QuestionTypeContract;
export type QuestionApiQuestionBankStatus = QuestionBankStatusContract;
export type QuestionApiRevisionStatus = QuestionRevisionStatusContract;

/** Fields that may never appear in a participant question response. */
export const PARTICIPANT_FORBIDDEN_FIELDS = [
  "isCorrect",
  "correctValue",
  "explanationHtml",
  "contentHash",
  "questionBank",
  "ownerTeacherId",
  "storageKey",
  "sha256",
  "originalName",
] as const;

export function participantSchemaContainsForbiddenFields(): string[] {
  const forbidden = new Set<string>(PARTICIPANT_FORBIDDEN_FIELDS);
  const found: string[] = [];
  walkSchema(participantQuestionResourceSchema, "", forbidden, found);
  return found;
}

function walkSchema(
  schema: unknown,
  path: string,
  forbidden: ReadonlySet<string>,
  found: string[],
): void {
  if (!schema || typeof schema !== "object") return;
  const candidate = schema as Record<string, unknown>;
  const properties = candidate.properties;
  if (properties && typeof properties === "object") {
    for (const [key, value] of Object.entries(properties)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) found.push(nextPath);
      walkSchema(value, nextPath, forbidden, found);
    }
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf"] as const) {
    const value = candidate[key];
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walkSchema(item, `${path}[${index}]`, forbidden, found);
      });
    } else {
      walkSchema(value, path, forbidden, found);
    }
  }
}

export const questionApiOpenApiSchemas: Readonly<Record<string, TSchema>> = {
  QuestionBank: questionBankSummarySchema,
  QuestionBankPage: questionBankPageSchema,
  QuestionOption: questionOptionResourceSchema,
  TrueFalseStatement: trueFalseStatementResourceSchema,
  QuestionMedia: questionMediaResourceSchema,
  QuestionRevisionSummary: questionRevisionSummarySchema,
  QuestionRevisionPage: questionRevisionPageSchema,
  QuestionRevision: questionRevisionResourceSchema,
  QuestionReadinessIssue: readinessIssueSchema,
  QuestionReadinessReport: readinessReportSchema,
  MediaAsset: mediaAssetResourceSchema,
  ParticipantQuestion: participantQuestionResourceSchema,
};
