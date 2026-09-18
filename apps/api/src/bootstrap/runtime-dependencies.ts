import type { AppConfig } from "@gezycbt/config";
import type { Id } from "@gezycbt/contracts";
import { createBunSqlDatabase, type DatabasePort } from "@gezycbt/database";
import type { Elysia } from "elysia";
import type { UseCaseContext } from "../application/actor-context";
import { AuthorizationPolicyService } from "../application/authorization";
import {
  AcademicMasterService,
  SqlAcademicRepository,
} from "../modules/academics";
import {
  AuthLoginService,
  AuthSessionService,
  PasswordService,
  readAuthCookie,
  registerAuthRoutes,
  SqlAuthSessionRepository,
  SqlAuthThrottleRepository,
  SqlLoginFailureLimiter,
} from "../modules/auth";
import {
  createExamSessionRoutes,
  ExamAnswerService,
  ExamSessionAdministrationService,
  ExamSessionError,
  ExamSessionQueryService,
  ExamSessionStartService,
  ExamSubmissionService,
  type ParticipantScheduleSummary,
  SqlExamRuntimeStore,
} from "../modules/exam-sessions";
import {
  ExamDraftService,
  ExamPublishService,
  ExamReadinessService,
  SqlExamDraftRepository,
} from "../modules/exams";
import { ExportService } from "../modules/exports";
import {
  createIntegrationRoutes,
  IntegrationExamAuthoringService,
  IntegrationExportService,
  IntegrationQuestionAuthoringService,
  IntegrationRateLimiter,
  IntegrationResultReadService,
  IntegrationService,
  SqlIntegrationAuditSink,
  SqlIntegrationDiscoveryRepository,
  SqlIntegrationRepository,
} from "../modules/integrations";
import {
  type AgentActionExecutionContext,
  IntegrationActionService,
} from "../modules/integrations/action-service";
import {
  ContainerImageDecoder,
  FileSystemMediaStorage,
  MediaRelationService,
  MediaUploadService,
  SqlMediaRelationRepository,
} from "../modules/media";
import {
  QuestionDraftService,
  QuestionPublishService,
  QuestionReadinessService,
  SqlQuestionDraftRepository,
} from "../modules/questions";
import {
  createHmacScheduleAccessCodeHasher,
  ScheduleAccessCodeService,
  ScheduleService,
  SqlScheduleRepository,
} from "../modules/schedules";
import { createStaffRoutes, isStaffReauthenticated } from "../modules/staff";
import {
  createAesGcmCredentialArtifactCipher,
  ReauthenticationRequiredError,
  SqlUserImportCommitRepository,
  SqlUserImportRepository,
  UserImportCommitService,
  UserImportPreviewService,
} from "../modules/user-imports";
import {
  SqlUserRepository,
  UserApplicationService,
  type UserRepository,
} from "../modules/users";
import { instrumentDatabase } from "../observability/database";
import { FilesystemDiskGuard } from "../observability/disk-guard";
import { createMetrics } from "../observability/metrics";
import type { AppDependencies } from "./create-app";

export interface RuntimeDependencies extends AppDependencies {
  readonly database?: DatabasePort;
  readonly shutdown: () => Promise<void>;
}

/**
 * Builds process-owned dependencies for a real API process.
 *
 * Migrations deliberately remain a separate release command. API startup only
 * opens the pool, checks readiness, and mounts the SQL-backed staff and
 * authentication route adapters. Domain services remain behind application
 * interfaces so the same rules can later be reused by the agent bridge.
 */
