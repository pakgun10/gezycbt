export type ParticipantRole = "PARTICIPANT";

export interface ParticipantUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: ParticipantRole;
  readonly forcePasswordChange?: boolean;
}

export interface LoginResponse {
  readonly user: ParticipantUser;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export type ScheduleMode = "MAIN" | "PRACTICE";
export type ScheduleStatus = "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";

export interface ParticipantSchedule {
  readonly id: string;
  readonly title: string;
  readonly subjectName?: string;
  readonly mode: ScheduleMode;
  readonly status: ScheduleStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly mainAccessCodeRequired?: boolean;
  readonly mainAccessCodeHint?: string | null;
  readonly attemptsUsed?: number;
  readonly activeSessionId?: string | null;
  readonly resultSessionId?: string | null;
  readonly resultReleased?: boolean;
  readonly attemptResetAvailable?: boolean;
}

export interface PracticeIdentityField {
  readonly key: string;
  readonly label: string;
  readonly type: "TEXT";
  readonly required: boolean;
  readonly maxLength?: number;
  readonly allowedValues?: readonly string[];
}

export interface PracticeResolveResponse {
  readonly data: {
    readonly scheduleId: string;
    readonly title: string;
    readonly identityFields: readonly PracticeIdentityField[] | null;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly durationSeconds: number;
  };
}

export interface ParticipantQuestionOption {
  readonly id: string;
  readonly position: number;
  readonly contentHtml: string;
}

export interface ParticipantStatement {
  readonly id: string;
  readonly position: number;
  readonly statementHtml: string;
}

export interface ParticipantQuestionMedia {
  readonly usage: string;
  readonly url: string;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}

export type ParticipantQuestionType =
  | "SINGLE_CHOICE"
  | "MULTIPLE_RESPONSE"
  | "TRUE_FALSE";

export interface ParticipantQuestion {
  readonly questionId: string;
  readonly questionRevisionId: string;
  readonly type: ParticipantQuestionType;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly options: readonly ParticipantQuestionOption[];
  readonly statements: readonly ParticipantStatement[];
  readonly media: readonly ParticipantQuestionMedia[];
}

export interface RuntimeQuestionManifest {
  readonly sessionQuestionId: string;
  readonly questionId: string;
  readonly questionRevisionId: string;
  readonly displayPosition: number;
  readonly points: string;
  readonly optionOrder: readonly string[];
  readonly statementOrder: readonly string[];
  readonly question: ParticipantQuestion;
}

export interface RuntimeSession {
  readonly id: string;
  readonly scheduleId: string;
  readonly examRevisionId: string;
  readonly participantId: string | null;
  readonly attemptNo: number;
  readonly status: "ACTIVE" | "SUBMITTED" | "EXPIRED" | "ENDED" | "SCORED";
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly lastSeenAt: string;
  readonly submittedAt: string | null;
  readonly expiredAt: string | null;
  readonly endedAt: string | null;
  readonly scoredAt: string | null;
  readonly finalizationReason: string | null;
  readonly finalizedByUserId: string | null;
  readonly participantNameSnapshot: string;
  readonly classSnapshot: string | null;
  readonly institutionSnapshot: string | null;
  readonly identityExtra: Readonly<Record<string, string>>;
  readonly startIdempotencyKey: string;
  readonly practice: boolean;
  readonly version: number;
  readonly updatedAt?: string;
}

export type AnswerResponse =
  | { readonly selectedOptionId: string | null }
  | { readonly selectedOptionIds: readonly string[] }
  | {
      readonly statements: readonly {
        readonly statementId: string;
        readonly value: boolean;
      }[];
    };

export interface RuntimeAnswer {
  readonly sessionId: string;
  readonly sessionQuestionId: string;
  readonly response: AnswerResponse;
  readonly version: number;
  readonly answeredAt: string;
}

export interface ParticipantSessionView {
  readonly session: RuntimeSession;
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly answers: readonly RuntimeAnswer[];
  readonly serverNow: string;
}

export interface SessionStartResponse {
  readonly data: {
    readonly session: RuntimeSession;
    readonly manifest: readonly RuntimeQuestionManifest[];
    readonly serverNow: string;
    readonly replayed: boolean;
  };
}

export interface AnswerItem {
  readonly sessionQuestionId: string;
  readonly baseVersion: number;
  readonly response: AnswerResponse;
  readonly clientMutationId: string;
}

export interface AnswerSaveResponse {
  readonly data: {
    readonly sessionId: string;
    readonly outcomes: readonly {
      readonly sessionQuestionId: string;
      readonly clientMutationId: string;
      readonly status: "SAVED" | "UNCHANGED" | "CONFLICT";
      readonly version: number;
      readonly response?: AnswerResponse;
    }[];
    readonly serverNow: string;
    readonly deadlineAt: string;
  };
}

export interface FinalAnswer {
  readonly sessionQuestionId: string;
  readonly baseVersion: number;
  readonly response: AnswerResponse;
}

export interface SubmitResponse {
  readonly data: {
    readonly session: RuntimeSession;
    readonly result: {
      readonly sessionId: string;
      readonly scheduleId: string;
      readonly participantId: string | null;
      readonly correctCount: number;
      readonly incorrectCount: number;
      readonly unansweredCount: number;
      readonly earnedScore: string;
      readonly maxScore: string;
      readonly percentage: string;
      readonly scoredAt: string;
      readonly releasedAt: string | null;
    };
    readonly serverNow: string;
    readonly replayed: boolean;
  };
}

export interface ParticipantResultResponse {
  readonly data: {
    readonly result: SubmitResponse["data"]["result"];
    readonly canRetry: boolean;
    readonly canRetryReason:
      | "SCHEDULE_CLOSED"
      | "ATTEMPT_LIMIT_REACHED"
      | "TOKEN_INVALID_OR_EXPIRED"
      | null;
  };
}
