import type { CursorPage } from "./http";
import type { Id, UtcTimestamp } from "./primitives";

/** The only question types supported by the first CBT release. */
export const QUESTION_TYPE_VALUES = [
  "SINGLE_CHOICE",
  "MULTIPLE_RESPONSE",
  "TRUE_FALSE",
] as const;
export type QuestionTypeContract = (typeof QUESTION_TYPE_VALUES)[number];

export const QUESTION_BANK_STATUS_VALUES = ["ACTIVE", "ARCHIVED"] as const;
export type QuestionBankStatusContract =
  (typeof QUESTION_BANK_STATUS_VALUES)[number];

export const QUESTION_STATUS_VALUES = ["ACTIVE", "ARCHIVED"] as const;
export type QuestionStatusContract = (typeof QUESTION_STATUS_VALUES)[number];

export const QUESTION_REVISION_STATUS_VALUES = ["DRAFT", "PUBLISHED"] as const;
export type QuestionRevisionStatusContract =
  (typeof QUESTION_REVISION_STATUS_VALUES)[number];

export const MEDIA_USAGE_VALUES = [
  "STIMULUS",
  "PROMPT",
  "EXPLANATION",
  "OPTION",
  "STATEMENT",
] as const;
export type MediaUsageContract = (typeof MEDIA_USAGE_VALUES)[number];

export interface QuestionBankResource {
  readonly id: Id;
  readonly subjectId: Id;
  readonly ownerTeacherId: Id;
  readonly name: string;
  readonly status: QuestionBankStatusContract;
}

export interface QuestionOptionResource {
  readonly id: Id;
  readonly position: number;
  readonly contentHtml: string;
  readonly isCorrect: boolean;
}

export interface TrueFalseStatementResource {
  readonly id: Id;
  readonly position: number;
  readonly statementHtml: string;
  readonly correctValue: boolean;
}

/** Teacher/editor media fields. Storage key and content hash stay private. */
export interface QuestionMediaResource {
  readonly mediaAssetId: Id;
  readonly usage: MediaUsageContract;
  readonly url: string;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}

export interface QuestionRevisionSummaryResource {
  readonly id: Id;
  readonly questionId: Id;
  readonly questionBank: QuestionBankResource;
  readonly questionStatus: QuestionStatusContract;
  readonly revisionNo: number;
  readonly type: QuestionTypeContract;
  readonly status: QuestionRevisionStatusContract;
  readonly publishedAt: UtcTimestamp | null;
  readonly updatedAt: UtcTimestamp;
}

export interface QuestionRevisionResource
  extends QuestionRevisionSummaryResource {
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly contentHash: string;
  readonly options: readonly QuestionOptionResource[];
  readonly statements: readonly TrueFalseStatementResource[];
  readonly media: readonly QuestionMediaResource[];
  readonly createdAt: UtcTimestamp;
}

export interface QuestionReadinessIssueResource {
  readonly severity: "ERROR" | "WARNING";
  readonly code: string;
  readonly entityId: Id;
  readonly fieldPath: string;
  readonly message: string;
  readonly remediationHint?: string;
}

export interface QuestionReadinessReportResource {
  readonly revisionId: Id;
  readonly isReady: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issues: readonly QuestionReadinessIssueResource[];
}

export interface MediaAssetResource {
  readonly id: Id;
  readonly originalName: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly status: "READY" | "DELETED";
}

export interface ParticipantQuestionOptionResource {
  readonly id: Id;
  readonly position: number;
  readonly contentHtml: string;
}

export interface ParticipantTrueFalseStatementResource {
  readonly id: Id;
  readonly position: number;
  readonly statementHtml: string;
}

/** Participant-safe contract. It intentionally has no answer key or explanation. */
export interface ParticipantQuestionResource {
  readonly questionId: Id;
  readonly questionRevisionId: Id;
  readonly type: QuestionTypeContract;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly options: readonly ParticipantQuestionOptionResource[];
  readonly statements: readonly ParticipantTrueFalseStatementResource[];
  readonly media: readonly Pick<
    QuestionMediaResource,
    "usage" | "url" | "altText" | "isDecorative"
  >[];
}

export type QuestionBankPage = CursorPage<QuestionBankResource>;
export type QuestionRevisionPage = CursorPage<QuestionRevisionSummaryResource>;

export interface ListQuestionBanksQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly subjectId?: Id;
  readonly status?: QuestionBankStatusContract;
  readonly q?: string;
}

export interface ListQuestionsQuery extends ListQuestionBanksQuery {
  readonly questionBankId?: Id;
  readonly type?: QuestionTypeContract;
  readonly revisionStatus?: QuestionRevisionStatusContract;
}

export interface CreateQuestionBankRequest {
  readonly subjectId: Id;
  readonly name: string;
}

export interface UpdateQuestionBankRequest {
  readonly name?: string;
  readonly status?: QuestionBankStatusContract;
  readonly expectedUpdatedAt: UtcTimestamp;
}

export interface QuestionOptionInput {
  readonly id?: Id;
  readonly position: number;
  readonly contentHtml: string;
  readonly isCorrect: boolean;
}

export interface TrueFalseStatementInput {
  readonly id?: Id;
  readonly position: number;
  readonly statementHtml: string;
  readonly correctValue: boolean;
}

export interface QuestionContentRequest {
  readonly type: QuestionTypeContract;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly options: readonly QuestionOptionInput[];
  readonly statements: readonly TrueFalseStatementInput[];
}

/** HTTP body for POST /teacher/question-banks/:id/questions; ID is in the path. */
export type CreateQuestionDraftRequest = QuestionContentRequest;

export interface UpdateQuestionRevisionRequest extends QuestionContentRequest {
  readonly expectedUpdatedAt: UtcTimestamp;
}

export interface PublishQuestionRevisionRequest {
  readonly expectedUpdatedAt: UtcTimestamp;
}

export interface AttachQuestionMediaRequest {
  readonly mediaAssetId: Id;
  readonly usage: MediaUsageContract;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}
