import type { Id } from "@gezycbt/contracts";

export type DecimalScore = string;
export type QuestionOutcome = "CORRECT" | "INCORRECT" | "UNANSWERED";
export type ScoreReason = "EXACT_MATCH" | "MISMATCH" | "EMPTY";
export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "TRUE_FALSE";

export interface ScoringOptionSnapshot {
  readonly id: Id;
  readonly isCorrect: boolean;
}

export interface ScoringStatementSnapshot {
  readonly id: Id;
  readonly correctValue: boolean;
}

/** Immutable published question snapshot used during finalization. */
export interface ScoringQuestionSnapshot {
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly type: QuestionType;
  readonly points: DecimalScore;
  readonly options: readonly ScoringOptionSnapshot[];
  readonly statements: readonly ScoringStatementSnapshot[];
}

export type ScoringQuestion = ScoringQuestionSnapshot;

export type ScoringResponse =
  | { readonly selectedOptionId: Id | null }
  | { readonly selectedOptionIds: readonly Id[] }
  | {
      readonly statements: readonly {
        readonly statementId: Id;
        readonly value: boolean;
      }[];
    };

export interface ScoringAnswer {
  readonly questionId: Id;
  readonly response: ScoringResponse;
}

export interface QuestionScore {
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly outcome: QuestionOutcome;
  readonly reason: ScoreReason;
  readonly awardedPoints: DecimalScore;
  readonly maxPoints: DecimalScore;
}

export interface ExamScore {
  readonly questionScores: readonly QuestionScore[];
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly unansweredCount: number;
  readonly earnedScore: DecimalScore;
  readonly maxScore: DecimalScore;
  readonly percentage: DecimalScore;
}

export class ScoringValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_SCORING_INPUT") {
    super(message);
    this.name = "ScoringValidationError";
    this.code = code;
  }
}

export function scoreQuestion(
  question: ScoringQuestionSnapshot,
  response: ScoringResponse | null | undefined,
): QuestionScore {
  validateQuestion(question);
  const maxPoints = normalizeDecimal(question.points);
  if (response === null || response === undefined) {
    return result(question, "UNANSWERED", "EMPTY", "0.00", maxPoints);
  }

  if (question.type === "SINGLE_CHOICE") {
    if (!("selectedOptionId" in response))
      throw invalid(
        "Answer type does not match question",
        "ANSWER_TYPE_MISMATCH",
      );
    const selected = response.selectedOptionId;
    if (selected === null)
      return result(question, "UNANSWERED", "EMPTY", "0.00", maxPoints);
    assertKnownOption(selected, question.options);
    const key = question.options.find((option) => option.isCorrect);
    const exact = selected === key?.id;
    return result(
      question,
      exact ? "CORRECT" : "INCORRECT",
      exact ? "EXACT_MATCH" : "MISMATCH",
      exact ? maxPoints : "0.00",
      maxPoints,
    );
  }

  if (question.type === "MULTIPLE_RESPONSE") {
    if (!("selectedOptionIds" in response))
      throw invalid(
        "Answer type does not match question",
        "ANSWER_TYPE_MISMATCH",
      );
    const selected = response.selectedOptionIds;
    if (!Array.isArray(selected))
      throw invalid(
        "Multiple response answer is not an array",
        "INVALID_RESPONSE",
      );
    assertUnique(selected, "DUPLICATE_OPTION");
    if (selected.length === 0)
      return result(question, "UNANSWERED", "EMPTY", "0.00", maxPoints);
    for (const optionId of selected)
      assertKnownOption(optionId, question.options);
    const key = new Set(
      question.options
        .filter((option) => option.isCorrect)
        .map((option) => option.id),
    );
    const exact =
      selected.length === key.size && selected.every((id) => key.has(id));
    return result(
      question,
      exact ? "CORRECT" : "INCORRECT",
      exact ? "EXACT_MATCH" : "MISMATCH",
      exact ? maxPoints : "0.00",
      maxPoints,
    );
  }

  if (!("statements" in response))
    throw invalid(
      "Answer type does not match question",
      "ANSWER_TYPE_MISMATCH",
    );
  const values = response.statements;
  if (!Array.isArray(values))
    throw invalid("TRUE_FALSE answer is not an array", "INVALID_RESPONSE");
  assertUnique(
    values.map((statement) => statement.statementId),
    "DUPLICATE_STATEMENT",
  );
  if (values.length === 0)
    return result(question, "UNANSWERED", "EMPTY", "0.00", maxPoints);
  for (const statement of values)
    assertKnownStatement(statement.statementId, question.statements);
  if (values.some((statement) => typeof statement.value !== "boolean"))
    throw invalid(
      "TRUE_FALSE answer contains an invalid value",
      "INVALID_RESPONSE",
    );
  if (values.length !== question.statements.length)
    return result(question, "UNANSWERED", "EMPTY", "0.00", maxPoints);
  const answerById = new Map(
    values.map((statement) => [statement.statementId, statement.value]),
  );
  const exact = question.statements.every(
    (statement) => answerById.get(statement.id) === statement.correctValue,
  );
  return result(
    question,
    exact ? "CORRECT" : "INCORRECT",
    exact ? "EXACT_MATCH" : "MISMATCH",
    exact ? maxPoints : "0.00",
    maxPoints,
  );
}

