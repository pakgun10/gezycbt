import type { Id, UtcTimestamp } from "@gezycbt/contracts";

export const QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "MULTIPLE_RESPONSE",
  "TRUE_FALSE",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export type QuestionBankStatus = "ACTIVE" | "ARCHIVED";
export type QuestionStatus = "ACTIVE" | "ARCHIVED";
export type QuestionRevisionStatus = "DRAFT" | "PUBLISHED";

export interface QuestionBankSummary {
  readonly id: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly name: string;
  readonly status: QuestionBankStatus;
}

export interface QuestionOptionDraft {
  readonly id?: Id;
  readonly position: number;
  readonly contentHtml: string;
  readonly isCorrect: boolean;
}

export interface TrueFalseStatementDraft {
  readonly id?: Id;
  readonly position: number;
  readonly statementHtml: string;
  readonly correctValue: boolean;
}

export interface QuestionDraftContent {
  readonly type: QuestionType;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly options: readonly QuestionOptionDraft[];
  readonly statements: readonly TrueFalseStatementDraft[];
}

export interface QuestionDraft extends QuestionDraftContent {
  readonly id: Id;
  readonly questionId: Id;
  readonly questionBank: QuestionBankSummary;
  readonly questionStatus: QuestionStatus;
  readonly revisionNo: number;
  readonly status: QuestionRevisionStatus;
  readonly contentHash: Uint8Array;
  readonly publishedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CreateQuestionDraftInput extends QuestionDraftContent {
  readonly questionBankId: Id;
}

export interface UpdateQuestionDraftInput extends QuestionDraftContent {}

export class QuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionValidationError";
  }
}

export class QuestionNotFoundError extends Error {
  constructor() {
    super("Question draft was not found");
    this.name = "QuestionNotFoundError";
  }
}

export class QuestionImmutableError extends Error {
  constructor() {
    super("Published question revisions are immutable");
    this.name = "QuestionImmutableError";
  }
}

export class QuestionVersionConflictError extends Error {
  constructor() {
    super("Question draft was changed by another request");
    this.name = "QuestionVersionConflictError";
  }
}

export class QuestionForeignReferenceError extends Error {
  constructor() {
    super("Question child reference does not belong to this revision");
    this.name = "QuestionForeignReferenceError";
  }
}

export function validateQuestionType(
  value: string,
): asserts value is QuestionType {
  if (!QUESTION_TYPES.includes(value as QuestionType)) {
    throw new QuestionValidationError("Question type is invalid");
  }
}

export function validateQuestionContent(
  input: QuestionDraftContent,
): QuestionDraftContent {
  validateQuestionType(input.type);
  const stimulusHtml = validateHtml(
    input.stimulusHtml,
    "stimulusHtml",
    100_000,
  );
  const promptHtml =
    input.promptHtml === null
      ? null
      : validateHtml(input.promptHtml, "promptHtml", 100_000);
  const explanationHtml =
    input.explanationHtml === null
      ? null
      : validateHtml(input.explanationHtml, "explanationHtml", 100_000);
  if (!Array.isArray(input.options) || !Array.isArray(input.statements)) {
    throw new QuestionValidationError("Question children must be arrays");
  }
  if (input.options.length > 10) {
    throw new QuestionValidationError("A question can have at most 10 options");
  }
  if (input.statements.length > 3) {
    throw new QuestionValidationError(
      "A TRUE_FALSE question can have at most 3 statements",
    );
  }
  const options = input.options.map(validateOption);
  const statements = input.statements.map(validateStatement);
  if (input.type === "TRUE_FALSE" && options.length > 0) {
    throw new QuestionValidationError(
      "TRUE_FALSE questions cannot contain choice options",
    );
  }
  if (input.type !== "TRUE_FALSE" && statements.length > 0) {
    throw new QuestionValidationError(
      "Choice questions cannot contain true/false statements",
    );
  }
  if (input.type === "TRUE_FALSE" && promptHtml !== null) {
    throw new QuestionValidationError(
      "TRUE_FALSE questions cannot contain a prompt",
    );
  }
  validateUniqueChildIds(options.map((option) => option.id));
  validateUniqueChildIds(statements.map((statement) => statement.id));
  validateUniquePositions(
    options.map((option) => option.position),
    "option",
  );
  validateUniquePositions(
    statements.map((statement) => statement.position),
    "statement",
  );
  return {
    type: input.type,
    stimulusHtml,
    promptHtml,
    explanationHtml,
    options,
    statements,
  };
}

function validateOption(input: QuestionOptionDraft): QuestionOptionDraft {
  if (
    !Number.isInteger(input.position) ||
    input.position < 1 ||
    input.position > 10
  ) {
    throw new QuestionValidationError(
      "Option position must be between 1 and 10",
    );
  }
  if (typeof input.contentHtml !== "string") {
    throw new QuestionValidationError("Option content is invalid");
  }
  if (typeof input.isCorrect !== "boolean") {
    throw new QuestionValidationError("Option answer key is invalid");
  }
  return {
    ...(input.id === undefined ? {} : { id: validateId(input.id) }),
    position: input.position,
    contentHtml: validateHtml(input.contentHtml, "option.contentHtml", 20_000),
    isCorrect: input.isCorrect,
  };
}

function validateStatement(
  input: TrueFalseStatementDraft,
): TrueFalseStatementDraft {
  if (
    !Number.isInteger(input.position) ||
    input.position < 1 ||
    input.position > 3
  ) {
    throw new QuestionValidationError(
      "True/false statement position must be between 1 and 3",
    );
  }
  if (typeof input.statementHtml !== "string") {
    throw new QuestionValidationError("Statement content is invalid");
  }
  if (typeof input.correctValue !== "boolean") {
    throw new QuestionValidationError("Statement answer key is invalid");
  }
  return {
    ...(input.id === undefined ? {} : { id: validateId(input.id) }),
    position: input.position,
    statementHtml: validateHtml(
      input.statementHtml,
      "statement.statementHtml",
      20_000,
    ),
    correctValue: input.correctValue,
  };
}

function validateHtml(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new QuestionValidationError(`${field} is invalid`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new QuestionValidationError(`${field} is too long`);
  }
  return normalized;
}

function validateUniqueChildIds(ids: readonly (Id | undefined)[]): void {
  const present = ids.filter((id): id is Id => id !== undefined);
  if (new Set(present).size !== present.length) {
    throw new QuestionValidationError("Question child IDs must be unique");
  }
}

function validateUniquePositions(
  positions: readonly number[],
  kind: "option" | "statement",
): void {
  if (new Set(positions).size !== positions.length) {
    throw new QuestionValidationError(`${kind} positions must be unique`);
  }
}

function validateId(value: Id): Id {
  if (!/^\d+$/u.test(value))
    throw new QuestionValidationError("Question child ID is invalid");
  return value;
}
