export type StaffRole = "ADMIN" | "TEACHER";
export type UserRole = "ADMIN" | "TEACHER" | "PARTICIPANT";

export interface StaffUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly status: "ACTIVE" | "DISABLED";
  readonly forcePasswordChange: boolean;
  readonly lastLoginAt?: string | null;
  readonly updatedAt?: string;
}

export interface StaffLoginResponse {
  readonly user: StaffUser;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface AcademicYear {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

export interface ClassRecord {
  readonly id: string;
  readonly academicYearId: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly updatedAt: string;
}

export interface ParticipantOption {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface Subject {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly updatedAt: string;
}

export interface TeacherScope {
  readonly teacherId: string;
  readonly subjectIds: readonly string[];
  readonly classIds: readonly string[];
}

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_RESPONSE" | "TRUE_FALSE";

export interface QuestionSummary {
  readonly id: string;
  readonly questionId: string;
  readonly bankId: string;
  readonly bankName: string;
  readonly subjectId: string;
  readonly type: QuestionType;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly label: string;
  readonly updatedAt: string;
}

export interface QuestionBankSummary {
  readonly id: string;
  readonly subjectId: string;
  readonly ownerTeacherId: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly updatedAt: string;
}

export interface QuestionDraft {
  readonly id: string;
  readonly questionId: string;
  readonly questionBank: {
    readonly id: string;
    readonly name: string;
    readonly subjectId: string;
  };
  readonly revisionNo: number;
  readonly type: QuestionType;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly options: readonly {
    readonly position: number;
    readonly contentHtml: string;
    readonly isCorrect: boolean;
  }[];
  readonly statements: readonly {
    readonly position: number;
    readonly statementHtml: string;
    readonly correctValue: boolean;
  }[];
  readonly updatedAt: string;
}

export interface ExamSummary {
  readonly id: string;
  readonly revisionId: string;
  readonly title: string;
  readonly subjectId: string;
  readonly ownerTeacherId: string;
  readonly status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  readonly questionCount: number;
  readonly updatedAt: string;
}

export interface ExamRevision {
  readonly id: string;
  readonly examId: string;
  readonly title: string;
  readonly instructionsHtml: string;
  readonly durationSeconds: number;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly updatedAt: string;
  readonly questions: readonly {
    readonly questionRevisionId: string;
    readonly position: number;
    readonly points: string;
    readonly label?: string;
  }[];
}

export interface ScheduleSummary {
  readonly id: string;
  readonly title: string;
  readonly mode: "MAIN" | "PRACTICE";
  readonly status: "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly hasAccessCode: boolean;
  readonly accessHint: string | null;
  readonly updatedAt: string;
}

export interface ScheduleDetail {
  readonly id: string;
  readonly examRevisionId: string;
  readonly mode: "MAIN" | "PRACTICE";
  readonly status: "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly allowLateStart: boolean;
  readonly resultReleasePolicy: "MANUAL" | "IMMEDIATE_SCORE";
  readonly identityFields:
    | readonly {
        readonly key: string;
        readonly label: string;
        readonly type: "TEXT";
        readonly required: boolean;
      }[]
    | null;
  readonly targetClassIds: readonly string[];
  readonly targetParticipantIds: readonly string[];
  readonly updatedAt: string;
}

export interface MonitorCounts {
  readonly target: number;
  readonly notStarted: number;
  readonly active: number;
  readonly submitted: number;
  readonly expired: number;
}

export interface MonitorSession {
  readonly id: string;
  readonly scheduleId?: string;
  readonly participantName: string;
  readonly username?: string | null;
  readonly attemptNo: number;
  readonly status: "ACTIVE" | "SUBMITTED" | "EXPIRED" | "ENDED" | "SCORED";
  readonly answeredCount: number;
  readonly questionCount: number;
  readonly deadlineAt: string;
  readonly lastSeenAt: string;
  readonly version: number;
  readonly finalizationReason?: string | null;
}

export interface MonitorPage {
  readonly counts: MonitorCounts;
  readonly generatedAt: string;
  readonly serverNow: string;
  readonly sessions: CursorPage<MonitorSession>;
}

export interface ResultRow {
  readonly id: string;
  readonly sessionId: string;
  readonly participantName: string;
  readonly username?: string | null;
  readonly status: "SCORED" | "PENDING";
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly unansweredCount: number;
  readonly earnedScore: string;
  readonly maxScore: string;
  readonly percentage: string;
  readonly releasedAt: string | null;
}

export interface ExportJob {
  readonly id: string;
  readonly format: "CSV" | "JSON";
  readonly status: "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly rowCount?: number;
  readonly errorMessage?: string | null;
}

export interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly actorLabel: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly createdAt: string;
  readonly requestId: string;
}

export interface IntegrationClient {
  readonly id: string;
  readonly name: string;
  readonly platformHint: string;
  readonly ownerUserId: string;
  readonly ownerDisplayName: string;
  readonly ownerRole: "ADMIN" | "TEACHER";
  readonly status: "ACTIVE" | "DISABLED";
  readonly description: string | null;
  readonly policyVersion: number;
  readonly updatedAt: string;
}

export interface IntegrationCredential {
  readonly id: string;
  readonly integrationClientId: string;
  readonly tokenPrefix: string;
  readonly status: "ACTIVE" | "REVOKED";
  readonly validFrom: string;
  readonly expiresAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
  readonly createdAt: string;
}

export interface IntegrationGrant {
  readonly id: string;
  readonly integrationClientId: string;
  readonly capability: string;
  readonly scopeType: string;
  readonly scopeIds: readonly string[];
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly grantVersion: number;
  readonly status: "ACTIVE" | "REVOKED";
  readonly validFrom: string;
  readonly expiresAt: string | null;
  readonly issuedByUserId: string;
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IntegrationClientDetail {
  readonly client: IntegrationClient;
  readonly credentials: readonly IntegrationCredential[];
  readonly grants: readonly IntegrationGrant[];
}

export interface IntegrationAction {
  readonly id: string;
  readonly clientId: string;
  readonly ownerUserId: string;
  readonly capability: string;
  readonly operation: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly planHash: string;
  readonly riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  readonly expectedVersions: Readonly<Record<string, unknown>>;
  readonly grantVersion: number;
  readonly status: string;
  readonly approvalMethod: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly executedAt: string | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
}
