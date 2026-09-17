import type { Id } from "@gezycbt/contracts";
import type { MediaUsage } from "../media/relation-domain";
import type { QuestionDraft } from "./domain";

export interface ParticipantQuestionOption {
  readonly id: Id;
  readonly position: number;
  readonly contentHtml: string;
}

export interface ParticipantTrueFalseStatement {
  readonly id: Id;
  readonly position: number;
  readonly statementHtml: string;
}

/** Safe media fields; storage keys, hashes, and original filenames stay server-side. */
export interface ParticipantQuestionMedia {
  readonly usage: MediaUsage;
  readonly url: string;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}

/** Participant contract intentionally has no answer key or authoring metadata. */
export interface ParticipantQuestion {
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly type: QuestionDraft["type"];
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly options: readonly ParticipantQuestionOption[];
  readonly statements: readonly ParticipantTrueFalseStatement[];
  readonly media: readonly ParticipantQuestionMedia[];
}

export class ParticipantPresentationError extends Error {
  constructor(
    readonly code:
      | "UNPUBLISHED_QUESTION"
      | "INVALID_CHILD_ID"
      | "INVALID_SHAPE",
    message: string,
  ) {
    super(message);
    this.name = "ParticipantPresentationError";
  }
}

export function presentParticipantQuestion(
  source: QuestionDraft,
  media: readonly ParticipantQuestionMedia[] = [],
): ParticipantQuestion {
  if (source.status !== "PUBLISHED")
    throw new ParticipantPresentationError(
      "UNPUBLISHED_QUESTION",
      "Only a published question can be presented to a participant",
    );
  if (source.type === "TRUE_FALSE") {
    if (
      source.options.length !== 0 ||
      source.statements.length !== 3 ||
      source.promptHtml !== null
    )
      throw new ParticipantPresentationError(
        "INVALID_SHAPE",
        "TRUE_FALSE participant question shape is invalid",
      );
  } else if (
    source.options.length < 2 ||
    source.options.length > 10 ||
    source.statements.length !== 0 ||
    source.promptHtml === null
  ) {
    throw new ParticipantPresentationError(
      "INVALID_SHAPE",
      "Choice participant question shape is invalid",
    );
  }
  return {
    questionId: source.questionId,
    questionRevisionId: source.id,
    type: source.type,
    stimulusHtml: source.stimulusHtml,
    promptHtml: source.promptHtml,
    options: source.options.map((option) => ({
      id: requiredChildId(option.id),
      position: option.position,
      contentHtml: option.contentHtml,
    })),
    statements: source.statements.map((statement) => ({
      id: requiredChildId(statement.id),
      position: statement.position,
      statementHtml: statement.statementHtml,
    })),
    media: media.map((item) => ({
      usage: item.usage,
      url: item.url,
      altText: item.altText,
      isDecorative: item.isDecorative,
    })),
  };
}

function requiredChildId(id: Id | undefined): Id {
  if (!id)
    throw new ParticipantPresentationError(
      "INVALID_CHILD_ID",
      "Published question child is missing an ID",
    );
  return id;
}
