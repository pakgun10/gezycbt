import type { AppConfig } from "@gezycbt/config";
import type { Id } from "@gezycbt/contracts";
import { createBunSqlDatabase, type DatabasePort } from "@gezycbt/database";
import type { Elysia } from "elysia";
import { AuthorizationPolicyService } from "../application/authorization";
import {
  AcademicMasterService,
  SqlAcademicRepository,
} from "../modules/academics";
import {
  AuthLoginService,
  AuthSessionService,
  PasswordService,
  registerAuthRoutes,
  SqlAuthSessionRepository,
  SqlAuthThrottleRepository,
  SqlLoginFailureLimiter,
} from "../modules/auth";
import {
  ExamSessionAdministrationService,
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
import { SqlUserRepository, UserApplicationService } from "../modules/users";
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
  const examSessionAdministration = new ExamSessionAdministrationService(
    examRuntimeStore,
  );
  const accessCodeSecret = new TextEncoder().encode(
    config.accessCodeHmacSecret ?? "gezycbt-development-access-code-secret-32",
  );
  const accessCodes = new ScheduleAccessCodeService(
    scheduleRepository,
    authorization,
    {
      hasher: createHmacScheduleAccessCodeHasher({ secret: accessCodeSecret }),
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
