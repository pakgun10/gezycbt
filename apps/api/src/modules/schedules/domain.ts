import {
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";

export const SCHEDULE_MODES = ["MAIN", "PRACTICE"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export const SCHEDULE_STATUSES = [
  "DRAFT",
  "READY",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const RESULT_RELEASE_POLICIES = ["MANUAL", "IMMEDIATE_SCORE"] as const;
export type ResultReleasePolicy = (typeof RESULT_RELEASE_POLICIES)[number];

export const SCHEDULE_TRANSITIONS = [
  "READY",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
] as const;
export type ScheduleTransition = (typeof SCHEDULE_TRANSITIONS)[number];

export interface ScheduleIdentityField {
  readonly key: string;
  readonly label: string;
  readonly type: "TEXT";
  readonly required: boolean;
  readonly maxLength?: number;
  readonly allowedValues?: readonly string[];
}

export interface ScheduleExamReference {
  readonly id: Id;
  readonly examId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly revisionStatus: "DRAFT" | "PUBLISHED";
  readonly examStatus: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

/** Public schedule representation. Raw access digests are deliberately absent. */
export interface Schedule {
  readonly id: Id;
  readonly examRevisionId: Id;
  readonly exam: ScheduleExamReference;
  readonly mode: ScheduleMode;
  readonly status: ScheduleStatus;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly hardEnd: true;
  readonly allowLateStart: boolean;
  readonly resultReleasePolicy: ResultReleasePolicy;
  readonly hasPracticeToken: boolean;
  readonly practiceTokenHint: string | null;
  readonly hasMainAccessCode: boolean;
  readonly mainAccessCodeHint: string | null;
  readonly identityFields: readonly ScheduleIdentityField[] | null;
  readonly targetClassIds: readonly Id[];
  readonly targetParticipantIds: readonly Id[];
  readonly closedAt: UtcTimestamp | null;
  readonly closedByUserId: Id | null;
  readonly closeReason: string | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CreateScheduleInput {
  readonly examRevisionId: Id;
  readonly mode: ScheduleMode;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly hardEnd?: boolean;
  readonly allowLateStart: boolean;
  readonly resultReleasePolicy: ResultReleasePolicy;
  readonly identityFieldsJson?: string | null;
  readonly targetClassIds?: readonly Id[];
  readonly targetParticipantIds?: readonly Id[];
}

export interface UpdateScheduleInput {
  readonly startsAt?: UtcTimestamp;
  readonly endsAt?: UtcTimestamp;
  readonly durationSeconds?: number;
  readonly maxAttempts?: number;
  readonly hardEnd?: boolean;
  readonly allowLateStart?: boolean;
  readonly resultReleasePolicy?: ResultReleasePolicy;
  readonly identityFieldsJson?: string | null;
  readonly targetClassIds?: readonly Id[];
  readonly targetParticipantIds?: readonly Id[];
}

export interface NormalizedCreateScheduleInput
  extends Omit<
    CreateScheduleInput,
    "hardEnd" | "identityFieldsJson" | "targetClassIds" | "targetParticipantIds"
  > {
  readonly hardEnd: true;
  readonly identityFieldsJson: string | null;
  readonly targetClassIds: readonly Id[];
  readonly targetParticipantIds: readonly Id[];
}

export interface NormalizedUpdateScheduleInput
  extends Omit<
    UpdateScheduleInput,
    "identityFieldsJson" | "targetClassIds" | "targetParticipantIds"
  > {
  readonly identityFieldsJson?: string | null;
  readonly targetClassIds?: readonly Id[];
  readonly targetParticipantIds?: readonly Id[];
}

export class ScheduleValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_SCHEDULE") {
    super(message);
    this.name = "ScheduleValidationError";
    this.code = code;
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(message = "Schedule was not found") {
    super(message);
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleExamRevisionNotFoundError extends Error {
  constructor() {
    super("Exam revision was not found");
    this.name = "ScheduleExamRevisionNotFoundError";
  }
}

export class ScheduleExamRevisionNotPublishedError extends Error {
  constructor() {
    super("Schedule must reference a published exam revision");
    this.name = "ScheduleExamRevisionNotPublishedError";
  }
}

export class ScheduleImmutableError extends Error {
  constructor(message = "Schedule can no longer be changed") {
    super(message);
    this.name = "ScheduleImmutableError";
  }
}

export class ScheduleVersionConflictError extends Error {
  constructor() {
    super("Schedule was changed by another request");
    this.name = "ScheduleVersionConflictError";
  }
}

export class ScheduleTransitionError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_SCHEDULE_TRANSITION") {
    super(message);
    this.name = "ScheduleTransitionError";
    this.code = code;
  }
}

export class ScheduleNotReadyError extends ScheduleTransitionError {
  constructor(readonly reasons: readonly string[]) {
    super("Schedule is not ready to open", "SCHEDULE_NOT_READY");
    this.name = "ScheduleNotReadyError";
  }
}

export class ScheduleWindowError extends ScheduleTransitionError {
  constructor(message = "Schedule is outside its configured time window") {
    super(message, "SCHEDULE_WINDOW_CLOSED");
    this.name = "ScheduleWindowError";
  }
}

export interface ScheduleReadiness {
  readonly isReady: boolean;
  readonly reasons: readonly string[];
}

export function validateCreateScheduleInput(
  input: CreateScheduleInput,
): NormalizedCreateScheduleInput {
  const mode = validateEnum(input.mode, SCHEDULE_MODES, "mode");
  const startsAt = validateTimestamp(input.startsAt, "startsAt");
  const endsAt = validateTimestamp(input.endsAt, "endsAt");
  validateWindow(startsAt, endsAt);
  const durationSeconds = validateDuration(input.durationSeconds);
  validateDurationFitsWindow(startsAt, endsAt, durationSeconds);
  const maxAttempts = validateMaxAttempts(input.maxAttempts, mode);
  if (input.hardEnd !== undefined && input.hardEnd !== true)
    throw new ScheduleValidationError(
      "hardEnd must be true for every schedule",
      "HARD_END_REQUIRED",
    );
  const resultReleasePolicy = validateEnum(
    input.resultReleasePolicy,
    RESULT_RELEASE_POLICIES,
    "resultReleasePolicy",
  );
  validateReleasePolicy(mode, resultReleasePolicy);
  const targetClassIds = normalizeIds(input.targetClassIds, "targetClassIds");
  const targetParticipantIds = normalizeIds(
    input.targetParticipantIds,
    "targetParticipantIds",
  );
  validateTargets(mode, targetClassIds, targetParticipantIds, false);
  const identityFieldsJson = normalizeIdentityFieldsJson(
    input.identityFieldsJson,
    mode,
  );
  return {
    examRevisionId: validateId(input.examRevisionId, "examRevisionId"),
    mode,
    startsAt,
    endsAt,
    durationSeconds,
    maxAttempts,
    hardEnd: true,
    allowLateStart: validateBoolean(input.allowLateStart, "allowLateStart"),
    resultReleasePolicy,
    identityFieldsJson,
    targetClassIds,
    targetParticipantIds,
  };
}

export function validateUpdateScheduleInput(
  input: UpdateScheduleInput,
  mode: ScheduleMode,
): NormalizedUpdateScheduleInput {
  if (Object.keys(input).length === 0)
    throw new ScheduleValidationError(
      "At least one schedule field must be updated",
      "EMPTY_UPDATE",
    );
  const result: NormalizedUpdateScheduleInput = {
    ...(input.startsAt === undefined
      ? {}
      : { startsAt: validateTimestamp(input.startsAt, "startsAt") }),
    ...(input.endsAt === undefined
      ? {}
      : { endsAt: validateTimestamp(input.endsAt, "endsAt") }),
    ...(input.durationSeconds === undefined
      ? {}
      : { durationSeconds: validateDuration(input.durationSeconds) }),
    ...(input.maxAttempts === undefined
      ? {}
      : { maxAttempts: validateMaxAttempts(input.maxAttempts, mode) }),
    ...(input.hardEnd === undefined
      ? {}
      : {
          hardEnd: (() => {
            if (input.hardEnd !== true)
              throw new ScheduleValidationError(
                "hardEnd must be true for every schedule",
                "HARD_END_REQUIRED",
              );
            return true as const;
          })(),
        }),
    ...(input.allowLateStart === undefined
      ? {}
      : {
          allowLateStart: validateBoolean(
            input.allowLateStart,
            "allowLateStart",
          ),
        }),
    ...(input.resultReleasePolicy === undefined
      ? {}
      : {
          resultReleasePolicy: validateEnum(
            input.resultReleasePolicy,
            RESULT_RELEASE_POLICIES,
            "resultReleasePolicy",
          ),
        }),
    ...(input.identityFieldsJson === undefined
      ? {}
      : {
          identityFieldsJson: normalizeIdentityFieldsJson(
            input.identityFieldsJson,
            mode,
          ),
        }),
    ...(input.targetClassIds === undefined
      ? {}
      : {
          targetClassIds: normalizeIds(input.targetClassIds, "targetClassIds"),
        }),
    ...(input.targetParticipantIds === undefined
      ? {}
      : {
          targetParticipantIds: normalizeIds(
            input.targetParticipantIds,
            "targetParticipantIds",
          ),
        }),
  };
  if (result.startsAt !== undefined && result.endsAt !== undefined)
    validateWindow(result.startsAt, result.endsAt);
  if (mode === "MAIN" && result.resultReleasePolicy !== undefined)
    validateReleasePolicy(mode, result.resultReleasePolicy);
  if (mode === "PRACTICE" && result.resultReleasePolicy !== undefined)
    validateReleasePolicy(mode, result.resultReleasePolicy);
  return result;
}

export function validateCompleteSchedule(
  schedule: Schedule,
  now: UtcTimestamp,
): ScheduleReadiness {
  const reasons: string[] = [];
  if (schedule.exam.revisionStatus !== "PUBLISHED")
    reasons.push("EXAM_REVISION_NOT_PUBLISHED");
  if (schedule.exam.examStatus !== "PUBLISHED")
    reasons.push("EXAM_NOT_PUBLISHED");
  if (Date.parse(schedule.startsAt) >= Date.parse(schedule.endsAt))
    reasons.push("INVALID_WINDOW");
  if (
    !durationFitsWindow(
      schedule.startsAt,
      schedule.endsAt,
      schedule.durationSeconds,
    )
  )
    reasons.push("DURATION_EXCEEDS_WINDOW");
  if (schedule.hardEnd !== true) reasons.push("HARD_END_REQUIRED");
  if (schedule.mode === "MAIN") {
    if (schedule.maxAttempts !== 1) reasons.push("MAIN_ATTEMPT_MUST_BE_ONE");
    if (schedule.resultReleasePolicy !== "MANUAL")
      reasons.push("MAIN_RELEASE_POLICY_INVALID");
    if (
      schedule.targetClassIds.length === 0 &&
      schedule.targetParticipantIds.length === 0
    )
      reasons.push("MAIN_TARGET_REQUIRED");
    if (!schedule.hasMainAccessCode) reasons.push("MAIN_ACCESS_CODE_REQUIRED");
    if (schedule.hasPracticeToken || schedule.identityFields !== null)
      reasons.push("MAIN_PRACTICE_FIELDS_FORBIDDEN");
  } else {
    if (schedule.maxAttempts < 1) reasons.push("PRACTICE_ATTEMPTS_INVALID");
    if (schedule.resultReleasePolicy !== "IMMEDIATE_SCORE")
      reasons.push("PRACTICE_RELEASE_POLICY_INVALID");
    if (
      schedule.targetClassIds.length > 0 ||
      schedule.targetParticipantIds.length > 0
    )
      reasons.push("PRACTICE_TARGETS_FORBIDDEN");
    if (!schedule.hasPracticeToken) reasons.push("PRACTICE_TOKEN_REQUIRED");
    if (!schedule.identityFields) reasons.push("IDENTITY_FIELDS_REQUIRED");
    else if (
      !schedule.identityFields.some(
        (field) => field.key === "name" && field.required,
      )
    )
      reasons.push("IDENTITY_NAME_REQUIRED");
    if (schedule.hasMainAccessCode)
      reasons.push("PRACTICE_MAIN_CODE_FORBIDDEN");
  }
  if (Date.parse(schedule.endsAt) <= Date.parse(now))
    reasons.push("WINDOW_ALREADY_ENDED");
  return { isReady: reasons.length === 0, reasons };
}

export function isWithinScheduleWindow(
  schedule: Pick<Schedule, "startsAt" | "endsAt">,
  now: UtcTimestamp,
): boolean {
  const current = Date.parse(now);
  return (
    current >= Date.parse(schedule.startsAt) &&
    current < Date.parse(schedule.endsAt)
  );
}

export function normalizeIdentityFieldsJson(
  value: string | null | undefined,
  mode: ScheduleMode,
): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  if (typeof value !== "string")
    throw new ScheduleValidationError(
      "identityFieldsJson must be JSON text",
      "INVALID_IDENTITY_FIELDS",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ScheduleValidationError(
      "identityFieldsJson must contain valid JSON",
      "INVALID_IDENTITY_FIELDS",
    );
  }
  if (!Array.isArray(parsed) || parsed.length > 20)
    throw new ScheduleValidationError(
      "identityFieldsJson must be an array with at most 20 fields",
      "INVALID_IDENTITY_FIELDS",
    );
  const fields = parsed.map((item, index) =>
    normalizeIdentityField(item, index),
  );
  const keys = new Set(fields.map((field) => field.key));
  if (keys.size !== fields.length)
    throw new ScheduleValidationError(
      "identityFieldsJson cannot contain duplicate keys",
      "INVALID_IDENTITY_FIELDS",
    );
  if (mode === "MAIN" && fields.length > 0)
    throw new ScheduleValidationError(
      "MAIN schedule cannot define practice identity fields",
      "MAIN_IDENTITY_FIELDS_FORBIDDEN",
    );
  return JSON.stringify(fields);
}

function normalizeIdentityField(
  value: unknown,
  index: number,
): ScheduleIdentityField {
  if (!value || typeof value !== "object")
    throw new ScheduleValidationError(
      `Identity field ${index + 1} is invalid`,
      "INVALID_IDENTITY_FIELDS",
    );
  const candidate = value as Record<string, unknown>;
  const key = candidate.key;
  const label = candidate.label;
  const type = candidate.type;
  const required = candidate.required;
  if (
    typeof key !== "string" ||
    !/^[a-z][a-z0-9_]{0,49}$/u.test(key) ||
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 100 ||
    type !== "TEXT" ||
    typeof required !== "boolean"
  )
    throw new ScheduleValidationError(
      `Identity field ${index + 1} is invalid`,
      "INVALID_IDENTITY_FIELDS",
    );
  const maxLength = candidate.maxLength;
  if (
    maxLength !== undefined &&
    (typeof maxLength !== "number" ||
      !Number.isSafeInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > 500)
  )
    throw new ScheduleValidationError(
      `Identity field ${index + 1} has an invalid maxLength`,
      "INVALID_IDENTITY_FIELDS",
    );
  const allowedValues = candidate.allowedValues;
  if (
    allowedValues !== undefined &&
    (!Array.isArray(allowedValues) ||
      allowedValues.some(
        (item) => typeof item !== "string" || item.length > 100,
      ))
  )
    throw new ScheduleValidationError(
      `Identity field ${index + 1} has invalid allowedValues`,
      "INVALID_IDENTITY_FIELDS",
    );
  return {
    key,
    label: label.trim(),
    type: "TEXT",
    required,
    ...(typeof maxLength === "number" ? { maxLength } : {}),
    ...(Array.isArray(allowedValues) ? { allowedValues } : {}),
  };
}

function validateTargets(
  mode: ScheduleMode,
  classIds: readonly Id[],
  participantIds: readonly Id[],
  requireMainTarget: boolean,
): void {
  if (mode === "PRACTICE" && (classIds.length > 0 || participantIds.length > 0))
    throw new ScheduleValidationError(
      "PRACTICE schedule cannot target classes or participants",
      "PRACTICE_TARGETS_FORBIDDEN",
    );
  if (
    mode === "MAIN" &&
    requireMainTarget &&
    classIds.length === 0 &&
    participantIds.length === 0
  )
    throw new ScheduleValidationError(
      "MAIN schedule requires at least one class or participant target",
      "MAIN_TARGET_REQUIRED",
    );
}

function validateReleasePolicy(
  mode: ScheduleMode,
  policy: ResultReleasePolicy,
): void {
  if (
    (mode === "MAIN" && policy !== "MANUAL") ||
    (mode === "PRACTICE" && policy !== "IMMEDIATE_SCORE")
  )
    throw new ScheduleValidationError(
      `${mode} schedule has an invalid result release policy`,
      "INVALID_RELEASE_POLICY",
    );
}

function validateWindow(startsAt: UtcTimestamp, endsAt: UtcTimestamp): void {
  if (Date.parse(startsAt) >= Date.parse(endsAt))
    throw new ScheduleValidationError(
      "startsAt must be before endsAt",
      "INVALID_WINDOW",
    );
}

function validateDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400)
    throw new ScheduleValidationError(
      "durationSeconds must be between 1 and 86400",
      "INVALID_DURATION",
    );
  return value;
}

export function durationFitsWindow(
  startsAt: UtcTimestamp,
  endsAt: UtcTimestamp,
  durationSeconds: number,
): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(start) && Number.isFinite(end)
    ? durationSeconds <= (end - start) / 1000
    : false;
}

