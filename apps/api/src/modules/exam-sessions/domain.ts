import {
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { ParticipantQuestion } from "../questions/participant-presenter";
import type { ScoringQuestionSnapshot, ScoringResponse } from "../scoring";

export const EXAM_SESSION_STATUSES = [
  "ACTIVE",
  "SUBMITTED",
  "EXPIRED",
  "ENDED",
  "SCORED",
] as const;
export type ExamSessionStatus = (typeof EXAM_SESSION_STATUSES)[number];

export const FINALIZATION_REASONS = [
  "PARTICIPANT_SUBMIT",
  "DEADLINE",
  "SCHEDULE_CLOSE",
  "STAFF_END",
  "RESET_ATTEMPT",
] as const;
export type FinalizationReason = (typeof FINALIZATION_REASONS)[number];

export type RuntimeQuestionType =
  | "SINGLE_CHOICE"
  | "MULTIPLE_RESPONSE"
  | "TRUE_FALSE";

export interface RuntimeOption {
  readonly id: Id;
  readonly position: number;
  readonly contentHtml: string;
  readonly isCorrect: boolean;
}

export interface RuntimeStatement {
  readonly id: Id;
  readonly position: number;
  readonly statementHtml: string;
  readonly correctValue: boolean;
}

/** Internal immutable source loaded from a published revision. */
export interface RuntimeQuestionSource {
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly type: RuntimeQuestionType;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly options: readonly RuntimeOption[];
  readonly statements: readonly RuntimeStatement[];
  readonly media?: readonly ParticipantQuestion["media"][number][];
}

export interface RuntimeQuestionManifest {
  readonly sessionQuestionId: Id;
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly displayPosition: number;
  readonly points: string;
  readonly optionOrder: readonly Id[];
  readonly statementOrder: readonly Id[];
  readonly question: ParticipantQuestion;
}

export interface RuntimeSession {
  readonly id: Id;
  readonly scheduleId: Id;
  readonly examRevisionId: Id;
  readonly participantId: Id | null;
  readonly attemptNo: number;
  readonly status: ExamSessionStatus;
  readonly startedAt: UtcTimestamp;
  readonly deadlineAt: UtcTimestamp;
  readonly lastSeenAt: UtcTimestamp;
  readonly submittedAt: UtcTimestamp | null;
  readonly expiredAt: UtcTimestamp | null;
  readonly endedAt: UtcTimestamp | null;
  readonly scoredAt: UtcTimestamp | null;
  readonly finalizationReason: FinalizationReason | null;
  readonly finalizedByUserId: Id | null;
  readonly finalizationNote: string | null;
  readonly participantNameSnapshot: string;
  readonly classSnapshot: string | null;
  readonly institutionSnapshot: string | null;
  readonly identityExtra: Readonly<Record<string, string>>;
  readonly randomSeed: Uint8Array;
  readonly startIdempotencyKey: string;
  readonly practice: boolean;
  readonly practiceTokenHash?: Uint8Array;
  readonly practiceCredentialHash?: Uint8Array;
  readonly version: number;
  readonly updatedAt?: UtcTimestamp;
}

export interface RuntimeAnswer {
  readonly sessionId: Id;
  readonly sessionQuestionId: Id;
  readonly response: ScoringResponse;
  readonly version: number;
  readonly answeredAt: UtcTimestamp;
}

export interface RuntimeSchedule {
  readonly id: Id;
  readonly mode: "MAIN" | "PRACTICE";
  readonly status: "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly allowLateStart: boolean;
  readonly hardEnd: true;
  readonly examRevisionId: Id;
  readonly examTitle: string;
  readonly instructionsHtml: string;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
  readonly resultReleasePolicy: "MANUAL" | "IMMEDIATE_SCORE";
  readonly mainAccessCodeHash?: Uint8Array;
  readonly practiceTokenHash?: Uint8Array;
  readonly targetClassIds: readonly Id[];
  readonly targetParticipantIds: readonly Id[];
  readonly identityFields?: unknown;
  readonly updatedAt?: UtcTimestamp;
}

export interface ParticipantEligibility {
  readonly participantId: Id;
  readonly participantClassIds: readonly Id[];
}

export interface SessionStartResult {
  readonly session: RuntimeSession;
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly serverNow: UtcTimestamp;
  readonly replayed: boolean;
}

export function participantStartResponse(result: SessionStartResult): {
  readonly session: ParticipantSessionView["session"];
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly serverNow: UtcTimestamp;
  readonly replayed: boolean;
} {
  const {
    randomSeed: _seed,
    finalizationNote: _note,
    practiceTokenHash: _token,
    practiceCredentialHash: _credential,
    ...session
  } = result.session;
  return {
    session,
    manifest: result.manifest,
    serverNow: result.serverNow,
    replayed: result.replayed,
  };
}

export interface ParticipantSessionView {
  readonly session: Omit<
    RuntimeSession,
    | "randomSeed"
    | "finalizationNote"
    | "practiceTokenHash"
    | "practiceCredentialHash"
  > & {
    readonly finalizationNote?: never;
  };
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly answers: readonly RuntimeAnswer[];
  readonly serverNow: UtcTimestamp;
}

export interface SessionAnswerItem {
  readonly sessionQuestionId: Id;
  readonly baseVersion: number;
  readonly response: unknown;
  readonly clientMutationId: string;
}

export type AnswerItemOutcome =
  | { readonly status: "SAVED"; readonly version: number }
  | { readonly status: "UNCHANGED"; readonly version: number }
  | {
      readonly status: "CONFLICT";
      readonly version: number;
      readonly response: ScoringResponse;
    };

export interface BatchAnswerResult {
  readonly sessionId: Id;
  readonly outcomes: readonly (AnswerItemOutcome & {
    readonly sessionQuestionId: Id;
    readonly clientMutationId: string;
  })[];
  readonly serverNow: UtcTimestamp;
  readonly deadlineAt: UtcTimestamp;
}

export interface FinalAnswerItem {
  readonly sessionQuestionId: Id;
  readonly baseVersion: number;
  readonly response: unknown;
}

export interface ExamResult {
  readonly sessionId: Id;
  readonly scheduleId: Id;
  readonly participantId: Id | null;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly unansweredCount: number;
  readonly earnedScore: string;
  readonly maxScore: string;
  readonly percentage: string;
  readonly scoredAt: UtcTimestamp;
  readonly releasedAt: UtcTimestamp | null;
}

export interface SubmitResult {
  readonly session: RuntimeSession;
  readonly result: ExamResult;
  readonly serverNow: UtcTimestamp;
  readonly replayed: boolean;
}

/** Participant-facing submit response; runtime secrets stay server-side. */
export function participantSubmitResponse(result: SubmitResult): {
  readonly session: ParticipantSessionView["session"];
  readonly result: ExamResult;
  readonly serverNow: UtcTimestamp;
  readonly replayed: boolean;
} {
  const {
    randomSeed: _seed,
    finalizationNote: _note,
    practiceTokenHash: _token,
    practiceCredentialHash: _credential,
    ...session
  } = result.session;
  return {
    session,
    result: result.result,
    serverNow: result.serverNow,
    replayed: result.replayed,
  };
}

export class ExamSessionError extends Error {
  constructor(
    readonly code:
      | "SCHEDULE_NOT_AVAILABLE"
      | "ATTEMPT_LIMIT_REACHED"
      | "SESSION_ALREADY_ACTIVE"
      | "SESSION_EXPIRED"
      | "SESSION_SUBMITTED"
      | "SESSION_ENDED"
      | "ANSWER_VERSION_CONFLICT"
      | "INVALID_ANSWER_SHAPE"
      | "PRACTICE_ACCESS_INVALID"
      | "RATE_LIMITED"
      | "SERVICE_BUSY"
      | "AUTHENTICATION_REQUIRED"
      | "AUTH_SESSION_EXPIRED"
      | "IDEMPOTENCY_CONFLICT"
      | "DEADLINE_REACHED"
      | "TIME_EXTENSION_INVALID"
      | "SCHEDULE_CLOSE_CONFLICT"
      | "RESET_NOT_ALLOWED",
    message: string,
    readonly status: 401 | 404 | 409 | 422 | 429 | 503 = 409,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ExamSessionError";
  }
}

export class SessionNotFoundError extends ExamSessionError {
  constructor() {
    super("SCHEDULE_NOT_AVAILABLE", "Sesi ujian tidak ditemukan.", 404);
    this.name = "SessionNotFoundError";
  }
}

export class SessionIdempotencyConflictError extends ExamSessionError {
  constructor() {
    super(
      "IDEMPOTENCY_CONFLICT",
      "Kunci idempotensi sudah dipakai untuk permintaan berbeda.",
      409,
    );
    this.name = "SessionIdempotencyConflictError";
  }
}

export function validateStartIdempotencyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  )
    throw new ExamSessionError(
      "INVALID_ANSWER_SHAPE",
      "startIdempotencyKey harus berupa UUID.",
      422,
    );
  return normalized;
}

