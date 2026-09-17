import { type TSchema, t } from "elysia";

const ID_PATTERN = "^(?:0|[1-9][0-9]*)$";
const UTC_TIMESTAMP_PATTERN =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
const ACCESS_CODE_PATTERN =
  "^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789-]{5,20}$";

const idSchema = t.String({ pattern: ID_PATTERN, minLength: 1, maxLength: 20 });
const utcTimestampSchema = t.String({
  pattern: UTC_TIMESTAMP_PATTERN,
  minLength: 24,
  maxLength: 24,
});
const mutationHeadersSchema = t.Object(
  {
    "x-csrf-token": t.String({ minLength: 1, maxLength: 256 }),
    "idempotency-key": t.String({ minLength: 16, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const cursorQuerySchema = t.Object(
  {
    cursor: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    status: t.Optional(
      t.Union([
        t.Literal("DRAFT"),
        t.Literal("READY"),
        t.Literal("OPEN"),
        t.Literal("CLOSED"),
        t.Literal("ARCHIVED"),
      ]),
    ),
    mode: t.Optional(t.Union([t.Literal("MAIN"), t.Literal("PRACTICE")])),
  },
  { additionalProperties: false },
);

const identityFieldSchema = t.Object(
  {
    key: t.String({ minLength: 1, maxLength: 50 }),
    label: t.String({ minLength: 1, maxLength: 100 }),
    type: t.Literal("TEXT"),
    required: t.Boolean(),
    maxLength: t.Optional(t.Integer({ minimum: 1, maximum: 200 })),
    allowedValues: t.Optional(
      t.Array(t.String({ maxLength: 100 }), { maxItems: 100 }),
    ),
  },
  { additionalProperties: false },
);

const scheduleModeSchema = t.Union([t.Literal("MAIN"), t.Literal("PRACTICE")]);
const releasePolicySchema = t.Union([
  t.Literal("MANUAL"),
  t.Literal("IMMEDIATE_SCORE"),
]);
const scheduleStatusSchema = t.Union([
  t.Literal("DRAFT"),
  t.Literal("READY"),
  t.Literal("OPEN"),
  t.Literal("CLOSED"),
  t.Literal("ARCHIVED"),
]);
const targetIdsSchema = t.Array(idSchema, { maxItems: 1_500 });
const scheduleFields = {
  examRevisionId: idSchema,
  mode: scheduleModeSchema,
  startsAt: utcTimestampSchema,
  endsAt: utcTimestampSchema,
  durationSeconds: t.Integer({ minimum: 1, maximum: 86_400 }),
  maxAttempts: t.Integer({ minimum: 1, maximum: 100 }),
  hardEnd: t.Optional(t.Literal(true)),
  allowLateStart: t.Boolean(),
  resultReleasePolicy: releasePolicySchema,
  identityFields: t.Optional(t.Array(identityFieldSchema, { maxItems: 20 })),
  targetClassIds: t.Optional(targetIdsSchema),
  targetParticipantIds: t.Optional(targetIdsSchema),
};

const scheduleCreateBodySchema = t.Object(scheduleFields, {
  additionalProperties: false,
});
const scheduleUpdateBodySchema = t.Object(
  {
    startsAt: t.Optional(utcTimestampSchema),
    endsAt: t.Optional(utcTimestampSchema),
    durationSeconds: t.Optional(t.Integer({ minimum: 1, maximum: 86_400 })),
    maxAttempts: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    hardEnd: t.Optional(t.Literal(true)),
    allowLateStart: t.Optional(t.Boolean()),
    resultReleasePolicy: t.Optional(releasePolicySchema),
    identityFields: t.Optional(t.Array(identityFieldSchema, { maxItems: 20 })),
    targetClassIds: t.Optional(targetIdsSchema),
    targetParticipantIds: t.Optional(targetIdsSchema),
    expectedUpdatedAt: utcTimestampSchema,
  },
  { additionalProperties: false },
);
const scheduleTransitionBodySchema = t.Object(
  {
    expectedUpdatedAt: utcTimestampSchema,
    closeReason: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false },
);
const rotateAccessCodeBodySchema = t.Object(
  {
    expectedUpdatedAt: utcTimestampSchema,
    proposedCode: t.Optional(
      t.String({ minLength: 5, maxLength: 20, pattern: ACCESS_CODE_PATTERN }),
    ),
  },
  { additionalProperties: false },
);
const scheduleIdParamsSchema = t.Object(
  { id: idSchema },
  { additionalProperties: false },
);

const identityFieldResourceSchema = t.Object(
  {
    ...identityFieldSchema.properties,
  },
  { additionalProperties: false },
);
const scheduleResourceSchema = t.Object(
  {
    id: idSchema,
    examRevisionId: idSchema,
    mode: scheduleModeSchema,
    status: scheduleStatusSchema,
    startsAt: utcTimestampSchema,
    endsAt: utcTimestampSchema,
    durationSeconds: t.Integer({ minimum: 1, maximum: 86_400 }),
    maxAttempts: t.Integer({ minimum: 1, maximum: 100 }),
    hardEnd: t.Literal(true),
    allowLateStart: t.Boolean(),
    resultReleasePolicy: releasePolicySchema,
    hasPracticeToken: t.Boolean(),
    practiceTokenHint: t.Union([t.Null(), t.String({ maxLength: 20 })]),
    hasMainAccessCode: t.Boolean(),
    mainAccessCodeHint: t.Union([t.Null(), t.String({ maxLength: 20 })]),
    identityFields: t.Union([
      t.Null(),
      t.Array(identityFieldResourceSchema, { maxItems: 20 }),
    ]),
    targetClassIds: targetIdsSchema,
    targetParticipantIds: targetIdsSchema,
    closedAt: t.Union([t.Null(), utcTimestampSchema]),
    closedByUserId: t.Union([t.Null(), idSchema]),
    closeReason: t.Union([t.Null(), t.String({ maxLength: 500 })]),
    createdAt: utcTimestampSchema,
    updatedAt: utcTimestampSchema,
  },
  { additionalProperties: false, $id: "Schedule" },
);
const schedulePageSchema = t.Object(
  {
    items: t.Array(scheduleResourceSchema),
    nextCursor: t.Union([t.Null(), t.String()]),
  },
  { additionalProperties: false, $id: "SchedulePage" },
);
const rotatedAccessCodeSchema = t.Object(
  {
    scheduleId: idSchema,
    kind: t.Union([t.Literal("PRACTICE_TOKEN"), t.Literal("MAIN_ACCESS_CODE")]),
    code: t.String({
      pattern: "^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$",
      minLength: 5,
      maxLength: 5,
    }),
    hint: t.String({ minLength: 1, maxLength: 20 }),
    updatedAt: utcTimestampSchema,
  },
  { additionalProperties: false, $id: "RotatedScheduleAccessCode" },
);
const success = <T extends TSchema>(schema: T) =>
  t.Object({ data: schema }, { additionalProperties: false });

export const scheduleApiSchemas = {
  mutationHeaders: mutationHeadersSchema,
  cursorQuery: cursorQuerySchema,
  scheduleIdParams: scheduleIdParamsSchema,
  scheduleCreateBody: scheduleCreateBodySchema,
  scheduleUpdateBody: scheduleUpdateBodySchema,
  scheduleTransitionBody: scheduleTransitionBodySchema,
  rotateAccessCodeBody: rotateAccessCodeBodySchema,
  schedule: scheduleResourceSchema,
  schedulePage: schedulePageSchema,
  rotatedAccessCode: rotatedAccessCodeSchema,
  scheduleResponse: success(scheduleResourceSchema),
  schedulePageResponse: success(schedulePageSchema),
  rotatedAccessCodeResponse: success(rotatedAccessCodeSchema),
} as const;

export type ScheduleApiSchemaName = keyof typeof scheduleApiSchemas;
export type ScheduleApiMethod = "GET" | "POST" | "PATCH";

export interface ScheduleApiRouteContract {
  readonly method: ScheduleApiMethod;
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
    readonly status: 200 | 201;
    readonly schemaName?: ScheduleApiSchemaName;
  };
}

export const scheduleApiRoutes: readonly ScheduleApiRouteContract[] = [
  {
    method: "GET",
    path: "/api/v1/teacher/schedules",
    operationId: "listSchedules",
    summary: "List schedule dalam scope guru",
    request: { query: cursorQuerySchema },
    response: { status: 200, schemaName: "schedulePageResponse" },
  },
  {
    method: "POST",
    path: "/api/v1/teacher/schedules",
    operationId: "createSchedule",
    summary: "Buat schedule draft",
    request: { headers: mutationHeadersSchema, body: scheduleCreateBodySchema },
    response: { status: 201, schemaName: "scheduleResponse" },
  },
  {
    method: "GET",
    path: "/api/v1/teacher/schedules/:id",
    operationId: "getSchedule",
    summary: "Baca detail schedule",
    request: { params: scheduleIdParamsSchema },
    response: { status: 200, schemaName: "scheduleResponse" },
  },
  {
    method: "PATCH",
    path: "/api/v1/teacher/schedules/:id",
    operationId: "updateSchedule",
    summary: "Ubah schedule draft dengan optimistic version",
    request: {
      params: scheduleIdParamsSchema,
      headers: mutationHeadersSchema,
      body: scheduleUpdateBodySchema,
    },
    response: { status: 200, schemaName: "scheduleResponse" },
  },
  ...(["rotate-token", "rotate-main-code"] as const).map((suffix) => ({
    method: "POST" as const,
    path: `/api/v1/teacher/schedules/:id/${suffix}`,
    operationId:
      suffix === "rotate-token"
        ? "rotatePracticeToken"
        : "rotateMainAccessCode",
    summary:
      suffix === "rotate-token"
        ? "Rotate practice token"
        : "Rotate MAIN access code",
    request: {
      params: scheduleIdParamsSchema,
      headers: mutationHeadersSchema,
      body: rotateAccessCodeBodySchema,
    },
    response: {
      status: 200 as const,
      schemaName: "rotatedAccessCodeResponse" as const,
    },
  })),
  {
    method: "POST",
    path: "/api/v1/teacher/schedules/:id/close",
    operationId: "closeSchedule",
    summary: "Tutup schedule dengan reason",
    request: {
      params: scheduleIdParamsSchema,
      headers: mutationHeadersSchema,
      body: scheduleTransitionBodySchema,
    },
    response: { status: 200, schemaName: "scheduleResponse" },
  },
];

export const SCHEDULE_API_ROUTE_PATHS = scheduleApiRoutes.map(
  (route) => `${route.method} ${route.path}`,
);

export function scheduleApiRoute(
  method: ScheduleApiMethod,
  path: string,
): ScheduleApiRouteContract | undefined {
  return scheduleApiRoutes.find(
    (route) => route.method === method && route.path === path,
  );
}

export const scheduleApiOpenApiSchemas: Readonly<Record<string, TSchema>> = {
  Schedule: scheduleResourceSchema,
  SchedulePage: schedulePageSchema,
  RotatedScheduleAccessCode: rotatedAccessCodeSchema,
  ScheduleResponse: success(scheduleResourceSchema),
  SchedulePageResponse: success(schedulePageSchema),
  RotatedScheduleAccessCodeResponse: success(rotatedAccessCodeSchema),
};
