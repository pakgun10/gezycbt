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
import { SqlUserRepository } from "../modules/users";
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

  const database = createBunSqlDatabase(config.databaseUrl);
  const users = new SqlUserRepository(database);
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
      return withAuth.use(
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