export function calculateDeadline(
  startedAt: UtcTimestamp,
  durationSeconds: number,
  endsAt: UtcTimestamp,
): UtcTimestamp {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endsAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
    throw new RangeError("Invalid session timestamp");
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0)
    throw new RangeError("durationSeconds must be positive");
  return formatUtcTimestamp(
    new Date(Math.min(startMs + durationSeconds * 1000, endMs)),
  );
}

/** CSPRNG seed for a session; never derives order from participant data. */
export function createRandomSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return seed;
}

/** Deterministic Fisher-Yates with a session seed, suitable for replay/resume. */
export function deterministicShuffle<T>(
  values: readonly T[],
  seed: Uint8Array,
): T[] {
  const output = [...values];
  let state = seed.reduce((acc, value) => (acc ^ value) >>> 0, 0x9e3779b9);
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [output[index], output[swap]] = [output[swap] as T, output[index] as T];
  }
  return output;
}

export function normalizeAnswerResponse(
  question: RuntimeQuestionSource,
  response: unknown,
  order?: readonly Id[],
): ScoringResponse {
  if (!response || typeof response !== "object")
    throw invalidAnswer("Jawaban harus berupa object.");
  const candidate = response as Record<string, unknown>;
  const optionIds = new Set(question.options.map((option) => option.id));
  const statementIds = new Set(
    question.statements.map((statement) => statement.id),
  );
  if (question.type === "SINGLE_CHOICE") {
    assertKeys(candidate, ["selectedOptionId"]);
    const selected = candidate.selectedOptionId;
    if (selected !== null && typeof selected !== "string")
      throw invalidAnswer("selectedOptionId tidak valid.");
    if (selected !== null && !optionIds.has(selected as Id))
      throw invalidAnswer("Jawaban merujuk opsi yang tidak tersedia.");
    return { selectedOptionId: selected as Id | null };
  }
  if (question.type === "MULTIPLE_RESPONSE") {
    assertKeys(candidate, ["selectedOptionIds"]);
    if (!Array.isArray(candidate.selectedOptionIds))
      throw invalidAnswer("selectedOptionIds harus berupa array.");
    const selected = candidate.selectedOptionIds;
    if (selected.some((id) => typeof id !== "string"))
      throw invalidAnswer("selectedOptionIds berisi ID tidak valid.");
    const ids = [...selected] as Id[];
    if (ids.length > 10)
      throw invalidAnswer("Maksimal sepuluh opsi dapat dipilih.");
    if (new Set(ids).size !== ids.length)
      throw invalidAnswer("Opsi tidak boleh dipilih dua kali.");
    if (ids.some((id) => !optionIds.has(id)))
      throw invalidAnswer("Jawaban merujuk opsi yang tidak tersedia.");
    const rank = new Map(
      (order ?? question.options.map((item) => item.id)).map((id, index) => [
        id,
        index,
      ]),
    );
    ids.sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0));
    return { selectedOptionIds: ids };
  }
  assertKeys(candidate, ["statements"]);
  if (!Array.isArray(candidate.statements))
    throw invalidAnswer("statements harus berupa array.");
  const statements = candidate.statements as unknown[];
  if (statements.length !== 0 && statements.length !== 3)
    throw invalidAnswer("TRUE_FALSE harus berisi tiga pernyataan atau kosong.");
  const normalized = statements.map((value) => {
    if (!value || typeof value !== "object")
      throw invalidAnswer("Pernyataan tidak valid.");
    const item = value as Record<string, unknown>;
    if (typeof item.statementId !== "string" || typeof item.value !== "boolean")
      throw invalidAnswer("Pernyataan TRUE_FALSE tidak valid.");
    if (!statementIds.has(item.statementId as Id))
      throw invalidAnswer("Jawaban merujuk pernyataan yang tidak tersedia.");
    return { statementId: item.statementId as Id, value: item.value };
  });
  if (
    new Set(normalized.map((item) => item.statementId)).size !==
    normalized.length
  )
    throw invalidAnswer("Pernyataan tidak boleh berulang.");
  const rank = new Map(
    (order ?? question.statements.map((item) => item.id)).map((id, index) => [
      id,
      index,
    ]),
  );
  normalized.sort(
    (left, right) =>
      (rank.get(left.statementId) ?? 0) - (rank.get(right.statementId) ?? 0),
  );
  return { statements: normalized };
}

