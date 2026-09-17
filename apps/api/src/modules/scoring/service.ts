import type {
  ExamScore,
  ScoringAnswer,
  ScoringQuestionSnapshot,
} from "./domain";
import { ScoringValidationError, scoreExam } from "./domain";

export interface ExactMatchScoreInput {
  readonly questions: readonly ScoringQuestionSnapshot[];
  readonly answers: readonly ScoringAnswer[];
}

/** Application boundary for final scoring; it has no HTTP or persistence dependency. */
export interface ExactMatchScoringService {
  score(input: ExactMatchScoreInput): ExamScore;
}

export class DefaultExactMatchScoringService
  implements ExactMatchScoringService
{
  score(input: ExactMatchScoreInput): ExamScore {
    assertUniqueQuestions(input.questions);
    return scoreExam(input.questions, input.answers);
  }
}

/** Stable short name for callers that do not need to distinguish policies. */
export class ScoringService extends DefaultExactMatchScoringService {}

function assertUniqueQuestions(
  questions: readonly ScoringQuestionSnapshot[],
): void {
  const ids = questions.map((question) => question.questionId);
  if (new Set(ids).size !== ids.length) {
    throw new ScoringValidationError(
      "A question may occur only once in a scoring input",
    );
  }
}
