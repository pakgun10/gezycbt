import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { Elysia } from "elysia";
import type { UseCaseContext } from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import { AppError } from "../../http/app-error";
import { DiskProtectionError } from "../../observability/disk-guard";
import type { AcademicMasterService } from "../academics/service";
import {
  assertCsrfRequest,
  CSRF_HEADER_NAME,
  CsrfProtectionError,
} from "../auth/csrf";
import { PasswordService } from "../auth/password";
import { type AuthSessionService, readAuthCookie } from "../auth/session";
import type { ExamSessionAdministrationService } from "../exam-sessions/service";
import type { ExamPublishService } from "../exams/publish";
import type { ExamReadinessService } from "../exams/readiness";
import type { ExamDraftService } from "../exams/service";
import {
  ExportActiveError,
  ExportDownloadTokenError,
  ExportNotFoundError,
  ExportNotReadyError,
  ExportService,
  ExportValidationError,
  exportJobView,
} from "../exports";
import {
  type QuestionImportService,
  QuestionImportValidationError,
} from "../questions/import";
import type { QuestionPublishService } from "../questions/publish";
import type { QuestionReadinessService } from "../questions/readiness";
import type { QuestionDraftService } from "../questions/service";
import type { ScheduleAccessCodeService } from "../schedules/access-code";
import type { ScheduleService } from "../schedules/service";
import type { UserImportCommitService } from "../user-imports/commit-service";
import type { UserImportPreviewService } from "../user-imports/service";
import type { StoredUser, UserRole } from "../users";

const REAUTH_TTL_MS = 10 * 60 * 1000;
const recentReauthentication = new Map<Id, number>();

export function markStaffReauthenticated(userId: Id): void {
  recentReauthentication.set(userId, Date.now());
}

export function isStaffReauthenticated(userId: Id): boolean {
  const at = recentReauthentication.get(userId) ?? 0;
  return Date.now() - at <= REAUTH_TTL_MS;
}

export interface StaffRouteOptions {
  readonly database: DatabasePort;
  readonly users: {
    readonly findById: (id: Id) => Promise<StoredUser | null>;
    readonly create: (input: {
      username: string;
      displayName: string;
      role: UserRole;
      passwordHash: string;
      forcePasswordChange?: boolean;
    }) => Promise<StoredUser>;
    readonly update: (
      id: Id,
      input: {
        displayName?: string;
        role?: UserRole;
        forcePasswordChange?: boolean;
      },
      expectedUpdatedAt?: UtcTimestamp,
    ) => Promise<StoredUser | null>;
    readonly disable: (
      id: Id,
      expectedUpdatedAt?: UtcTimestamp,
    ) => Promise<StoredUser | null>;
  };
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  >;
  readonly academics: AcademicMasterService;
  /** Read-only scope lookup used by teacher monitoring/result predicates. */
  readonly teacherScopeLookup?: (teacherId: Id) => Promise<{
    readonly subjectIds: readonly Id[];
    readonly classIds: readonly Id[];
  } | null>;
  readonly authorization?: Pick<
    AuthorizationPolicyService,
    "assertTeacherScope" | "assertAdmin"
  >;
  readonly questions?: {
    readonly drafts: QuestionDraftService;
    readonly imports: QuestionImportService;
    readonly publish: QuestionPublishService;
    readonly readiness: QuestionReadinessService;
  };
  readonly exams?: {
    readonly drafts: ExamDraftService;
    readonly publish: ExamPublishService;
    readonly readiness: ExamReadinessService;
  };
  readonly schedules?: {
    readonly drafts: ScheduleService;
    readonly accessCodes: ScheduleAccessCodeService;
  };
  readonly userImports?: {
    readonly preview: UserImportPreviewService;
    readonly commit?: UserImportCommitService;
  };
  readonly runtime?: {
    readonly administration: Pick<
      ExamSessionAdministrationService,
      "extendTime" | "endSession" | "closeSchedule" | "resetAttempt"
    >;
  };
  /** Shared bounded export job/worker used by staff and agent routes. */
  readonly exports?: ExportService;
  readonly expectedOrigin: URL | string;
}