export function toScoringSnapshot(
  item: RuntimeQuestionManifest,
  source: RuntimeQuestionSource,
): ScoringQuestionSnapshot {
  return {
    questionId: item.questionId,
    questionRevisionId: item.questionRevisionId,
    status: "PUBLISHED",
    type: source.type,
    points: item.points,
    options: source.options.map(({ id, isCorrect }) => ({ id, isCorrect })),
    statements: source.statements.map(({ id, correctValue }) => ({
      id,
      correctValue,
    })),
  };
}

export function participantManifest(
  source: RuntimeQuestionSource,
  item: Omit<RuntimeQuestionManifest, "question">,
): RuntimeQuestionManifest {
  const optionRank = item.optionOrder.length
    ? new Map(item.optionOrder.map((id, index) => [id, index + 1]))
    : new Map(source.options.map((option) => [option.id, option.position]));
  const statementRank = item.statementOrder.length
    ? new Map(item.statementOrder.map((id, index) => [id, index + 1]))
    : new Map(
        source.statements.map((statement) => [
          statement.id,
          statement.position,
        ]),
      );
  const options = deterministicByOrder(source.options, optionRank).map(
    ({ id, contentHtml }, index) => ({
      id,
      position: index + 1,
      contentHtml,
    }),
  );
  const statements = deterministicByOrder(source.statements, statementRank).map(
    ({ id, statementHtml }, index) => ({
      id,
      position: index + 1,
      statementHtml,
    }),
  );
  return {
    ...item,
    question: {
      questionId: source.questionId,
      questionRevisionId: source.questionRevisionId,
      type: source.type,
      stimulusHtml: source.stimulusHtml,
      promptHtml: source.promptHtml,
      options,
      statements,
      media: source.media ?? [],
    },
  };
}

function deterministicByOrder<T extends { readonly id: Id }>(
  values: readonly T[],
  rank: ReadonlyMap<Id, number>,
): T[] {
  return [...values].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function invalidAnswer(message: string): ExamSessionError {
  return new ExamSessionError("INVALID_ANSWER_SHAPE", message, 422);
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const expected = new Set(allowed);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key)))
    throw invalidAnswer("Format jawaban tidak valid.");
}

function assertTimestamp(
  value: string,
  field: string,
): asserts value is UtcTimestamp {
  if (!parseUtcTimestamp(value))
    throw new RangeError(`${field} is not a UTC timestamp`);
}

export function assertRuntimeSession(session: RuntimeSession): void {
  if (
    !parseId(session.id) ||
    !parseId(session.scheduleId) ||
    !parseId(session.examRevisionId)
  )
    throw new TypeError("Runtime session IDs are invalid");
  assertTimestamp(session.startedAt, "startedAt");
  assertTimestamp(session.deadlineAt, "deadlineAt");
  if (!EXAM_SESSION_STATUSES.includes(session.status))
    throw new TypeError("Runtime session status is invalid");
}