export function createRuntimeDependencies(
  config: AppConfig,
): RuntimeDependencies {
  if (!config.databaseUrl) {
    return { shutdown: async () => undefined };
  }

  const metrics = createMetrics();
  const database = instrumentDatabase(
    createBunSqlDatabase(config.databaseUrl),
    metrics,
  );
  const users = new SqlUserRepository(database);
  const userApplication = new UserApplicationService(users);
  const academics = new AcademicMasterService(
    new SqlAcademicRepository(database),
  );
  const academicRepository = new SqlAcademicRepository(database);
  const authorization = new AuthorizationPolicyService((teacherId) =>
    academicRepository.getTeacherScopes(teacherId),
  );
  const questionRepository = new SqlQuestionDraftRepository(database);
  const examRepository = new SqlExamDraftRepository(database);
  const scheduleRepository = new SqlScheduleRepository(database);
  const questionDrafts = new QuestionDraftService(
    questionRepository,
    authorization,
  );
  const questionPublish = new QuestionPublishService(
    questionRepository,
    authorization,
  );
  const questionReadiness = new QuestionReadinessService(questionRepository);
  const mediaRepository = new SqlMediaRelationRepository(database);
  const mediaRoot =
    config.mediaRoot ??
    (config.appEnv === "production" ? "/var/lib/gezycbt/media" : ".data/media");
  const diskGuard = new FilesystemDiskGuard(mediaRoot);
  const mediaStorage = new FileSystemMediaStorage(mediaRoot);
  const mediaUpload = new MediaUploadService(
    mediaStorage,
    mediaRepository,
    new ContainerImageDecoder(),
    undefined,
    diskGuard,
  );
  const mediaRelations = new MediaRelationService(
    mediaRepository,
    authorization,
    mediaStorage,
  );
  const examDrafts = new ExamDraftService(examRepository, authorization);
  const examPublish = new ExamPublishService(examRepository, authorization);
  const examReadiness = new ExamReadinessService(examRepository);
  const scheduleDrafts = new ScheduleService(scheduleRepository, authorization);
  const examRuntimeStore = new SqlExamRuntimeStore(database);
  const examSessionStart = new ExamSessionStartService(examRuntimeStore);
  const examAnswer = new ExamAnswerService(examRuntimeStore);
  const examSessionQuery = new ExamSessionQueryService(examRuntimeStore);
  const examSubmission = new ExamSubmissionService(examRuntimeStore);
  const examSessionAdministration = new ExamSessionAdministrationService(
    examRuntimeStore,
  );
  const accessCodeSecret = new TextEncoder().encode(
    config.accessCodeHmacSecret ?? "gezycbt-development-access-code-secret-32",
  );
  const accessCodeHasher = createHmacScheduleAccessCodeHasher({
    secret: accessCodeSecret,
  });
  const accessCodes = new ScheduleAccessCodeService(
    scheduleRepository,
    authorization,
    {
      hasher: accessCodeHasher,
    },
  );
  const userImportRepository = new SqlUserImportRepository(database);
  const userImportCommitRepository = new SqlUserImportCommitRepository(
    database,
  );
  const userImportPreview = new UserImportPreviewService(userImportRepository);
  const userImportCommit = new UserImportCommitService(
    userImportCommitRepository,
    createAesGcmCredentialArtifactCipher(accessCodeSecret),
    undefined,
    {
      async assertFresh(context) {
        if (
          !context.actor.userId ||
          !isStaffReauthenticated(context.actor.userId)
        )
          throw new ReauthenticationRequiredError();
      },
    },
  );
  const sessions = new AuthSessionService({
    repository: new SqlAuthSessionRepository(database),
  });
  const login = new AuthLoginService({
    users,
    passwords: new PasswordService(),
    sessions,
    limiter: new SqlLoginFailureLimiter(
      new SqlAuthThrottleRepository(database),
    ),
  });
  const integrationRepository = new SqlIntegrationRepository(database);
  const integrationDiscovery = new SqlIntegrationDiscoveryRepository(database);
  const integrationService = new IntegrationService(integrationRepository, {
    audit: new SqlIntegrationAuditSink(database),
    discovery: integrationDiscovery,
    ownerScopeLookup: (teacherId) =>
      academicRepository.getTeacherScopes(teacherId),
    rateLimiter: new IntegrationRateLimiter(),
  });
  const agentQuestionAuthoring = new IntegrationQuestionAuthoringService({
    integration: integrationService,
    repository: questionRepository,
    drafts: questionDrafts,
    publish: questionPublish,
    readiness: questionReadiness,
    mediaUpload,
    mediaRelations,
  });
  const agentExamAuthoring = new IntegrationExamAuthoringService({
    integration: integrationService,
    drafts: examDrafts,
    publish: examPublish,
    readiness: examReadiness,
  });
  const agentResultReads = new IntegrationResultReadService({
    database,
    integration: integrationService,
  });
  const exports = new ExportService(database, diskGuard);
  const agentExports = new IntegrationExportService({
    database,
    integration: integrationService,
    exports,
  });
  const agentActions = new IntegrationActionService({
    database,
    integration: integrationService,
    executor: {
      async publishExam(context) {
        return agentExamAuthoring.publishRevision(
          context.authentication,
          planTargetId(context.plan),
          planVersion(context.plan, "updatedAt") as never,
          context.useCase.actor.requestId,
          context.useCase.idempotencyKey ?? "agent-action-publish",
        );
      },
      async releaseResults(context, release) {
        return releaseAgentResults(database, context, release);
      },
      async closeSchedule(context) {
        const targetId = planTargetId(context.plan);
        const parameters = planParameters(context.plan);
        return examSessionAdministration.closeSchedule(context.useCase, {
          scheduleId: targetId,
          expectedUpdatedAt: planVersion(context.plan, "updatedAt") as never,
          reason: String(parameters.reason),
        });
      },
      async extendTime(context) {
        const parameters = planParameters(context.plan);
        return examSessionAdministration.extendTime(context.useCase, {
          sessionId: planTargetId(context.plan),
          additionalMinutes: Number(parameters.minutes),
          reason: String(parameters.reason),
          expectedVersion: planVersion(context.plan, "version") as number,
        });
      },
      async endSession(context) {
        const parameters = planParameters(context.plan);
        const expectedVersion = planVersion(context.plan, "version");
        return examSessionAdministration.endSession(context.useCase, {
          sessionId: planTargetId(context.plan),
          reason: String(parameters.reason),
          ...(expectedVersion === undefined
            ? {}
            : { expectedVersion: expectedVersion as number }),
        });
      },
      async resetAttempt(context) {
        const parameters = planParameters(context.plan);
        const impact = planImpact(context.plan);
        return examSessionAdministration.resetAttempt(context.useCase, {
          scheduleId: String(impact.scheduleId) as Id,
          participantId: String(impact.participantId) as Id,
          reason: String(parameters.reason),
          resetIdempotencyKey: `agent-action-${context.actionId}`,
        });
      },
      async disableUser(context) {
        const userId = planTargetId(context.plan);
        const expectedUpdatedAt = planVersion(context.plan, "updatedAt");
        return userApplication.disableUser(
          context.useCase,
          userId,
          expectedUpdatedAt as never,
        );
      },
    },
  });
  const authOptions = {
    loginService: login,
    sessionService: sessions,
    expectedOrigin: config.appOrigin,
    currentUser: async (userId: Id) => {
      const user = await users.findById(userId);
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
      };
    },
  };

  let closed = false;
  return {
    database,
    metrics,
    readinessChecks: [
      {
        name: "database",
        check: async () => {
          await database.query("SELECT 1 AS ready");
        },
      },
    ],
    registerRoutes: (app: Elysia) => {
      const withAuth = registerAuthRoutes(app, authOptions);
      return withAuth
        .use(
          createExamSessionRoutes({
            startService: examSessionStart,
            answerService: examAnswer,
            queryService: examSessionQuery,
            submissionService: examSubmission,
            participantContext: (request, requestId) =>
              resolveRuntimeParticipantContext(
                request,
                requestId,
                sessions,
                users,
              ),
            participantSnapshot: (participantId) =>
              loadParticipantSnapshot(database, users, participantId),
            participantClassIds: (participantId) =>
              loadParticipantClassIds(database, participantId),
            participantSchedules: (input) =>
              loadParticipantSchedules(database, input),
            mainAccessCodeDigest: (code) =>
              accessCodeHasher.digest("MAIN_ACCESS_CODE", code),
            practiceTokenDigest: (token) =>
              accessCodeHasher.digest("PRACTICE_TOKEN", token),
          }),
        )
        .use(
          createIntegrationRoutes({
            database,
            service: integrationService,
            users,
            sessionService: sessions,
            isReauthenticated: (userId) => isStaffReauthenticated(userId),
            expectedOrigin: config.appOrigin,
            questionAuthoring: agentQuestionAuthoring,
            examAuthoring: agentExamAuthoring,
            resultReads: agentResultReads,
            exports: agentExports,
            actions: agentActions,
          }),
        )
        .use(
          createStaffRoutes({
            database,
            users,
            sessionService: sessions,
            academics,
            teacherScopeLookup: (teacherId) =>
              academicRepository.getTeacherScopes(teacherId),
            authorization,
            questions: {
              drafts: questionDrafts,
              publish: questionPublish,
              readiness: questionReadiness,
            },
            exams: {
              drafts: examDrafts,
              publish: examPublish,
              readiness: examReadiness,
            },
            schedules: {
              drafts: scheduleDrafts,
              accessCodes,
            },
            userImports: {
              preview: userImportPreview,
              commit: userImportCommit,
            },
            runtime: { administration: examSessionAdministration },
            exports,
            expectedOrigin: config.appOrigin,
          }),
        );
    },
    shutdown: async () => {
      if (closed) return;
      closed = true;
      await database.close();
    },
  };
}