/** Staff routes share the application services and never trust role/scope from the browser. */
export function createStaffRoutes(options: StaffRouteOptions): Elysia {
  const app = new Elysia({ name: "gezycbt-staff-routes" });
  const exports = options.exports ?? new ExportService(options.database);
  app.get("/api/v1/admin/users", async ({ request, query }) => {
    try {
      const actor = await requireStaff(request, options, "ADMIN");
      const q = queryValue(query, "search");
      const roleFilter = queryValue(query, "role");
      const limit = boundedLimit(queryValue(query, "limit"));
      const cursor = queryValue(query, "cursor");
      const requestedPage = optionalPage(queryValue(query, "page"));
      if (cursor && requestedPage !== undefined)
        throw new AppError(
          422,
          "VALIDATION_FAILED",
          "cursor dan page tidak dapat digunakan bersamaan.",
        );
      const conditions = ["1 = 1"];
      const parameters: unknown[] = [];
      if (q) {
        conditions.push(
          "(u.username_normalized LIKE ? OR u.display_name LIKE ?)",
        );
        const term = `%${q.slice(0, 100)}%`;
        parameters.push(term, term);
      }
      if (roleFilter) {
        conditions.push("u.role = ?");
        parameters.push(
          oneOf(
            roleFilter,
            ["ADMIN", "TEACHER", "PARTICIPANT"] as const,
            "role",
          ),
        );
      }
      if (requestedPage !== undefined) {
        const countRows = await options.database.query<Record<string, unknown>>(
          `SELECT COUNT(*) AS total FROM users u WHERE ${conditions.join(" AND ")}`,
          parameters,
        );
        const totalItems = Number(countRows[0]?.total ?? 0);
        const totalPages = Math.ceil(totalItems / limit);
        const page = Math.min(requestedPage, Math.max(totalPages, 1));
        const offset = (page - 1) * limit;
        const rows = await options.database.query<Record<string, unknown>>(
          `SELECT u.id, u.username, u.role, u.status, u.display_name,
                  u.force_password_change, u.last_login_at, u.updated_at
           FROM users u WHERE ${conditions.join(" AND ")}
           ORDER BY u.id ASC LIMIT ? OFFSET ?`,
          [...parameters, limit, offset],
        );
        return {
          data: {
            items: rows.map(mapUser),
            nextCursor: null,
            page,
            pageSize: limit,
            totalItems,
            totalPages,
          },
          actor: actor.user.id,
        };
      }
      if (cursor && /^\d+$/u.test(cursor)) {
        conditions.push("u.id > ?");
        parameters.push(cursor);
      }
      parameters.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT u.id, u.username, u.role, u.status, u.display_name,
                u.force_password_change, u.last_login_at, u.updated_at
         FROM users u WHERE ${conditions.join(" AND ")}
         ORDER BY u.id ASC LIMIT ?`,
        parameters,
      );
      const items = rows.slice(0, limit).map(mapUser);
      return {
        data: {
          items,
          nextCursor: rows.length > limit ? String(rows[limit]?.id) : null,
        },
        actor: actor.user.id,
      };
    } catch (error) {
      throw mapStaffError(error);
    }
  });
  app.post("/api/v1/admin/users", async ({ request, body }) => {
    try {
      const actor = await requireStaff(request, options, "ADMIN");
      await requireCsrf(request, actor.session, options);
      const payload = objectPayload(body);
      const role = oneOf(
        payload.role,
        ["ADMIN", "TEACHER", "PARTICIPANT"] as const,
        "role",
      );
      const username = stringField(payload.username, "username");
      const displayName = stringField(payload.displayName, "displayName");
      const password = stringField(payload.password, "password");
      const hash = await new PasswordService().hash(
        password,
        role,
        username.trim().toLowerCase(),
      );
      const user = await options.users.create({
        username,
        displayName,
        role,
        passwordHash: hash,
        forcePasswordChange: true,
      });
      return { data: mapUser(user) };
    } catch (error) {
      throw mapStaffError(error);
    }
  });
  app.patch("/api/v1/admin/users/:id", async ({ request, params, body }) => {
    try {
      const actor = await requireStaff(request, options, "ADMIN");
      await requireCsrf(request, actor.session, options);
      const payload = objectPayload(body);
      const id = idParam(params);
      const expected = optionalString(payload.expectedUpdatedAt) as
        | UtcTimestamp
        | undefined;
      const status = optionalString(payload.status);
      const displayName = optionalString(payload.displayName);
      const requestedRole = optionalString(payload.role);
      const user =
        status === "DISABLED"
          ? await options.users.disable(id, expected)
          : await options.users.update(
              id,
              {
                ...(displayName ? { displayName } : {}),
                ...(requestedRole
                  ? {
                      role: oneOf(
                        requestedRole,
                        ["ADMIN", "TEACHER", "PARTICIPANT"] as const,
                        "role",
                      ),
                    }
                  : {}),
                ...(typeof payload.forcePasswordChange === "boolean"
                  ? { forcePasswordChange: payload.forcePasswordChange }
                  : {}),
              },
              expected,
            );
      if (!user)
        throw new AppError(404, "NOT_FOUND", "Pengguna tidak ditemukan.");
      return { data: mapUser(user) };
    } catch (error) {
      throw mapStaffError(error);
    }
  });
  app.post("/api/v1/admin/users/import/preview", async ({ request, body }) =>
    wrapMutation(request, options, "ADMIN", async (staffContext) => {
      if (!options.userImports) throw serviceUnavailable("Import service");
      const payload = objectPayload(body);
      return options.userImports.preview.createPreview(staffContext, {
        academicYearId: idValue(payload.academicYearId, "academicYearId"),
        csv: stringField(payload.csv, "csv"),
      });
    }),
  );
  app.get(
    "/api/v1/admin/users/import-previews/:id/rows",
    async ({ request, params, query }) =>
      wrapRead(request, options, "ADMIN", async (staffContext) => {
        if (!options.userImports) throw serviceUnavailable("Import service");
        const cursor = queryValue(query, "cursor");
        const classification = queryValue(query, "classification");
        return options.userImports.preview.listRows(
          staffContext,
          idParam(params),
          {
            ...(cursor ? { cursor } : {}),
            ...(classification
              ? { classification: classification as never }
              : {}),
            limit: boundedLimit(queryValue(query, "limit")),
          },
        );
      }),
  );
  app.get(
    "/api/v1/admin/users/import-previews/:id/errors.csv",
    async ({ request, params, set }) => {
      try {
        const identity = await requireStaff(request, options, "ADMIN");
        if (!options.userImports) throw serviceUnavailable("Import service");
        const csv = await options.userImports.preview.downloadErrorCsv(
          actorContext(request, identity),
          idParam(params),
        );
        set.headers["content-type"] = "text/csv; charset=utf-8";
        set.headers["content-disposition"] =
          'attachment; filename="import-errors.csv"';
        return csv;
      } catch (error) {
        throw mapStaffError(error);
      }
    },
  );
  app.post("/api/v1/admin/users/import/commit", async ({ request, body }) =>
    wrapMutation(request, options, "ADMIN", async (staffContext) => {
      if (!options.userImports?.commit)
        throw serviceUnavailable("Import commit service");
      if (!isStaffReauthenticated(staffContext.actor.userId as Id))
        throw new AppError(
          401,
          "REAUTH_REQUIRED",
          "Masuk ulang diperlukan sebelum commit import.",
        );
      const payload = objectPayload(body);
      return options.userImports.commit.commit(staffContext, {
        previewId: idValue(payload.previewId, "previewId"),
        commitToken: stringField(payload.commitToken, "commitToken"),
      });
    }),
  );
  app.post("/api/v1/admin/users/reauth", async ({ request, body }) => {
    try {
      const identity = await requireStaff(request, options, "ADMIN");
      await requireCsrf(request, identity.session, options);
      const password = stringField(objectPayload(body).password, "password");
      const valid = await new PasswordService().verify(
        password,
        (await options.users.findById(identity.user.id as Id))?.passwordHash ??
          "",
      );
      if (!valid)
        throw new AppError(
          401,
          "AUTHENTICATION_REQUIRED",
          "Password tidak valid.",
        );
      markStaffReauthenticated(identity.user.id as Id);
      return {
        data: {
          verified: true,
          expiresAt: new Date(Date.now() + REAUTH_TTL_MS).toISOString(),
        },
      };
    } catch (error) {
      throw mapStaffError(error);
    }
  });

  app.get("/api/v1/admin/academic-years", async ({ request, query }) =>
    wrapRead(request, options, "ADMIN", (staffContext) =>
      options.academics.listAcademicYears(staffContext, pageRequest(query)),
    ),
  );
  app.post("/api/v1/admin/academic-years", async ({ request, body }) =>
    wrapMutation(request, options, "ADMIN", (staffContext) =>
      options.academics.createAcademicYear(staffContext, body as never),
    ),
  );
  app.post(
    "/api/v1/admin/academic-years/:id/activate",
    async ({ request, params }) =>
      wrapMutation(request, options, "ADMIN", (staffContext) =>
        options.academics.activateAcademicYear(staffContext, idParam(params)),
      ),
  );
  app.get("/api/v1/admin/classes", async ({ request, query }) =>
    wrapRead(request, options, "ADMIN", (staffContext) =>
      options.academics.listClasses(
        staffContext,
        optionalId(queryValue(query, "academicYearId")),
        pageRequest(query),
      ),
    ),
  );
  app.post("/api/v1/admin/classes", async ({ request, body }) =>
    wrapMutation(request, options, "ADMIN", (staffContext) =>
      options.academics.createClass(staffContext, body as never),
    ),
  );
  app.get("/api/v1/admin/classes/:id/members", async ({ request, params }) =>
    wrapRead(request, options, "ADMIN", async (staffContext) => ({
      items: await options.academics.listClassMemberProfiles(
        staffContext,
        idParam(params),
      ),
    })),
  );
  app.put(
    "/api/v1/admin/classes/:id/members",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "ADMIN", async (staffContext) => {
        const payload = objectPayload(body);
        if (!Array.isArray(payload.participantIds))
          throw new AppError(
            422,
            "VALIDATION_FAILED",
            "participantIds harus berupa daftar peserta.",
          );
        const participantIds = payload.participantIds.map((value) =>
          idValue(value, "participantId"),
        );
        if (participantIds.length > 1500)
          throw new AppError(
            422,
            "VALIDATION_FAILED",
            "Satu kelas maksimal memiliki 1.500 peserta.",
          );
        await options.academics.replaceClassMembers(
          staffContext,
          idParam(params),
          participantIds,
        );
        return {
          items: await options.academics.listClassMemberProfiles(
            staffContext,
            idParam(params),
          ),
        };
      }),
  );
  app.get("/api/v1/admin/subjects", async ({ request, query }) =>
    wrapRead(request, options, "ADMIN", (staffContext) =>
      options.academics.listSubjects(staffContext, pageRequest(query)),
    ),
  );
  app.post("/api/v1/admin/subjects", async ({ request, body }) =>
    wrapMutation(request, options, "ADMIN", (staffContext) =>
      options.academics.createSubject(staffContext, body as never),
    ),
  );
  app.get("/api/v1/teacher/subjects", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const cursor = queryValue(query, "cursor");
      const conditions = ["s.status = 'ACTIVE'"];
      const parameters: unknown[] = [];
      if (identity.user.role !== "ADMIN") {
        conditions.push(
          "EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.subject_id = s.id)",
        );
        parameters.push(identity.user.id);
      }
      if (cursor && /^\d+$/u.test(cursor)) {
        conditions.push("s.id > ?");
        parameters.push(cursor);
      }
      parameters.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT s.id, s.code, s.name, s.status, s.updated_at
         FROM subjects s
         WHERE ${conditions.join(" AND ")}
         ORDER BY s.id ASC LIMIT ?`,
        parameters,
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          code: String(row.code),
          name: String(row.name),
          status: String(row.status),
          updatedAt: String(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get("/api/v1/teacher/classes", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const cursor = queryValue(query, "cursor");
      const conditions = ["c.status = 'ACTIVE'"];
      const parameters: unknown[] = [];
      if (identity.user.role !== "ADMIN") {
        conditions.push(
          "EXISTS (SELECT 1 FROM teacher_classes tc WHERE tc.teacher_id = ? AND tc.class_id = c.id)",
        );
        parameters.push(identity.user.id);
      }
      if (cursor && /^\d+$/u.test(cursor)) {
        conditions.push("c.id > ?");
        parameters.push(cursor);
      }
      parameters.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT c.id, c.academic_year_id, c.code, c.name, c.status, c.updated_at
         FROM classes c
         WHERE ${conditions.join(" AND ")}
         ORDER BY c.id ASC LIMIT ?`,
        parameters,
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          academicYearId: String(row.academic_year_id),
          code: String(row.code),
          name: String(row.name),
          status: String(row.status),
          updatedAt: String(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get("/api/v1/teacher/participants", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const cursor = queryValue(query, "cursor");
      const search = queryValue(query, "search") ?? queryValue(query, "q");
      const conditions = ["u.role = 'PARTICIPANT'", "u.status = 'ACTIVE'"];
      const parameters: unknown[] = [];
      if (identity.user.role !== "ADMIN") {
        conditions.push(
          "EXISTS (SELECT 1 FROM class_members scope_cm JOIN teacher_classes scope_tc ON scope_tc.class_id = scope_cm.class_id WHERE scope_cm.participant_id = u.id AND scope_cm.left_at IS NULL AND scope_tc.teacher_id = ?)",
        );
        parameters.push(identity.user.id);
      }
      if (search?.trim()) {
        conditions.push("(u.username LIKE ? OR u.display_name LIKE ?)");
        const term = `%${search.trim().slice(0, 100)}%`;
        parameters.push(term, term);
      }
      if (cursor && /^\d+$/u.test(cursor)) {
        conditions.push("u.id > ?");
        parameters.push(cursor);
      }
      parameters.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT u.id, u.username, u.display_name
         FROM users u
         WHERE ${conditions.join(" AND ")}
         ORDER BY u.display_name ASC, u.id ASC LIMIT ?`,
        parameters,
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          username: String(row.username),
          displayName: String(row.display_name),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get("/api/v1/teacher/scopes/:id", async ({ request, params }) =>
    wrapRead(request, options, "STAFF", async () => {
      const id = String((params as Record<string, unknown>).id ?? "");
      const actor = await requireStaff(request, options);
      const targetId = (id === "me" ? actor.user.id : id) as Id;
      if (
        !/^\d+$/u.test(targetId) ||
        (actor.user.role !== "ADMIN" && actor.user.id !== targetId)
      )
        throw new AppError(403, "FORBIDDEN", "Scope tidak tersedia.");
      const result = await options.academics.getTeacherScopes(
        {
          actor: {
            actorType: "HUMAN",
            role: actor.user.role as "ADMIN" | "TEACHER",
            userId: actor.user.id as Id,
            requestId:
              request.headers.get("x-request-id") ?? crypto.randomUUID(),
          },
        },
        targetId,
      );
      return result ?? { teacherId: targetId, subjectIds: [], classIds: [] };
    }),
  );
  app.put(
    "/api/v1/admin/teachers/:id/scopes",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "ADMIN", (staffContext) =>
        options.academics.replaceTeacherScopes(
          staffContext,
          idParam(params),
          body as never,
        ),
      ),
  );

  // Question authoring routes deliberately delegate validation, ownership,
  // optimistic concurrency, and publish invariants to the domain services.
  app.get("/api/v1/teacher/question-banks", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (actor) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const search =
        queryValue(query, "q") ?? queryValue(query, "search") ?? "";
      const scoped =
        actor.user.role === "ADMIN"
          ? "1 = 1"
          : "EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.subject_id = qb.subject_id)";
      const params: unknown[] =
        actor.user.role === "ADMIN" ? [] : [actor.user.id];
      if (search) {
        params.push(`%${search.slice(0, 100)}%`);
      }
      params.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT qb.id, qb.subject_id, qb.owner_teacher_id, qb.name, qb.status,
                qb.updated_at
         FROM question_banks qb
         WHERE ${scoped}${search ? " AND qb.name LIKE ?" : ""}
         ORDER BY qb.updated_at DESC, qb.id DESC LIMIT ?`,
        params,
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          subjectId: String(row.subject_id),
          ownerTeacherId: String(row.owner_teacher_id),
          name: String(row.name),
          status: String(row.status),
          updatedAt: String(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.post("/api/v1/teacher/question-banks", async ({ request, body }) =>
    wrapMutation(request, options, "TEACHER", async (staffContext) => {
      const payload = objectPayload(body);
      const subjectId = idValue(payload.subjectId, "subjectId");
      const name = stringField(payload.name, "name").trim();
      if (name.length > 200)
        throw new AppError(
          422,
          "VALIDATION_FAILED",
          "Nama bank terlalu panjang.",
        );
      const result = await options.database.transaction(async (connection) => {
        await connection.execute(
          "INSERT INTO question_banks (subject_id, owner_teacher_id, name, status) VALUES (?, ?, ?, 'ACTIVE')",
          [subjectId, staffContext.actor.userId, name],
        );
        const rows = await connection.query<Record<string, unknown>>(
          "SELECT id, subject_id, owner_teacher_id, name, status, updated_at FROM question_banks WHERE subject_id = ? AND owner_teacher_id = ? AND name = ? ORDER BY id DESC LIMIT 1",
          [subjectId, staffContext.actor.userId, name],
        );
        if (!rows[0]) throw new Error("Question bank could not be read back");
        return {
          id: String(rows[0].id),
          subjectId: String(rows[0].subject_id),
          ownerTeacherId: String(rows[0].owner_teacher_id),
          name: String(rows[0].name),
          status: String(rows[0].status),
          updatedAt: String(rows[0].updated_at),
        };
      });
      return result;
    }),
  );
  app.get(
    "/api/v1/teacher/question-revisions/:id",
    async ({ request, params }) =>
      wrapRead(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions) throw serviceUnavailable("Question service");
        const draft = await options.questions.drafts.getDraft(
          staffContext,
          idParam(params),
        );
        return mapQuestionDraft(draft);
      }),
  );
  app.post(
    "/api/v1/teacher/question-banks/:id/questions",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions) throw serviceUnavailable("Question service");
        const draft = await options.questions.drafts.createDraft(staffContext, {
          ...objectPayload(body),
          questionBankId: idParam(params),
        } as never);
        return mapQuestionDraft(draft);
      }),
  );
  app.post(
    "/api/v1/teacher/question-imports/preview",
    async ({ request, body }) =>
      wrapRead(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions)
          throw serviceUnavailable("Question import service");
        const payload = objectPayload(body);
        return options.questions.imports.preview(staffContext, {
          questionBankId: idValue(payload.questionBankId, "questionBankId"),
          csv: stringField(payload.csv, "csv"),
        });
      }),
  );
  app.post(
    "/api/v1/teacher/question-imports/commit",
    async ({ request, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions)
          throw serviceUnavailable("Question import service");
        const payload = objectPayload(body);
        return options.questions.imports.commit(staffContext, {
          questionBankId: idValue(payload.questionBankId, "questionBankId"),
          csv: stringField(payload.csv, "csv"),
          sourceHash: stringField(payload.sourceHash, "sourceHash"),
        });
      }),
  );
  app.patch(
    "/api/v1/teacher/question-revisions/:id",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions) throw serviceUnavailable("Question service");
        const payload = objectPayload(body);
        const expected = stringField(
          payload.expectedUpdatedAt,
          "expectedUpdatedAt",
        ) as UtcTimestamp;
        const { expectedUpdatedAt: _expected, ...content } = payload;
        const draft = await options.questions.drafts.updateDraft(
          staffContext,
          idParam(params),
          content as never,
          expected,
        );
        return mapQuestionDraft(draft);
      }),
  );
  app.delete(
    "/api/v1/teacher/schedules/:id",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.schedules) throw serviceUnavailable("Schedule service");
        const payload = objectPayload(body);
        const expectedUpdatedAt = stringField(
          payload.expectedUpdatedAt,
          "expectedUpdatedAt",
        ) as UtcTimestamp;
        await options.schedules.drafts.deleteSchedule(
          staffContext,
          idParam(params),
          expectedUpdatedAt,
        );
        return { scheduleId: String(idParam(params)), deleted: true };
      }),
  );
  app.post(
    "/api/v1/teacher/question-revisions/:id/validate",
    async ({ request, params }) =>
      wrapRead(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions) throw serviceUnavailable("Question service");
        const revisionId = idParam(params);
        await options.questions.drafts.getDraft(staffContext, revisionId);
        const report =
          await options.questions.readiness.validateRevision(revisionId);
        if (!report)
          throw new AppError(
            404,
            "NOT_FOUND",
            "Revision soal tidak ditemukan.",
          );
        return report;
      }),
  );
  app.post(
    "/api/v1/teacher/question-revisions/:id/publish",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.questions) throw serviceUnavailable("Question service");
        const payload = objectPayload(body);
        const draft = await options.questions.publish.publish(
          staffContext,
          idParam(params),
          stringField(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
        );
        return mapQuestionDraft(draft);
      }),
  );

  // Exam authoring mirrors the question routes and keeps all mutation rules in
  // ExamDraftService/ExamPublishService.
  app.get("/api/v1/teacher/exam-revisions/:id", async ({ request, params }) =>
    wrapRead(request, options, "TEACHER", async (staffContext) => {
      if (!options.exams) throw serviceUnavailable("Exam service");
      const revision = await options.exams.drafts.getRevision(
        staffContext,
        idParam(params),
      );
      return mapExamRevision(revision);
    }),
  );
  app.post("/api/v1/teacher/exams", async ({ request, body }) =>
    wrapMutation(request, options, "TEACHER", async (staffContext) => {
      if (!options.exams) throw serviceUnavailable("Exam service");
      const payload = objectPayload(body);
      const revision = await options.exams.drafts.createExam(staffContext, {
        ...payload,
        ownerTeacherId: staffContext.actor.userId as Id,
      } as never);
      return mapExamRevision(revision);
    }),
  );
  app.patch(
    "/api/v1/teacher/exam-revisions/:id",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const payload = objectPayload(body);
        const expected = stringField(
          payload.expectedUpdatedAt,
          "expectedUpdatedAt",
        ) as UtcTimestamp;
        const { expectedUpdatedAt: _expected, ...input } = payload;
        const revision = await options.exams.drafts.updateRevision(
          staffContext,
          idParam(params),
          input as never,
          expected,
        );
        return mapExamRevision(revision);
      }),
  );
  app.post(
    "/api/v1/teacher/exam-revisions/:id/questions",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const payload = objectPayload(body);
        const expected = stringField(
          payload.expectedUpdatedAt,
          "expectedUpdatedAt",
        ) as UtcTimestamp;
        const { expectedUpdatedAt: _expected, ...input } = payload;
        const revision = await options.exams.drafts.addQuestion(
          staffContext,
          idParam(params),
          input as never,
          expected,
        );
        return mapExamRevision(revision);
      }),
  );
  app.delete(
    "/api/v1/teacher/exam-revisions/:id/questions/:questionRevisionId",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const payload = objectPayload(body);
        const revision = await options.exams.drafts.removeQuestion(
          staffContext,
          idParam(params),
          idValue(
            (params as Record<string, unknown>).questionRevisionId,
            "questionRevisionId",
          ),
          stringField(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
        );
        return mapExamRevision(revision);
      }),
  );
  app.put(
    "/api/v1/teacher/exam-revisions/:id/questions/order",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const payload = objectPayload(body);
        const ids = Array.isArray(payload.questionRevisionIds)
          ? payload.questionRevisionIds.map((id) =>
              idValue(id, "questionRevisionId"),
            )
          : [];
        const revision = await options.exams.drafts.reorderQuestions(
          staffContext,
          idParam(params),
          ids,
          stringField(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
        );
        return mapExamRevision(revision);
      }),
  );
  app.post(
    "/api/v1/teacher/exam-revisions/:id/validate",
    async ({ request, params }) =>
      wrapRead(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const revision = await options.exams.drafts.getRevision(
          staffContext,
          idParam(params),
        );
        const report = await options.exams.readiness.validateRevision(
          revision.id,
        );
        if (!report)
          throw new AppError(
            404,
            "NOT_FOUND",
            "Revision ujian tidak ditemukan.",
          );
        return report;
      }),
  );
  app.post(
    "/api/v1/teacher/exam-revisions/:id/publish",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.exams) throw serviceUnavailable("Exam service");
        const revision = await options.exams.publish.publish(
          staffContext,
          idParam(params),
          stringField(
            objectPayload(body).expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
        );
        return mapExamRevision(revision);
      }),
  );

  // Schedule lifecycle and access-code mutations are exposed with the same
  // names used by the staff client. READY/OPEN are explicit administrative
  // transitions; the reconciler remains authoritative for automatic advance.
  app.get("/api/v1/teacher/schedules/:id", async ({ request, params }) =>
    wrapRead(request, options, "TEACHER", async (staffContext) => {
      if (!options.schedules) throw serviceUnavailable("Schedule service");
      const schedule = await options.schedules.drafts.getSchedule(
        staffContext,
        idParam(params),
      );
      if (!schedule)
        throw new AppError(404, "NOT_FOUND", "Jadwal tidak ditemukan.");
      return mapSchedule(schedule);
    }),
  );
  app.post("/api/v1/teacher/schedules", async ({ request, body }) =>
    wrapMutation(request, options, "TEACHER", async (staffContext) => {
      if (!options.schedules) throw serviceUnavailable("Schedule service");
      const schedule = await options.schedules.drafts.createSchedule(
        staffContext,
        normalizeScheduleInput(objectPayload(body)) as never,
      );
      return mapSchedule(schedule);
    }),
  );
  app.patch(
    "/api/v1/teacher/schedules/:id",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.schedules) throw serviceUnavailable("Schedule service");
        const payload = objectPayload(body);
        const expected = stringField(
          payload.expectedUpdatedAt,
          "expectedUpdatedAt",
        ) as UtcTimestamp;
        const { expectedUpdatedAt: _expected, ...input } = payload;
        const schedule = await options.schedules.drafts.updateSchedule(
          staffContext,
          idParam(params),
          normalizeScheduleInput(input) as never,
          expected,
        );
        return mapSchedule(schedule);
      }),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/rotate-token",
    async ({ request, params, body }) =>
      rotateScheduleCode(request, params, body, options, "PRACTICE_TOKEN"),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/rotate-main-code",
    async ({ request, params, body }) =>
      rotateScheduleCode(request, params, body, options, "MAIN_ACCESS_CODE"),
  );
  for (const [path, status] of [
    ["ready", "READY"],
    ["open", "OPEN"],
  ] as const) {
    app.post(
      `/api/v1/teacher/schedules/:id/${path}`,
      async ({ request, params, body }) =>
        wrapMutation(request, options, "TEACHER", async (staffContext) => {
          if (!options.schedules) throw serviceUnavailable("Schedule service");
          const payload = objectPayload(body);
          const schedule = await options.schedules.drafts.transitionSchedule(
            staffContext,
            idParam(params),
            status,
            stringField(
              payload.expectedUpdatedAt,
              "expectedUpdatedAt",
            ) as UtcTimestamp,
            new Date().toISOString() as UtcTimestamp,
          );
          return mapSchedule(schedule);
        }),
    );
  }
  app.post(
    "/api/v1/teacher/schedules/:id/close",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.schedules) throw serviceUnavailable("Schedule service");
        const payload = objectPayload(body);
        const schedule = await options.schedules.drafts.closeSchedule(
          staffContext,
          idParam(params),
          stringField(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
          stringField(payload.closeReason ?? payload.reason, "closeReason"),
          new Date().toISOString() as UtcTimestamp,
        );
        return mapSchedule(schedule);
      }),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/archive",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.schedules) throw serviceUnavailable("Schedule service");
        const payload = objectPayload(body);
        const schedule = await options.schedules.drafts.archiveSchedule(
          staffContext,
          idParam(params),
          stringField(
            payload.expectedUpdatedAt,
            "expectedUpdatedAt",
          ) as UtcTimestamp,
        );
        return mapSchedule(schedule);
      }),
  );

  // Read-only staff list endpoints keep the UI useful while richer authoring
  // mutations are added through their domain-specific route adapters.
  app.get("/api/v1/teacher/questions", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (actor) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const search = queryValue(query, "search") ?? "";
      const scoped =
        actor.user.role === "ADMIN"
          ? "1 = 1"
          : "EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.subject_id = qb.subject_id)";
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT qr.id, qr.question_id, qb.id AS bank_id, qb.name AS bank_name, qb.subject_id, qr.type, qr.status, LEFT(qr.stimulus_html, 180) AS label, qr.updated_at FROM question_revisions qr JOIN questions q ON q.id = qr.question_id JOIN question_banks qb ON qb.id = q.question_bank_id WHERE ${scoped} AND (? = '' OR qb.name LIKE ? OR qr.stimulus_html LIKE ?) ORDER BY qr.updated_at DESC, qr.id DESC LIMIT ?`,
        [
          ...(actor.user.role === "ADMIN" ? [] : [actor.user.id]),
          search,
          `%${search}%`,
          `%${search}%`,
          limit + 1,
        ],
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          questionId: String(row.question_id),
          bankId: String(row.bank_id),
          bankName: String(row.bank_name),
          subjectId: String(row.subject_id),
          type: String(row.type),
          status: String(row.status),
          label: String(row.label ?? ""),
          updatedAt: String(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get("/api/v1/teacher/exams", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (actor) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const scoped =
        actor.user.role === "ADMIN"
          ? "1 = 1"
          : "EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.subject_id = e.subject_id)";
      const search = queryValue(query, "search") ?? "";
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT e.id, er.id AS revision_id, er.title, er.duration_seconds, e.subject_id, e.owner_teacher_id, e.status, COUNT(eq.id) AS question_count, e.updated_at FROM exams e JOIN exam_revisions er ON er.id = COALESCE(e.current_published_revision_id, (SELECT er2.id FROM exam_revisions er2 WHERE er2.exam_id = e.id ORDER BY er2.revision_no DESC LIMIT 1)) LEFT JOIN exam_questions eq ON eq.exam_revision_id = er.id WHERE ${scoped} AND (? = '' OR er.title LIKE ?) GROUP BY e.id, er.id ORDER BY e.updated_at DESC, e.id DESC LIMIT ?`,
        [
          ...(actor.user.role === "ADMIN" ? [] : [actor.user.id]),
          search,
          `%${search}%`,
          limit + 1,
        ],
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          revisionId: String(row.revision_id),
          title: String(row.title),
          durationSeconds: Number(row.duration_seconds),
          subjectId: String(row.subject_id),
          ownerTeacherId: String(row.owner_teacher_id),
          status: String(row.status),
          questionCount: Number(row.question_count),
          updatedAt: String(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get("/api/v1/teacher/schedules", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (actor) => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const status = scheduleStatusFilter(queryValue(query, "status"));
      const includeArchived = optionalBooleanQuery(
        queryValue(query, "includeArchived"),
        "includeArchived",
      );
      const scoped =
        actor.user.role === "ADMIN"
          ? "1 = 1"
          : "EXISTS (SELECT 1 FROM teacher_subjects ts WHERE ts.teacher_id = ? AND ts.subject_id = e.subject_id) AND NOT EXISTS (SELECT 1 FROM exam_schedule_classes esc LEFT JOIN teacher_classes tc ON tc.class_id = esc.class_id AND tc.teacher_id = ? WHERE esc.schedule_id = s.id AND tc.teacher_id IS NULL)";
      const visibility = status
        ? " AND s.status = ?"
        : includeArchived
          ? ""
          : " AND s.status <> 'ARCHIVED'";
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT s.id, er.title, s.mode, s.status,
                DATE_FORMAT(s.starts_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS starts_at,
                DATE_FORMAT(s.ends_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS ends_at,
                s.duration_seconds, s.max_attempts,
                (s.practice_token_hint IS NOT NULL OR s.main_access_code_hint IS NOT NULL) AS has_access_code,
                COALESCE(s.practice_token_hint, s.main_access_code_hint) AS access_hint,
                DATE_FORMAT(s.updated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at
         FROM exam_schedules s
         JOIN exam_revisions er ON er.id = s.exam_revision_id
         JOIN exams e ON e.id = er.exam_id
         WHERE ${scoped}${visibility}
         ORDER BY s.starts_at DESC, s.id DESC LIMIT ?`,
        [
          ...(actor.user.role === "ADMIN"
            ? []
            : [actor.user.id, actor.user.id]),
          ...(status ? [status] : []),
          limit + 1,
        ],
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          title: String(row.title),
          mode: String(row.mode),
          status: String(row.status),
          // Bun.SQL returns DATETIME columns as Date objects.  Do not expose
          // Date#toString() here: the client sends updatedAt back as the
          // optimistic-lock token for lifecycle transitions, and the
          // schedule service accepts canonical UTC timestamps only.
          startsAt: isoValue(row.starts_at),
          endsAt: isoValue(row.ends_at),
          durationSeconds: Number(row.duration_seconds),
          maxAttempts: Number(row.max_attempts),
          hasAccessCode: Boolean(row.has_access_code),
          accessHint: row.access_hint === null ? null : String(row.access_hint),
          updatedAt: isoValue(row.updated_at),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  app.get(
    "/api/v1/teacher/schedules/:id/monitor",
    async ({ request, params, query }) =>
      wrapSqlRead(request, options, "TEACHER", async (identity) => {
        const scheduleId = idParam(params);
        await assertStaffScheduleAccess(
          options.database,
          identity,
          scheduleId,
          options.teacherScopeLookup,
        );
        return readScheduleMonitor(
          options.database,
          scheduleId,
          queryValue(query, "cursor"),
          queryValue(query, "search"),
        );
      }),
  );
  app.get(
    "/api/v1/teacher/schedules/:id/sessions",
    async ({ request, params, query }) =>
      wrapSqlRead(request, options, "TEACHER", async (identity) => {
        const scheduleId = idParam(params);
        await assertStaffScheduleAccess(
          options.database,
          identity,
          scheduleId,
          options.teacherScopeLookup,
        );
        const monitor = await readScheduleMonitor(
          options.database,
          scheduleId,
          queryValue(query, "cursor"),
          queryValue(query, "search"),
        );
        return monitor.sessions;
      }),
  );
  app.get("/api/v1/teacher/exam-sessions/:id", async ({ request, params }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const sessionId = idParam(params);
      const session = await readStaffSession(options.database, sessionId);
      if (!session)
        throw new AppError(404, "NOT_FOUND", "Sesi tidak ditemukan.");
      await assertStaffScheduleAccess(
        options.database,
        identity,
        session.scheduleId,
        options.teacherScopeLookup,
      );
      return session;
    }),
  );
  app.post(
    "/api/v1/teacher/exam-sessions/:id/extend-time",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.runtime)
          throw serviceUnavailable("Runtime session service");
        const payload = objectPayload(body);
        const sessionId = idParam(params);
        const session = await readStaffSession(options.database, sessionId);
        if (!session)
          throw new AppError(404, "NOT_FOUND", "Sesi tidak ditemukan.");
        await assertStaffScheduleAccess(
          options.database,
          {
            user: staffContext.actor.userId
              ? {
                  id: String(staffContext.actor.userId),
                  role:
                    staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
                }
              : null,
          },
          session.scheduleId,
          options.teacherScopeLookup,
        );
        const result = await options.runtime.administration.extendTime(
          staffContext,
          {
            sessionId,
            additionalMinutes: integerField(
              payload.minutes ?? payload.additionalMinutes,
              "minutes",
            ),
            reason: stringField(payload.reason, "reason"),
            expectedVersion: integerField(
              payload.expectedVersion ?? payload.version,
              "expectedVersion",
            ),
          },
        );
        return mapRuntimeSession(result);
      }),
  );
  app.post(
    "/api/v1/teacher/exam-sessions/:id/end",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        if (!options.runtime)
          throw serviceUnavailable("Runtime session service");
        const payload = objectPayload(body);
        const sessionId = idParam(params);
        const session = await readStaffSession(options.database, sessionId);
        if (!session)
          throw new AppError(404, "NOT_FOUND", "Sesi tidak ditemukan.");
        await assertStaffScheduleAccess(
          options.database,
          {
            user: staffContext.actor.userId
              ? {
                  id: String(staffContext.actor.userId),
                  role:
                    staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
                }
              : null,
          },
          session.scheduleId,
          options.teacherScopeLookup,
        );
        const expectedVersion =
          payload.expectedVersion === undefined
            ? undefined
            : integerField(payload.expectedVersion, "expectedVersion");
        const result = await options.runtime.administration.endSession(
          staffContext,
          {
            sessionId,
            reason: stringField(payload.reason, "reason"),
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
          },
        );
        return mapRuntimeSession(result.session);
      }),
  );
  app.post(
    "/api/v1/admin/exam-sessions/:id/reset-attempt",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "ADMIN", async (staffContext) => {
        if (!options.runtime)
          throw serviceUnavailable("Runtime session service");
        const payload = objectPayload(body);
        const sessionId = idParam(params);
        const session = await readStaffSession(options.database, sessionId);
        if (!session?.participantId)
          throw new AppError(
            404,
            "NOT_FOUND",
            "Attempt peserta tidak ditemukan.",
          );
        const grant = await options.runtime.administration.resetAttempt(
          staffContext,
          {
            scheduleId: session.scheduleId,
            participantId: session.participantId,
            reason: stringField(payload.reason, "reason"),
            resetIdempotencyKey: request.headers.get("idempotency-key") ?? "",
          },
        );
        return {
          id: String(grant.sourceSessionId),
          status: "ENDED",
          finalizationReason: "RESET_ATTEMPT",
          grantId: String(grant.id),
          grantedAttemptNo: grant.grantedAttemptNo,
        };
      }),
  );
  app.get(
    "/api/v1/teacher/schedules/:id/results",
    async ({ request, params, query }) =>
      wrapSqlRead(request, options, "TEACHER", async (identity) => {
        const scheduleId = idParam(params);
        await assertStaffScheduleAccess(
          options.database,
          identity,
          scheduleId,
          options.teacherScopeLookup,
        );
        return readScheduleResults(
          options.database,
          scheduleId,
          queryValue(query, "cursor"),
          queryValue(query, "filter"),
        );
      }),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/release-results",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        const scheduleId = idParam(params);
        const identity = {
          user: {
            id: String(staffContext.actor.userId),
            role: staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
          },
        };
        await assertStaffScheduleAccess(
          options.database,
          identity,
          scheduleId,
          options.teacherScopeLookup,
        );
        return updateResultRelease(options.database, scheduleId, body, true);
      }),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/unrelease-results",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        const scheduleId = idParam(params);
        const identity = {
          user: {
            id: String(staffContext.actor.userId),
            role: staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
          },
        };
        await assertStaffScheduleAccess(
          options.database,
          identity,
          scheduleId,
          options.teacherScopeLookup,
        );
        const payload = objectPayload(body);
        return updateResultRelease(
          options.database,
          scheduleId,
          payload,
          false,
        );
      }),
  );
  app.get("/api/v1/teacher/exports", async ({ request, query }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const scheduleId = optionalId(queryValue(query, "scheduleId"));
      const cursor = optionalId(queryValue(query, "cursor"));
      return exports.listJobs(identity.user.id as Id, {
        ...(scheduleId ? { scheduleId } : {}),
        limit: boundedLimit(queryValue(query, "limit")),
        ...(cursor ? { cursor } : {}),
      });
    }),
  );
  app.post(
    "/api/v1/teacher/schedules/:id/exports",
    async ({ request, params, body }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        const scheduleId = idParam(params);
        await assertStaffScheduleAccess(
          options.database,
          {
            user: {
              id: String(staffContext.actor.userId),
              role: staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
            },
          },
          scheduleId,
          options.teacherScopeLookup,
        );
        const payload = objectPayload(body);
        const format = oneOf(
          payload.format ?? "CSV",
          ["CSV", "JSON"] as const,
          "format",
        );
        const includePii = payload.includePii === true;
        const requesterUserId = staffContext.actor.userId;
        if (!requesterUserId)
          throw new AppError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Identitas staff tidak dapat diverifikasi.",
          );
        return exports.createJob({
          requesterUserId,
          scheduleId,
          format,
          includePii,
        });
      }),
  );
  app.get("/api/v1/teacher/exports/:id", async ({ request, params }) =>
    wrapSqlRead(request, options, "TEACHER", async (identity) => {
      const job = await exports.getJob(idParam(params));
      if (!job) throw new AppError(404, "NOT_FOUND", "Export tidak ditemukan.");
      await assertStaffScheduleAccess(
        options.database,
        identity,
        job.scheduleId,
        options.teacherScopeLookup,
      );
      if (
        identity.user.role !== "ADMIN" &&
        job.requesterUserId !== identity.user.id
      )
        throw new AppError(403, "FORBIDDEN", "Export di luar scope Anda.");
      return exportJobView(job);
    }),
  );
  app.post(
    "/api/v1/teacher/exports/:id/download-token",
    async ({ request, params }) =>
      wrapMutation(request, options, "TEACHER", async (staffContext) => {
        const job = await exports.getJob(idParam(params));
        if (!job)
          throw new AppError(404, "NOT_FOUND", "Export tidak ditemukan.");
        await assertStaffScheduleAccess(
          options.database,
          {
            user: {
              id: String(staffContext.actor.userId),
              role: staffContext.actor.role === "ADMIN" ? "ADMIN" : "TEACHER",
            },
          },
          job.scheduleId,
          options.teacherScopeLookup,
        );
        if (
          staffContext.actor.role !== "ADMIN" &&
          job.requesterUserId !== staffContext.actor.userId
        )
          throw new AppError(403, "FORBIDDEN", "Export di luar scope Anda.");
        return exports.issueDownloadToken(job.id);
      }),
  );
  app.get(
    "/api/v1/teacher/exports/:id/download",
    async ({ request, params, query, set }) => {
      try {
        const identity = await requireStaff(request, options, "TEACHER");
        const job = await exports.getJob(idParam(params));
        if (!job)
          throw new AppError(404, "NOT_FOUND", "Export tidak ditemukan.");
        await assertStaffScheduleAccess(
          options.database,
          identity,
          job.scheduleId,
          options.teacherScopeLookup,
        );
        if (
          identity.user.role !== "ADMIN" &&
          job.requesterUserId !== identity.user.id
        )
          throw new AppError(403, "FORBIDDEN", "Export di luar scope Anda.");
        const token = queryValue(query, "token");
        if (!token)
          throw new AppError(
            401,
            "AUTHENTICATION_REQUIRED",
            "Token download diperlukan.",
          );
        const download = await exports.consumeDownload(job.id, token);
        set.headers["content-type"] =
          download.format === "JSON"
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8";
        set.headers["content-disposition"] =
          `attachment; filename="gezycbt-export-${download.jobId}.${download.format.toLowerCase()}"`;
        return download.body;
      } catch (error) {
        throw mapStaffError(error);
      }
    },
  );
  app.get("/api/v1/admin/audit-logs", async ({ request, query }) =>
    wrapSqlRead(request, options, "ADMIN", async () => {
      const limit = boundedLimit(queryValue(query, "limit"));
      const search = queryValue(query, "search")?.trim().slice(0, 100) ?? "";
      const parameters: unknown[] = [];
      const searchClause = search
        ? "WHERE action LIKE ? OR entity_type LIKE ? OR request_id LIKE ?"
        : "";
      if (search) parameters.push(`%${search}%`, `%${search}%`, `%${search}%`);
      parameters.push(limit + 1);
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT id, action, entity_type, entity_id, actor_type, actor_user_id, request_id, created_at, JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.outcome')) AS outcome FROM audit_logs ${searchClause} ORDER BY created_at DESC, id DESC LIMIT ?`,
        parameters,
      );
      return page(
        rows.slice(0, limit).map((row) => ({
          id: String(row.id),
          action: String(row.action),
          outcome: row.outcome === "FAILURE" ? "FAILURE" : "SUCCESS",
          actorLabel:
            `${String(row.actor_type)} ${row.actor_user_id ? String(row.actor_user_id) : ""}`.trim(),
          entityType: String(row.entity_type),
          entityId: row.entity_id === null ? null : String(row.entity_id),
          createdAt: String(row.created_at),
          requestId: String(row.request_id),
        })),
        rows.length > limit ? String(rows[limit]?.id) : null,
      );
    }),
  );
  return app;
}