function validateDurationFitsWindow(
  startsAt: UtcTimestamp,
  endsAt: UtcTimestamp,
  durationSeconds: number,
): void {
  if (!durationFitsWindow(startsAt, endsAt, durationSeconds))
    throw new ScheduleValidationError(
      "durationSeconds must not exceed the schedule window",
      "DURATION_EXCEEDS_WINDOW",
    );
}

function validateMaxAttempts(value: number, mode: ScheduleMode): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535)
    throw new ScheduleValidationError(
      "maxAttempts must be between 1 and 65535",
      "INVALID_ATTEMPTS",
    );
  if (mode === "MAIN" && value !== 1)
    throw new ScheduleValidationError(
      "MAIN schedule must allow exactly one attempt",
      "MAIN_ATTEMPT_MUST_BE_ONE",
    );
  return value;
}

function normalizeIds(
  values: readonly Id[] | undefined,
  field: string,
): readonly Id[] {
  if (values === undefined) return [];
  const normalized = values.map((value) => validateId(value, field));
  if (new Set(normalized).size !== normalized.length)
    throw new ScheduleValidationError(
      `${field} cannot contain duplicates`,
      "DUPLICATE_TARGET",
    );
  return normalized;
}

function validateTimestamp(value: UtcTimestamp, field: string): UtcTimestamp {
  const parsed = parseUtcTimestamp(value);
  if (!parsed)
    throw new ScheduleValidationError(
      `${field} must be an ISO timestamp in UTC`,
      "INVALID_TIMESTAMP",
    );
  return parsed;
}

function validateId(value: Id, field: string): Id {
  if (!parseId(value))
    throw new ScheduleValidationError(`${field} is invalid`, "INVALID_ID");
  return value;
}

function validateBoolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean")
    throw new ScheduleValidationError(
      `${field} must be boolean`,
      "INVALID_BOOLEAN",
    );
  return value;
}

function validateEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
): T[number] {
  if (!values.includes(value as T[number]))
    throw new ScheduleValidationError(
      `${field} is invalid`,
      `INVALID_${field.toUpperCase()}`,
    );
  return value as T[number];
}