type RuntimeRow = Record<string, unknown>;
type RuntimeUserReader = Pick<UserRepository, "findById">;

async function resolveRuntimeParticipantContext(
  request: Request,
  requestId: string,
  sessions: Pick<AuthSessionService, "resolve">,
  users: RuntimeUserReader,
): Promise<UseCaseContext> {
  const token = readAuthCookie(request.headers.get("cookie"));
  if (!token)
    throw new ExamSessionError(
      "AUTHENTICATION_REQUIRED",
      "Silakan masuk untuk melanjutkan.",
      401,
    );
  const session = await sessions.resolve(token);
  const user = session ? await users.findById(session.userId) : null;
  if (!session || !user || user.status !== "ACTIVE")
    throw new ExamSessionError(
      "AUTH_SESSION_EXPIRED",
      "Sesi login telah berakhir.",
      401,
    );
  if (user.role !== "PARTICIPANT")
    throw new ExamSessionError(
      "AUTHENTICATION_REQUIRED",
      "Silakan masuk sebagai peserta.",
      401,
    );
  return {
    actor: {
      actorType: "HUMAN",
      role: "PARTICIPANT",
      userId: user.id,
      active: true,
      requestId,
    },
  };
}

async function loadParticipantClassIds(
  database: DatabasePort,
  participantId: Id,
): Promise<readonly Id[]> {
  const rows = await database.query<RuntimeRow>(
    `SELECT cm.class_id
     FROM class_members cm
     JOIN classes c ON c.id = cm.class_id
     WHERE cm.participant_id = ? AND cm.left_at IS NULL AND c.status = 'ACTIVE'
     ORDER BY cm.class_id ASC`,
    [participantId],
  );
  return rows.map((row) => String(row.class_id) as Id);
}