async function requireStaff(
  request: Request,
  options: StaffRouteOptions,
  required?: "ADMIN" | "TEACHER" | "STAFF",
) {
  const token = readAuthCookie(request.headers.get("cookie"));
  const session = token ? await options.sessionService.resolve(token) : null;
  if (!session)
    throw new AppError(
      401,
      "AUTH_SESSION_EXPIRED",
      "Sesi login telah berakhir.",
    );
  const user = await options.users.findById(session.userId);
  if (
    user?.status !== "ACTIVE" ||
    (required === "ADMIN" && user?.role !== "ADMIN") ||
    (required === "TEACHER" &&
      user?.role !== "ADMIN" &&
      user?.role !== "TEACHER")
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki akses ke resource ini.",
    );
  return { user: mapUser(user), session };
}

type StaffIdentity = Awaited<ReturnType<typeof requireStaff>>;

function actorContext(
  request: Request,
  identity: StaffIdentity,
  idempotencyKey?: string | null,
): UseCaseContext {
  return {
    actor: {
      actorType: "HUMAN",
      role:
        identity.user.role === "PARTICIPANT"
          ? "PARTICIPANT"
          : identity.user.role,
      userId: identity.user.id as Id,
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      active: identity.user.status === "ACTIVE",
    },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

async function requireCsrf(
  request: Request,
  session: Awaited<ReturnType<StaffRouteOptions["sessionService"]["resolve"]>>,
  options: StaffRouteOptions,
): Promise<void> {
  try {
    await assertCsrfRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      expectedOrigin: options.expectedOrigin,
      csrfToken: request.headers.get(CSRF_HEADER_NAME),
      session,
      verifyCsrfSecret: (id, token) =>
        options.sessionService.verifyCsrfSecret(id, token),
      requireSession: true,
    });
  } catch (error) {
    if (error instanceof CsrfProtectionError)
      throw new AppError(
        error.status,
        error.status === 401 ? "AUTHENTICATION_REQUIRED" : "CSRF_INVALID",
        "Permintaan tidak dapat diverifikasi.",
        { reason: error.reason },
      );
    throw error;
  }
}