export function scoreExam(
  questions: readonly ScoringQuestionSnapshot[],
  answers: readonly ScoringAnswer[],
): ExamScore {
  const answerByQuestion = new Map<Id, ScoringAnswer>();
  for (const answer of answers) {
    if (answerByQuestion.has(answer.questionId))
      throw invalid("Duplicate answer for question", "DUPLICATE_ANSWER");
    answerByQuestion.set(answer.questionId, answer);
  }
  const knownQuestionIds = new Set(
    questions.map((question) => question.questionId),
  );
  for (const answer of answers) {
    if (!knownQuestionIds.has(answer.questionId))
      throw invalid(
        "Answer references an unknown question",
        "FOREIGN_QUESTION",
      );
  }
  const questionIds = new Set<Id>();
  for (const question of questions) {
    if (questionIds.has(question.questionId))
      throw invalid(
        "A question may occur only once in a scoring input",
        "DUPLICATE_QUESTION",
      );
    questionIds.add(question.questionId);
  }
  const questionScores = questions.map((question) =>
    scoreQuestion(
      question,
      answerByQuestion.get(question.questionId)?.response,
    ),
  );
  const earnedScore = addDecimals(
    questionScores.map((score) => score.awardedPoints),
  );
  const maxScore = addDecimals(questionScores.map((score) => score.maxPoints));
  return {
    questionScores,
    correctCount: questionScores.filter((score) => score.outcome === "CORRECT")
      .length,
    incorrectCount: questionScores.filter(
      (score) => score.outcome === "INCORRECT",
    ).length,
    unansweredCount: questionScores.filter(
      (score) => score.outcome === "UNANSWERED",
    ).length,
    earnedScore,
    maxScore,
    percentage: percentage(earnedScore, maxScore),
  };
}