async function loadParticipantSnapshot(
  database: DatabasePort,
  users: RuntimeUserReader,
  participantId: Id,
): Promise<{
  readonly participantName: string;
  readonly classSnapshot: string | null;
  readonly institutionSnapshot: string | null;
}> {
  const user = await users.findById(participantId);
  if (!user || user.role !== "PARTICIPANT" || user.status !== "ACTIVE")
    throw new ExamSessionError(
      "AUTHENTICATION_REQUIRED",
      "Silakan masuk untuk melanjutkan.",
      401,
    );
  const [classRows, schoolRows] = await Promise.all([
    database.query<RuntimeRow>(
      `SELECT GROUP_CONCAT(CONCAT(c.code, ' - ', c.name) ORDER BY c.name SEPARATOR ', ') AS class_snapshot
       FROM class_members cm
       JOIN classes c ON c.id = cm.class_id
       WHERE cm.participant_id = ? AND cm.left_at IS NULL AND c.status = 'ACTIVE'`,
      [participantId],
    ),
    database.query<RuntimeRow>(
      "SELECT school_name FROM school_settings WHERE id = 1 LIMIT 1",
    ),
  ]);
  const classSnapshot = classRows[0]?.class_snapshot;
  const schoolName = schoolRows[0]?.school_name;
  return {
    participantName: user.displayName,
    classSnapshot:
      classSnapshot === null || classSnapshot === undefined
        ? null
        : String(classSnapshot).slice(0, 150),
    institutionSnapshot:
      schoolName === null || schoolName === undefined
        ? null
        : String(schoolName).slice(0, 200),
  };
}