async function wrapRead<T>(
  request: Request,
  options: StaffRouteOptions,
  required: "ADMIN" | "TEACHER" | "STAFF",
  operation: (context: UseCaseContext) => Promise<T>,
): Promise<{ data: T }> {
  try {
    const identity = await requireStaff(request, options, required);
    return { data: await operation(actorContext(request, identity)) };
  } catch (error) {
    throw mapStaffError(error);
  }
}
async function wrapMutation<T>(
  request: Request,
  options: StaffRouteOptions,
  required: "ADMIN" | "TEACHER" | "STAFF",
  operation: (context: UseCaseContext) => Promise<T>,
): Promise<{ data: T }> {
  try {
    const actor = await requireStaff(request, options, required);
    await requireCsrf(request, actor.session, options);
    const key = request.headers.get("idempotency-key");
    if (!key)
      throw new AppError(
        422,
        "VALIDATION_FAILED",
        "Idempotency-Key wajib diisi.",
      );
    return {
      data: await operation(
        actorContext(request, actor, request.headers.get("idempotency-key")),
      ),
    };
  } catch (error) {
    throw mapStaffError(error);
  }
}
async function wrapSqlRead<T>(
  request: Request,
  options: StaffRouteOptions,
  required: "ADMIN" | "TEACHER" | "STAFF",
  operation: (identity: StaffIdentity) => Promise<T>,
): Promise<{ data: T }> {
  const identity = await requireStaff(request, options, required);
  return { data: await operation(identity) };
}
function page<T>(
  items: readonly T[],
  nextCursor: string | null,
): { items: readonly T[]; nextCursor: string | null } {
  return { items, nextCursor };
}
function pageRequest(query: unknown): { cursor?: string; limit?: number } {
  const candidate = query as Record<string, unknown>;
  const cursor = optionalString(candidate.cursor);
  const limitValue = optionalString(candidate.limit);
  return {
    ...(cursor ? { cursor } : {}),
    ...(limitValue ? { limit: boundedLimit(limitValue) } : {}),
  };
}
function integerField(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return parsed;
}
function boundedLimit(value: string | undefined): number {
  const parsed = value ? Number(value) : 25;
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
}
function optionalPage(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000)
    throw new AppError(422, "VALIDATION_FAILED", "page tidak valid.");
  return parsed;
}
function queryValue(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
function optionalBooleanQuery(
  value: string | undefined,
  field: string,
): boolean {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
}
function scheduleStatusFilter(
  value: string | undefined,
): "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED" | undefined {
  if (value === undefined) return undefined;
  if (
    value === "DRAFT" ||
    value === "READY" ||
    value === "OPEN" ||
    value === "CLOSED" ||
    value === "ARCHIVED"
  )
    return value;
  throw new AppError(422, "VALIDATION_FAILED", "status jadwal tidak valid.");
}
function objectPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(422, "VALIDATION_FAILED", "Format request tidak valid.");
  return value as Record<string, unknown>;
}
function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new AppError(422, "VALIDATION_FAILED", `${field} wajib diisi.`);
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
function optionalId(value: string | undefined): Id | undefined {
  return value && /^\d+$/u.test(value) ? (value as Id) : undefined;
}
function idParam(params: unknown): Id {
  const value = String((params as Record<string, unknown>).id ?? "");
  if (!/^\d+$/u.test(value))
    throw new AppError(422, "VALIDATION_FAILED", "ID tidak valid.");
  return value as Id;
}
function idValue(value: unknown, field: string): Id {
  if (typeof value !== "string" || !/^\d+$/u.test(value))
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value as Id;
}
function serviceUnavailable(name: string): AppError {
  return new AppError(503, "SERVICE_BUSY", `${name} belum tersedia.`);
}
function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new AppError(422, "VALIDATION_FAILED", `${field} tidak valid.`);
  return value as T;
}