function validateQuestion(question: ScoringQuestionSnapshot): void {
  assertId(question.questionId, "Question ID");
  assertId(question.questionRevisionId, "Question revision ID");
  if (question.status !== "PUBLISHED")
    throw invalid(
      "Question revision is not published",
      "QUESTION_NOT_PUBLISHED",
    );
  if (normalizeDecimal(question.points) === "0.00")
    throw invalid("Question points must be positive", "INVALID_POINTS");
  if (question.type === "TRUE_FALSE") {
    if (question.options.length !== 0 || question.statements.length !== 3)
      throw invalid(
        "TRUE_FALSE snapshot is invalid",
        "INVALID_QUESTION_SNAPSHOT",
      );
    assertUnique(
      question.statements.map((statement) => statement.id),
      "DUPLICATE_STATEMENT",
    );
    if (
      question.statements.some(
        (statement) => typeof statement.correctValue !== "boolean",
      )
    )
      throw invalid(
        "TRUE_FALSE key contains an invalid value",
        "INVALID_ANSWER_KEY",
      );
    return;
  }
  if (
    question.options.length < 2 ||
    question.options.length > 10 ||
    question.statements.length !== 0
  )
    throw invalid("Choice snapshot is invalid", "INVALID_QUESTION_SNAPSHOT");
  assertUnique(
    question.options.map((option) => option.id),
    "DUPLICATE_OPTION",
  );
  const keyCount = question.options.filter((option) => option.isCorrect).length;
  if (question.type === "SINGLE_CHOICE" && keyCount !== 1)
    throw invalid("Single choice must have one key", "INVALID_ANSWER_KEY");
  if (question.type === "MULTIPLE_RESPONSE" && keyCount < 1)
    throw invalid("Multiple response must have a key", "INVALID_ANSWER_KEY");
}

function result(
  question: ScoringQuestionSnapshot,
  outcome: QuestionOutcome,
  reason: ScoreReason,
  awardedPoints: DecimalScore,
  maxPoints: DecimalScore,
): QuestionScore {
  return {
    questionId: question.questionId,
    questionRevisionId: question.questionRevisionId,
    outcome,
    reason,
    awardedPoints,
    maxPoints,
  };
}

function assertKnownOption(
  id: Id,
  options: readonly ScoringOptionSnapshot[],
): void {
  if (!options.some((option) => option.id === id))
    throw invalid("Answer references an unknown option", "FOREIGN_OPTION");
}

function assertKnownStatement(
  id: Id,
  statements: readonly ScoringStatementSnapshot[],
): void {
  if (!statements.some((statement) => statement.id === id))
    throw invalid(
      "Answer references an unknown statement",
      "FOREIGN_STATEMENT",
    );
}

function assertUnique(ids: readonly Id[], code: string): void {
  if (ids.some((id) => typeof id !== "string" || id.length === 0))
    throw invalid("Question/answer contains an invalid ID", "INVALID_ID");
  if (new Set(ids).size !== ids.length)
    throw invalid("Question/answer contains a duplicate ID", code);
}

function assertId(value: Id, label: string): void {
  if (typeof value !== "string" || value.length === 0)
    throw invalid(`${label} is invalid`, "INVALID_ID");
}

function invalid(message: string, code: string): ScoringValidationError {
  return new ScoringValidationError(message, code);
}

function normalizeDecimal(value: string): DecimalScore {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/u.test(value))
    throw invalid(
      "Score must be a positive decimal with at most two digits",
      "INVALID_POINTS",
    );
  const [whole = "", fraction = ""] = value.split(".");
  const wholeNumber = BigInt(whole);
  if (wholeNumber > 99_999_999n)
    throw invalid("Score is outside the allowed range", "INVALID_POINTS");
  return `${wholeNumber}.${fraction.padEnd(2, "0")}`;
}

function addDecimals(values: readonly DecimalScore[]): DecimalScore {
  const cents = values.reduce(
    (total, value) => total + BigInt(normalizeDecimal(value).replace(".", "")),
    0n,
  );
  return formatCents(cents);
}

function percentage(earned: DecimalScore, max: DecimalScore): DecimalScore {
  const earnedCents = BigInt(earned.replace(".", ""));
  const maxCents = BigInt(max.replace(".", ""));
  if (maxCents === 0n) return "0.00";
  const scaled = earnedCents * 10_000n;
  const rounded =
    scaled / maxCents + ((scaled % maxCents) * 2n >= maxCents ? 1n : 0n);
  const bounded = rounded > 10_000n ? 10_000n : rounded;
  return `${bounded / 100n}.${(bounded % 100n).toString().padStart(2, "0")}`;
}

function formatCents(cents: bigint): DecimalScore {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