async function loadParticipantSchedules(
  database: DatabasePort,
  input: {
    readonly participantId: Id;
    readonly classIds: readonly Id[];
  },
): Promise<readonly ParticipantScheduleSummary[]> {
  const classPredicate = input.classIds.length
    ? `EXISTS (
         SELECT 1 FROM exam_schedule_classes esc
         WHERE esc.schedule_id = es.id
           AND esc.class_id IN (${input.classIds.map(() => "?").join(", ")})
       )`
    : "1 = 0";
  const rows = await database.query<RuntimeRow>(
    `SELECT es.id, er.title, s.name AS subject_name, es.mode, es.status,
            es.starts_at, es.ends_at, es.duration_seconds, es.max_attempts,
            es.main_access_code_hash IS NOT NULL AS main_access_code_required,
            es.main_access_code_hint,
            (SELECT COUNT(*) FROM exam_sessions ses
             WHERE ses.schedule_id = es.id AND ses.participant_id = ?) AS attempts_used,
            (SELECT ses.id FROM exam_sessions ses
             WHERE ses.schedule_id = es.id AND ses.participant_id = ? AND ses.status = 'ACTIVE'
             ORDER BY ses.id DESC LIMIT 1) AS active_session_id,
            (SELECT ses.id FROM exam_sessions ses
             JOIN exam_results er2 ON er2.session_id = ses.id
             WHERE ses.schedule_id = es.id AND ses.participant_id = ?
             ORDER BY ses.attempt_no DESC, ses.id DESC LIMIT 1) AS result_session_id,
            (SELECT er2.released_at FROM exam_sessions ses
             JOIN exam_results er2 ON er2.session_id = ses.id
             WHERE ses.schedule_id = es.id AND ses.participant_id = ?
             ORDER BY ses.attempt_no DESC, ses.id DESC LIMIT 1) AS result_released_at,
            EXISTS (SELECT 1 FROM exam_attempt_grants eag
                    WHERE eag.schedule_id = es.id AND eag.participant_id = ?
                      AND eag.consumed_by_session_id IS NULL) AS attempt_reset_available
     FROM exam_schedules es
     JOIN exam_revisions er ON er.id = es.exam_revision_id
     JOIN exams e ON e.id = er.exam_id
     LEFT JOIN subjects s ON s.id = e.subject_id
     WHERE es.mode = 'MAIN'
       AND es.status IN ('READY', 'OPEN', 'CLOSED', 'ARCHIVED')
       AND (
         EXISTS (SELECT 1 FROM exam_schedule_participants esp
                 WHERE esp.schedule_id = es.id AND esp.participant_id = ?)
         OR ${classPredicate}
       )
     ORDER BY es.starts_at DESC, es.id DESC
     LIMIT 201`,
    [
      input.participantId,
      input.participantId,
      input.participantId,
      input.participantId,
      input.participantId,
      input.participantId,
      ...input.classIds,
    ],
  );
  return rows.map((row) => ({
    id: String(row.id) as Id,
    title: String(row.title),
    ...(row.subject_name === null || row.subject_name === undefined
      ? {}
      : { subjectName: String(row.subject_name) }),
    mode: String(row.mode) as ParticipantScheduleSummary["mode"],
    status: String(row.status) as ParticipantScheduleSummary["status"],
    startsAt: String(row.starts_at) as ParticipantScheduleSummary["startsAt"],
    endsAt: String(row.ends_at) as ParticipantScheduleSummary["endsAt"],
    durationSeconds: Number(row.duration_seconds),
    maxAttempts: Number(row.max_attempts),
    attemptsUsed: Number(row.attempts_used ?? 0),
    activeSessionId:
      row.active_session_id === null || row.active_session_id === undefined
        ? null
        : (String(row.active_session_id) as Id),
    resultSessionId:
      row.result_session_id === null || row.result_session_id === undefined
        ? null
        : (String(row.result_session_id) as Id),
    resultReleased:
      row.result_released_at !== null && row.result_released_at !== undefined,
    attemptResetAvailable: databaseBooleanValue(row.attempt_reset_available),
    mainAccessCodeRequired: databaseBooleanValue(row.main_access_code_required),
    mainAccessCodeHint:
      row.main_access_code_hint === null ||
      row.main_access_code_hint === undefined
        ? null
        : String(row.main_access_code_hint),
  }));
}

function databaseBooleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function planRecord(
  plan: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = plan[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function planTargetId(plan: Readonly<Record<string, unknown>>): Id {
  return String(planRecord(plan, "target").id ?? "") as Id;
}

function planParameters(
  plan: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return planRecord(plan, "parameters");
}

function planImpact(
  plan: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return planRecord(plan, "impact");
}

function planVersion(
  plan: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return planRecord(plan, "expectedVersions")[key];
}

async function releaseAgentResults(
  database: DatabasePort,
  context: AgentActionExecutionContext,
  release: boolean,
): Promise<Readonly<Record<string, number>>> {
  const target = planRecord(context.plan, "target");
  const impact = planImpact(context.plan);
  const parameters = planParameters(context.plan);
  const scheduleId = String(
    target.type === "schedule" ? target.id : (impact.scheduleId ?? ""),
  ) as Id;
  if (!/^\d+$/u.test(scheduleId))
    throw new Error("Action schedule target invalid");
  const allFiltered = parameters.allFiltered === true;
  const filter = parameters.filter;
  const resultIds = Array.isArray(parameters.resultIds)
    ? parameters.resultIds.map((id) => String(id))
    : [];
  return database.transaction(async (connection) => {
    const where = ["schedule_id = ?"];
    const values: unknown[] = [scheduleId];
    if (allFiltered && filter === "RELEASED")
      where.push("released_at IS NOT NULL");
    if (allFiltered && filter === "UNRELEASED")
      where.push("released_at IS NULL");
    if (!allFiltered) {
      if (resultIds.length === 0)
        throw new Error("Action result target is empty");
      where.push(`id IN (${resultIds.map(() => "?").join(",")})`);
      values.push(...resultIds);
    }
    const rows = await connection.query<Record<string, unknown>>(
      `SELECT id, released_at FROM exam_results WHERE ${where.join(" AND ")} FOR UPDATE`,
      values,
    );
    const changed = rows.filter((row) =>
      release ? row.released_at === null : row.released_at !== null,
    );
    if (changed.length) {
      const changedIds = changed.map((row) => row.id);
      await connection.execute(
        `UPDATE exam_results SET released_at = ${release ? "UTC_TIMESTAMP(6)" : "NULL"}
         WHERE schedule_id = ? AND id IN (${changedIds.map(() => "?").join(",")})`,
        [scheduleId, ...changedIds],
      );
    }
    return {
      changed: changed.length,
      skipped: rows.length - changed.length,
    };
  });
}
