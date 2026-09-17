import type { Id, UtcTimestamp } from "@gezycbt/contracts";

export const EXAM_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const EXAM_REVISION_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type ExamRevisionStatus = (typeof EXAM_REVISION_STATUSES)[number];

export interface ExamSummary {
  readonly id: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly status: ExamStatus;
  readonly currentPublishedRevisionId: Id | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface ExamQuestion {
  readonly id: Id;
  readonly examRevisionId: Id;
  readonly questionRevisionId: Id;
  readonly position: number;
  readonly points: string;
  readonly createdAt: UtcTimestamp;
}

export interface ExamRevision {
  readonly id: Id;
  readonly examId: Id;
  readonly exam: ExamSummary;
  readonly revisionNo: number;
  readonly status: ExamRevisionStatus;
  readonly title: string;
  readonly instructionsHtml: string;
  readonly durationSeconds: number;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
  /** Drafts keep this at 0.00 until readiness/publish computes it. */
  readonly totalPoints: string;
  readonly publishedAt: UtcTimestamp | null;
  readonly questions: readonly ExamQuestion[];
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

/** Minimal published question data needed when attaching a question. */
export interface ExamQuestionReference {
  readonly id: Id;
  readonly questionId: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly status: ExamRevisionStatus;
}

export interface ExamDraftMetadata {
  readonly title: string;
  readonly instructionsHtml: string;
  readonly durationSeconds: number;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
}

export interface CreateExamInput extends ExamDraftMetadata {
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
}

export type UpdateExamRevisionInput = Partial<ExamDraftMetadata>;

export interface AddExamQuestionInput {
  readonly questionRevisionId: Id;
  readonly points: string;
  /** One-based position. Omit to append. */
  readonly position?: number;
}

export class ExamValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_EXAM") {
    super(message);
    this.name = "ExamValidationError";
    this.code = code;
  }
}

export class ExamNotFoundError extends Error {
  constructor(message = "Exam was not found") {
    super(message);
    this.name = "ExamNotFoundError";
  }
}

export class ExamRevisionNotFoundError extends Error {
  constructor(message = "Exam revision was not found") {
    super(message);
    this.name = "ExamRevisionNotFoundError";
  }
}

export class ExamImmutableError extends Error {
  constructor() {
    super("Published exam revisions are immutable");
    this.name = "ExamImmutableError";
  }
}

export class ExamVersionConflictError extends Error {
  constructor() {
    super("Exam revision was changed by another request");
    this.name = "ExamVersionConflictError";
  }
}

export class ExamQuestionNotFoundError extends Error {
  constructor() {
    super("Question revision was not found");
    this.name = "ExamQuestionNotFoundError";
  }
}

export class ExamQuestionDuplicateError extends Error {
  constructor() {
    super("Question revision is already in this exam revision");
    this.name = "ExamQuestionDuplicateError";
  }
}

export class ExamQuestionOrderError extends Error {
  constructor() {
    super("Question order must contain each selected question exactly once");
    this.name = "ExamQuestionOrderError";
  }
}

export function validateCreateExamInput(
  input: CreateExamInput,
): CreateExamInput {
  return {
    subjectId: validateId(input.subjectId, "subjectId"),
    ownerTeacherId: validateId(input.ownerTeacherId, "ownerTeacherId"),
    ...validateMetadata(input),
  };
}

export function validateUpdateExamRevisionInput(
  input: UpdateExamRevisionInput,
): UpdateExamRevisionInput {
  if (Object.keys(input).length === 0)
    throw new ExamValidationError("At least one exam field must be updated");
  const result: {
    title?: string;
    instructionsHtml?: string;
    durationSeconds?: number;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
  } = {};
  if (input.title !== undefined) result.title = normalizeTitle(input.title);
  if (input.instructionsHtml !== undefined)
    result.instructionsHtml = normalizeInstructions(input.instructionsHtml);
  if (input.durationSeconds !== undefined)
    result.durationSeconds = normalizeDuration(input.durationSeconds);
  if (input.shuffleQuestions !== undefined)
    result.shuffleQuestions = validateBoolean(
      input.shuffleQuestions,
      "shuffleQuestions",
    );
  if (input.shuffleOptions !== undefined)
    result.shuffleOptions = validateBoolean(
      input.shuffleOptions,
      "shuffleOptions",
    );
  return result;
}

export function validateAddExamQuestionInput(
  input: AddExamQuestionInput,
): AddExamQuestionInput {
  const questionRevisionId = validateId(
    input.questionRevisionId,
    "questionRevisionId",
  );
  const points = normalizePoints(input.points);
  if (
    input.position !== undefined &&
    (!Number.isSafeInteger(input.position) || input.position < 1)
  )
    throw new ExamValidationError(
      "Question position must be a positive integer",
      "INVALID_POSITION",
    );
  return {
    questionRevisionId,
    points,
    ...(input.position === undefined ? {} : { position: input.position }),
  };
}

export function validatePosition(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new ExamValidationError(
      `Question position must be between 1 and ${max}`,
      "INVALID_POSITION",
    );
  return value;
}

export function normalizePoints(value: string): string {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/u.test(value))
    throw new ExamValidationError(
      "Question points must be a positive decimal with at most two digits",
      "INVALID_POINTS",
    );
  const [whole = "", fraction = ""] = value.split(".");
  const wholeNumber = BigInt(whole);
  if (wholeNumber > 99_999_999n || (wholeNumber === 0n && fraction === "00"))
    throw new ExamValidationError(
      "Question points must be greater than zero and within the allowed range",
      "INVALID_POINTS",
    );
  const cents = `${wholeNumber}.${fraction.padEnd(2, "0")}`;
  if (cents === "0.00")
    throw new ExamValidationError(
      "Question points must be greater than zero",
      "INVALID_POINTS",
    );
  return cents;
}

export function normalizePointsForStorage(value: string): string {
  return normalizePoints(value);
}

function validateMetadata(input: ExamDraftMetadata): ExamDraftMetadata {
  return {
    title: normalizeTitle(input.title),
    instructionsHtml: normalizeInstructions(input.instructionsHtml),
    durationSeconds: normalizeDuration(input.durationSeconds),
    shuffleQuestions: validateBoolean(
      input.shuffleQuestions,
      "shuffleQuestions",
    ),
    shuffleOptions: validateBoolean(input.shuffleOptions, "shuffleOptions"),
  };
}

function normalizeTitle(value: string): string {
  if (typeof value !== "string")
    throw new ExamValidationError("Exam title is invalid", "INVALID_TITLE");
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 250)
    throw new ExamValidationError(
      "Exam title must contain between 1 and 250 characters",
      "INVALID_TITLE",
    );
  return normalized;
}

function normalizeInstructions(value: string): string {
  if (typeof value !== "string")
    throw new ExamValidationError(
      "Exam instructions are invalid",
      "INVALID_INSTRUCTIONS",
    );
  const normalized = value.trim();
  if (normalized.length > 200_000)
    throw new ExamValidationError(
      "Exam instructions are too long",
      "INVALID_INSTRUCTIONS",
    );
  return normalized;
}

function normalizeDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400)
    throw new ExamValidationError(
      "Exam duration must be between 1 and 86400 seconds",
      "INVALID_DURATION",
    );
  return value;
}

function validateBoolean(value: boolean, field: string): boolean {
  if (typeof value !== "boolean")
    throw new ExamValidationError(
      `${field} must be boolean`,
      "INVALID_BOOLEAN",
    );
  return value;
}

function validateId(value: Id, field: string): Id {
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new ExamValidationError(`${field} is invalid`, "INVALID_ID");
  return value;
}