type StaffScheduleIdentity = {
  readonly user: { readonly id: string; readonly role: string } | null;
};

async function assertStaffScheduleAccess(
  database: DatabasePort,
  identity: StaffScheduleIdentity,
  scheduleId: Id,
  teacherScopeLookup?: StaffRouteOptions["teacherScopeLookup"],
): Promise<void> {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT e.owner_teacher_id, e.subject_id
     FROM exam_schedules s
     JOIN exam_revisions er ON er.id = s.exam_revision_id
     JOIN exams e ON e.id = er.exam_id
     WHERE s.id = ? LIMIT 1`,
    [scheduleId],
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Jadwal tidak ditemukan.");
  if (identity.user?.role === "ADMIN") return;
  const teacherId = identity.user?.id;
  if (!teacherId)
    throw new AppError(
      401,
      "AUTHENTICATION_REQUIRED",
      "Sesi login diperlukan.",
    );
  // Unit-only route tests may not provide the lookup adapter. Runtime always
  // supplies it, so production reads enforce assigned subject/class scope.
  if (!teacherScopeLookup) {
    if (String(row.owner_teacher_id) === teacherId) return;
    throw new AppError(403, "FORBIDDEN", "Jadwal di luar scope Anda.");
  }
  const scope = await teacherScopeLookup(teacherId as Id);
  const subjectId = String(row.subject_id) as Id;
  if (!scope?.subjectIds.includes(subjectId))
    throw new AppError(403, "FORBIDDEN", "Jadwal di luar scope Anda.");
  const classRows = await database.query<Record<string, unknown>>(
    "SELECT class_id FROM exam_schedule_classes WHERE schedule_id = ?",
    [scheduleId],
  );
  if (
    classRows.some(
      (classRow) => !scope.classIds.includes(String(classRow.class_id) as Id),
    )
  )
    throw new AppError(403, "FORBIDDEN", "Jadwal di luar scope Anda.");
}

async function readScheduleMonitor(
  database: DatabasePort,
  scheduleId: Id,
  cursor?: string,
  search?: string,
): Promise<{
  readonly counts: {
    readonly target: number;
    readonly notStarted: number;
    readonly active: number;
    readonly submitted: number;
    readonly expired: number;
  };
  readonly generatedAt: string;
  readonly serverNow: string;
  readonly sessions: {
    readonly items: readonly ReturnType<typeof mapMonitorSession>[];
    readonly nextCursor: string | null;
  };
}> {
  const targetRows = await database.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS total FROM (
       SELECT participant_id FROM exam_schedule_participants WHERE schedule_id = ?
       UNION
       SELECT cm.participant_id
       FROM exam_schedule_classes sc
       JOIN class_members cm ON cm.class_id = sc.class_id AND cm.left_at IS NULL
       WHERE sc.schedule_id = ?
     ) targets`,
    [scheduleId, scheduleId],
  );
  const countRows = await database.query<Record<string, unknown>>(
    `SELECT
       SUM(status = 'ACTIVE') AS active_count,
       SUM(status IN ('SUBMITTED', 'SCORED')) AS submitted_count,
       SUM(status = 'EXPIRED') AS expired_count,
       COUNT(DISTINCT participant_id) AS started_count
     FROM exam_sessions WHERE schedule_id = ?`,
    [scheduleId],
  );
  const target = Number(targetRows[0]?.total ?? 0);
  const started = Number(countRows[0]?.started_count ?? 0);
  // Monitoring is the one staff list with a larger page to reduce polling
  // round-trips for schedules with hundreds of participants.
  const limit = 50;
  const params: unknown[] = [scheduleId];
  const conditions = ["s.schedule_id = ?"];
  if (cursor && /^\d+$/u.test(cursor)) {
    conditions.push("s.id > ?");
    params.push(cursor);
  }
  const normalizedSearch = search?.trim().slice(0, 100) ?? "";
  if (normalizedSearch) {
    conditions.push(
      "(s.participant_name_snapshot LIKE ? OR u.username LIKE ?)",
    );
    params.push(`%${normalizedSearch}%`, `%${normalizedSearch}%`);
  }
  params.push(limit + 1);
  const rows = await database.query<Record<string, unknown>>(
    `SELECT s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
            s.participant_name_snapshot, s.deadline_at, s.last_seen_at, s.version,
            s.finalization_reason,
            COUNT(DISTINCT esq.id) AS question_count,
            COUNT(DISTINCT a.session_question_id) AS answered_count,
            u.username
     FROM exam_sessions s
     LEFT JOIN users u ON u.id = s.participant_id
     LEFT JOIN exam_session_questions esq ON esq.session_id = s.id
     LEFT JOIN answers a ON a.session_id = s.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
              s.participant_name_snapshot, s.deadline_at, s.last_seen_at,
              s.version, s.finalization_reason, u.username
     ORDER BY s.id ASC LIMIT ?`,
    params,
  );
  return {
    counts: {
      target,
      notStarted: Math.max(0, target - started),
      active: Number(countRows[0]?.active_count ?? 0),
      submitted: Number(countRows[0]?.submitted_count ?? 0),
      expired: Number(countRows[0]?.expired_count ?? 0),
    },
    generatedAt: new Date().toISOString(),
    serverNow: new Date().toISOString(),
    sessions: page(
      rows.slice(0, limit).map(mapMonitorSession),
      rows.length > limit ? String(rows[limit]?.id) : null,
    ),
  };
}

function mapMonitorSession(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    scheduleId: String(row.schedule_id) as Id,
    participantName: String(row.participant_name_snapshot),
    username:
      row.username === null || row.username === undefined
        ? null
        : String(row.username),
    attemptNo: Number(row.attempt_no),
    status: String(row.status),
    answeredCount: Number(row.answered_count ?? 0),
    questionCount: Number(row.question_count ?? 0),
    deadlineAt: isoValue(row.deadline_at),
    lastSeenAt: isoValue(row.last_seen_at),
    version: Number(row.version ?? 1),
    finalizationReason:
      row.finalization_reason === null || row.finalization_reason === undefined
        ? null
        : String(row.finalization_reason),
  };
}

async function readStaffSession(
  database: DatabasePort,
  sessionId: Id,
): Promise<
  | (ReturnType<typeof mapMonitorSession> & {
      readonly participantId: Id | null;
    })
  | null
> {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
            s.participant_name_snapshot, s.deadline_at, s.last_seen_at, s.version,
            s.finalization_reason,
            COUNT(DISTINCT esq.id) AS question_count,
            COUNT(DISTINCT a.session_question_id) AS answered_count,
            u.username
     FROM exam_sessions s
     LEFT JOIN users u ON u.id = s.participant_id
     LEFT JOIN exam_session_questions esq ON esq.session_id = s.id
     LEFT JOIN answers a ON a.session_id = s.id
     WHERE s.id = ?
     GROUP BY s.id, s.schedule_id, s.participant_id, s.attempt_no, s.status,
              s.participant_name_snapshot, s.deadline_at, s.last_seen_at,
              s.version, s.finalization_reason, u.username`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...mapMonitorSession(row),
    participantId:
      row.participant_id === null || row.participant_id === undefined
        ? null
        : (String(row.participant_id) as Id),
  };
}

async function readScheduleResults(
  database: DatabasePort,
  scheduleId: Id,
  cursor?: string,
  filter?: string,
): Promise<{
  readonly items: readonly Record<string, unknown>[];
  readonly nextCursor: string | null;
}> {
  const params: unknown[] = [scheduleId];
  const conditions = ["r.schedule_id = ?"];
  if (filter === "RELEASED") conditions.push("r.released_at IS NOT NULL");
  if (filter === "UNRELEASED") conditions.push("r.released_at IS NULL");
  if (cursor && /^\d+$/u.test(cursor)) {
    conditions.push("r.id > ?");
    params.push(cursor);
  }
  const limit = 50;
  params.push(limit + 1);
  const rows = await database.query<Record<string, unknown>>(
    `SELECT r.id, r.session_id, r.participant_id, r.correct_count,
            r.incorrect_count, r.unanswered_count, r.earned_score, r.max_score,
            r.percentage, r.released_at, r.scored_at,
            s.participant_name_snapshot, u.username
     FROM exam_results r
     JOIN exam_sessions s ON s.id = r.session_id
     LEFT JOIN users u ON u.id = r.participant_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.id ASC LIMIT ?`,
    params,
  );
  return {
    items: rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      participantName: String(row.participant_name_snapshot),
      username:
        row.username === null || row.username === undefined
          ? null
          : String(row.username),
      status: "SCORED",
      correctCount: Number(row.correct_count),
      incorrectCount: Number(row.incorrect_count),
      unansweredCount: Number(row.unanswered_count),
      earnedScore: String(row.earned_score),
      maxScore: String(row.max_score),
      percentage: String(row.percentage),
      releasedAt:
        row.released_at === null || row.released_at === undefined
          ? null
          : isoValue(row.released_at),
      scoredAt: isoValue(row.scored_at),
    })),
    nextCursor: rows.length > limit ? String(rows[limit]?.id) : null,
  };
}

async function updateResultRelease(
  database: DatabasePort,
  scheduleId: Id,
  body: unknown,
  release: boolean,
): Promise<{
  readonly released: number;
  readonly skipped: number;
  readonly failed: number;
}> {
  const payload = objectPayload(body);
  const ids = Array.isArray(payload.ids)
    ? payload.ids.map((value) => idValue(value, "resultId"))
    : [];
  if (ids.length > 500)
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Maksimal 500 hasil per operasi.",
    );
  const allFiltered = payload.allFiltered === true;
  const filter = oneOf(
    payload.filter ?? "ALL",
    ["ALL", "RELEASED", "UNRELEASED"] as const,
    "filter",
  );
  return database.transaction(async (connection) => {
    const conditions = ["schedule_id = ?"];
    const parameters: unknown[] = [scheduleId];
    if (allFiltered && filter === "RELEASED")
      conditions.push("released_at IS NOT NULL");
    if (allFiltered && filter === "UNRELEASED")
      conditions.push("released_at IS NULL");
    if (!allFiltered) {
      if (!ids.length)
        throw new AppError(
          422,
          "VALIDATION_FAILED",
          "Pilih minimal satu hasil.",
        );
      conditions.push(`id IN (${ids.map(() => "?").join(",")})`);
      parameters.push(...ids);
    }
    const rows = await connection.query<Record<string, unknown>>(
      `SELECT id, released_at FROM exam_results WHERE ${conditions.join(" AND ")} FOR UPDATE`,
      parameters,
    );
    const changed = rows.filter((row) =>
      release ? row.released_at === null : row.released_at !== null,
    );
    if (changed.length) {
      const changedIds = changed.map((row) => row.id);
      await connection.execute(
        `UPDATE exam_results SET released_at = ${release ? "UTC_TIMESTAMP(6)" : "NULL"} WHERE schedule_id = ? AND id IN (${changedIds.map(() => "?").join(",")})`,
        [scheduleId, ...changedIds],
      );
    }
    return {
      released: changed.length,
      skipped: rows.length - changed.length,
      failed: 0,
    };
  });
}

function isoValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  // DATE_FORMAT(... %fZ) preserves MariaDB's microsecond precision. Keep it
  // intact so optimistic-lock tokens round-trip exactly to the database.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/u.test(normalized))
    return normalized;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function mapRuntimeSession(session: {
  readonly id: Id;
  readonly status: string;
  readonly deadlineAt?: string;
  readonly finalizationReason?: string | null;
  readonly version?: number;
}) {
  return {
    id: String(session.id),
    status: session.status,
    ...(session.deadlineAt ? { deadlineAt: session.deadlineAt } : {}),
    finalizationReason: session.finalizationReason ?? null,
    ...(session.version === undefined ? {} : { version: session.version }),
  };
}

function mapQuestionDraft(draft: {
  readonly id: Id;
  readonly questionId: Id;
  readonly questionBank: {
    readonly id: Id;
    readonly subjectId: Id;
    readonly ownerTeacherId: Id;
    readonly name: string;
    readonly status: string;
  };
  readonly questionStatus: string;
  readonly revisionNo: number;
  readonly type: string;
  readonly status: string;
  readonly stimulusHtml: string;
  readonly promptHtml: string | null;
  readonly explanationHtml: string | null;
  readonly options: readonly {
    readonly id?: Id;
    readonly position: number;
    readonly contentHtml: string;
    readonly isCorrect: boolean;
  }[];
  readonly statements: readonly {
    readonly id?: Id;
    readonly position: number;
    readonly statementHtml: string;
    readonly correctValue: boolean;
  }[];
  readonly contentHash: Uint8Array;
  readonly publishedAt: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}) {
  return {
    id: String(draft.id),
    questionId: String(draft.questionId),
    questionBank: {
      id: String(draft.questionBank.id),
      subjectId: String(draft.questionBank.subjectId),
      ownerTeacherId: String(draft.questionBank.ownerTeacherId),
      name: draft.questionBank.name,
      status: draft.questionBank.status,
    },
    questionStatus: draft.questionStatus,
    revisionNo: draft.revisionNo,
    type: draft.type,
    status: draft.status,
    stimulusHtml: draft.stimulusHtml,
    promptHtml: draft.promptHtml,
    explanationHtml: draft.explanationHtml,
    options: draft.options.map((option) => ({
      ...(option.id ? { id: String(option.id) } : {}),
      position: option.position,
      contentHtml: option.contentHtml,
      isCorrect: option.isCorrect,
    })),
    statements: draft.statements.map((statement) => ({
      ...(statement.id ? { id: String(statement.id) } : {}),
      position: statement.position,
      statementHtml: statement.statementHtml,
      correctValue: statement.correctValue,
    })),
    contentHash: Buffer.from(draft.contentHash).toString("hex"),
    publishedAt: draft.publishedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

function mapExamRevision(revision: {
  readonly id: Id;
  readonly examId: Id;
  readonly title: string;
  readonly instructionsHtml: string;
  readonly durationSeconds: number;
  readonly shuffleQuestions: boolean;
  readonly shuffleOptions: boolean;
  readonly status: string;
  readonly updatedAt: unknown;
  readonly questions: readonly {
    readonly questionRevisionId: Id;
    readonly position: number;
    readonly points: string;
  }[];
}) {
  return {
    id: String(revision.id),
    examId: String(revision.examId),
    title: revision.title,
    instructionsHtml: revision.instructionsHtml,
    durationSeconds: revision.durationSeconds,
    shuffleQuestions: revision.shuffleQuestions,
    shuffleOptions: revision.shuffleOptions,
    status: revision.status,
    updatedAt: revision.updatedAt,
    questions: revision.questions.map((question) => ({
      questionRevisionId: String(question.questionRevisionId),
      position: question.position,
      points: question.points,
    })),
  };
}

function mapSchedule(schedule: {
  readonly id: Id;
  readonly examRevisionId: Id;
  readonly mode: string;
  readonly status: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly durationSeconds: number;
  readonly maxAttempts: number;
  readonly hardEnd: true;
  readonly allowLateStart: boolean;
  readonly resultReleasePolicy: string;
  readonly hasPracticeToken: boolean;
  readonly practiceTokenHint: string | null;
  readonly hasMainAccessCode: boolean;
  readonly mainAccessCodeHint: string | null;
  readonly identityFields: unknown;
  readonly targetClassIds: readonly Id[];
  readonly targetParticipantIds: readonly Id[];
  readonly closedAt: unknown;
  readonly closedByUserId: unknown;
  readonly closeReason: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}) {
  return {
    id: String(schedule.id),
    examRevisionId: String(schedule.examRevisionId),
    mode: schedule.mode,
    status: schedule.status,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    durationSeconds: schedule.durationSeconds,
    maxAttempts: schedule.maxAttempts,
    hardEnd: true,
    allowLateStart: schedule.allowLateStart,
    resultReleasePolicy: schedule.resultReleasePolicy,
    hasPracticeToken: schedule.hasPracticeToken,
    practiceTokenHint: schedule.practiceTokenHint,
    hasMainAccessCode: schedule.hasMainAccessCode,
    mainAccessCodeHint: schedule.mainAccessCodeHint,
    identityFields: schedule.identityFields,
    targetClassIds: schedule.targetClassIds.map(String),
    targetParticipantIds: schedule.targetParticipantIds.map(String),
    closedAt: schedule.closedAt,
    closedByUserId: schedule.closedByUserId,
    closeReason: schedule.closeReason,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
}

function normalizeScheduleInput(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const identityFields = payload.identityFields;
  return {
    ...payload,
    hardEnd: true,
    ...(Array.isArray(identityFields)
      ? { identityFieldsJson: JSON.stringify(identityFields) }
      : {}),
  };
}

async function rotateScheduleCode(
  request: Request,
  params: unknown,
  body: unknown,
  options: StaffRouteOptions,
  kind: "PRACTICE_TOKEN" | "MAIN_ACCESS_CODE",
): Promise<{ data: unknown }> {
  return wrapMutation(request, options, "TEACHER", async (staffContext) => {
    if (!options.schedules) throw serviceUnavailable("Schedule service");
    const payload = objectPayload(body);
    const result =
      kind === "PRACTICE_TOKEN"
        ? await options.schedules.accessCodes.rotatePracticeToken(
            staffContext,
            idParam(params),
            stringField(
              payload.expectedUpdatedAt,
              "expectedUpdatedAt",
            ) as UtcTimestamp,
            optionalString(payload.proposedCode),
          )
        : await options.schedules.accessCodes.rotateMainAccessCode(
            staffContext,
            idParam(params),
            stringField(
              payload.expectedUpdatedAt,
              "expectedUpdatedAt",
            ) as UtcTimestamp,
            optionalString(payload.proposedCode),
          );
    return result;
  });
}
function mapUser(user: StoredUser | Record<string, unknown>): {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly status: "ACTIVE" | "DISABLED";
  readonly forcePasswordChange: boolean;
  readonly lastLoginAt: unknown;
  readonly updatedAt: string;
} {
  const value = user as Record<string, unknown>;
  return {
    id: String(value.id),
    username: String(value.username),
    displayName: String(value.displayName ?? value.display_name),
    role: String(value.role) as UserRole,
    status: String(value.status) as "ACTIVE" | "DISABLED",
    forcePasswordChange: Boolean(
      value.forcePasswordChange ?? value.force_password_change,
    ),
    lastLoginAt: value.lastLoginAt ?? value.last_login_at ?? null,
    updatedAt: String(value.updatedAt ?? value.updated_at ?? ""),
  } as const;
}
function mapStaffError(error: unknown): Error {
  if (error instanceof AppError) return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      readonly status?: unknown;
      readonly code?: unknown;
      readonly message?: unknown;
      readonly details?: unknown;
    };
    const status = candidate.status;
    if (
      (status === 401 ||
        status === 404 ||
        status === 409 ||
        status === 422 ||
        status === 429 ||
        status === 503) &&
      typeof candidate.code === "string"
    )
      return new AppError(
        status,
        candidate.code,
        typeof candidate.message === "string"
          ? candidate.message
          : "Permintaan tidak dapat diproses.",
        candidate.details && typeof candidate.details === "object"
          ? (candidate.details as never)
          : {},
      );
  }
  const name = error instanceof Error ? error.name : "";
  if (/Conflict|VersionConflict|Duplicate/u.test(name))
    return new AppError(
      409,
      "VERSION_CONFLICT",
      "Perubahan bertabrakan dengan data terbaru.",
    );
  if (/NotFound/u.test(name))
    return new AppError(404, "NOT_FOUND", "Resource tidak ditemukan.");
  if (/Reauthentication/u.test(name))
    return new AppError(
      401,
      "REAUTH_REQUIRED",
      "Masuk ulang diperlukan untuk operasi ini.",
    );
  if (error instanceof ExportNotFoundError)
    return new AppError(404, "NOT_FOUND", "Export tidak ditemukan.");
  if (error instanceof ExportActiveError)
    return new AppError(
      409,
      "EXPORT_ACTIVE",
      "Masih ada export aktif untuk requester ini.",
    );
  if (error instanceof ExportNotReadyError)
    return new AppError(409, "EXPORT_NOT_READY", "Export belum siap diunduh.");
  if (error instanceof ExportDownloadTokenError)
    return new AppError(
      409,
      "DOWNLOAD_TOKEN_INVALID",
      "Token download tidak valid atau sudah digunakan.",
    );
  if (error instanceof ExportValidationError)
    return new AppError(422, "VALIDATION_FAILED", error.message);
  if (error instanceof QuestionImportValidationError)
    return new AppError(422, "VALIDATION_FAILED", error.message);
  if (error instanceof DiskProtectionError)
    return new AppError(
      503,
      "DISK_PRESSURE",
      "Penyimpanan server hampir penuh. Upload/export ditunda.",
      { retryAfterSeconds: 300 },
    );
  if (/Import|Credential/u.test(name))
    return new AppError(
      422,
      "VALIDATION_FAILED",
      "Data import tidak dapat diproses.",
    );
  if (/Validation|Immutable|Transition/u.test(name))
    return new AppError(422, "VALIDATION_FAILED", "Data tidak dapat diproses.");
  return error instanceof Error ? error : new Error("Staff request failed");
}
