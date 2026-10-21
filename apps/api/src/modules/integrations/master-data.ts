import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  ActorContext,
  UseCaseContext,
} from "../../application/actor-context";
import type {
  CreateAcademicYearInput,
  CreateClassInput,
  CreateSubjectInput,
  ScopeInput,
  UpdateClassInput,
  UpdateSubjectInput,
} from "../academics/domain";
import type { AcademicMasterService } from "../academics/service";
import type { PasswordService } from "../auth/password";
import type { AuthSessionService } from "../auth/session";
import { toUserView, type UserRole } from "../users/domain";
import type { UserRepository } from "../users/repository";
import {
  type IntegrationAuthentication,
  IntegrationNotFoundError,
  IntegrationScopeError,
  IntegrationValidationError,
} from "./domain";
import type { IntegrationService } from "./service";

export interface IntegrationMasterDataOptions {
  readonly integration: IntegrationService;
  readonly users: Pick<
    UserRepository,
    "findById" | "create" | "update" | "disable" | "updatePassword"
  >;
  readonly academics: Pick<
    AcademicMasterService,
    | "createAcademicYear"
    | "createClass"
    | "updateClass"
    | "replaceClassMembers"
    | "createSubject"
    | "updateSubject"
    | "getTeacherScopes"
    | "replaceTeacherScopes"
  >;
  readonly passwords: Pick<PasswordService, "hash">;
  readonly sessions: Pick<AuthSessionService, "revokeUserSessions">;
}

export class IntegrationMasterDataService {
  constructor(private readonly options: IntegrationMasterDataOptions) {}

  async createAcademicYear(
    authentication: IntegrationAuthentication,
    input: CreateAcademicYearInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "academic_years.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(
      authentication,
      grant,
      {},
    );
    const result = await this.options.academics.createAcademicYear(
      this.context(authentication, requestId, _idempotencyKey),
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_ACADEMIC_YEAR_CREATE",
      result.id,
      requestId,
      { startsOn: result.startsOn, endsOn: result.endsOn },
    );
    return result;
  }

  async createUser(
    authentication: IntegrationAuthentication,
    input: {
      readonly username: string;
      readonly displayName: string;
      readonly role: UserRole;
      readonly password: string;
      readonly forcePasswordChange?: boolean;
    },
    requestId: string,
    idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "users.create",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(
      authentication,
      grant,
      {},
    );
    const passwordHash = await this.options.passwords.hash(
      input.password,
      input.role,
      input.username.trim().toLowerCase(),
    );
    const user = await this.options.users.create({
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      passwordHash,
      forcePasswordChange: input.forcePasswordChange ?? true,
    });
    await this.audit(
      authentication,
      "INTEGRATION_USER_CREATE",
      user.id,
      requestId,
      {
        role: user.role,
        idempotencyKey,
      },
    );
    return toUserView(user);
  }

  async updateUser(
    authentication: IntegrationAuthentication,
    userId: Id,
    input: {
      readonly displayName?: string;
      readonly role?: UserRole;
      readonly status?: "ACTIVE" | "DISABLED";
      readonly forcePasswordChange?: boolean;
    },
    expectedUpdatedAt: UtcTimestamp | undefined,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "users.update",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      resourceId: userId,
    });
    if (
      userId === authentication.client.ownerUserId &&
      (input.status === "DISABLED" ||
        (input.role !== undefined &&
          input.role !== authentication.client.ownerRole))
    )
      throw new IntegrationValidationError(
        "Integration client owner cannot disable or change its own role",
      );
    const user = await this.options.users.update(
      userId,
      input,
      expectedUpdatedAt,
    );
    if (!user) throw new IntegrationNotFoundError("User was not found");
    if (input.status === "DISABLED")
      await this.options.sessions.revokeUserSessions(userId, "USER_DISABLED");
    await this.audit(
      authentication,
      "INTEGRATION_USER_UPDATE",
      user.id,
      requestId,
      {
        status: user.status,
      },
    );
    return toUserView(user);
  }

  async disableUser(
    authentication: IntegrationAuthentication,
    userId: Id,
    expectedUpdatedAt: UtcTimestamp | undefined,
    requestId: string,
    idempotencyKey: string,
  ) {
    return this.updateUser(
      authentication,
      userId,
      { status: "DISABLED" },
      expectedUpdatedAt,
      requestId,
      idempotencyKey,
    );
  }

  async resetPassword(
    authentication: IntegrationAuthentication,
    userId: Id,
    input: { readonly newPassword: string },
    expectedUpdatedAt: UtcTimestamp | undefined,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "users.reset_password",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      resourceId: userId,
    });
    if (userId === authentication.client.ownerUserId)
      throw new IntegrationValidationError(
        "Gunakan penggantian password akun sendiri",
      );
    const target = await this.options.users.findById(userId);
    if (!target || target.status !== "ACTIVE")
      throw new IntegrationNotFoundError("User was not found");
    const passwordHash = await this.options.passwords.hash(
      input.newPassword,
      target.role,
      target.usernameNormalized,
    );
    const user = await this.options.users.updatePassword(
      userId,
      passwordHash,
      true,
      expectedUpdatedAt,
    );
    if (!user) throw new IntegrationNotFoundError("User was not found");
    const revokedSessionCount = await this.options.sessions.revokeUserSessions(
      userId,
      "PASSWORD_RESET",
    );
    await this.audit(
      authentication,
      "INTEGRATION_USER_PASSWORD_RESET",
      user.id,
      requestId,
      {
        revokedSessionCount,
      },
    );
    return { user: toUserView(user), revokedSessionCount };
  }

  async createClass(
    authentication: IntegrationAuthentication,
    input: CreateClassInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "classes.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      resourceId: input.academicYearId,
    });
    const result = await this.options.academics.createClass(
      this.context(authentication, requestId, _idempotencyKey),
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_CLASS_CREATE",
      result.id,
      requestId,
    );
    return result;
  }

  async updateClass(
    authentication: IntegrationAuthentication,
    classId: Id,
    input: UpdateClassInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "classes.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      classId,
    });
    const result = await this.options.academics.updateClass(
      this.context(authentication, requestId, _idempotencyKey),
      classId,
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_CLASS_UPDATE",
      result.id,
      requestId,
    );
    return result;
  }

  async replaceClassMembers(
    authentication: IntegrationAuthentication,
    classId: Id,
    participantIds: readonly Id[],
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "classes.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      classId,
    });
    const result = await this.options.academics.replaceClassMembers(
      this.context(authentication, requestId, _idempotencyKey),
      classId,
      participantIds,
    );
    await this.audit(
      authentication,
      "INTEGRATION_CLASS_MEMBERS_REPLACE",
      classId,
      requestId,
      {
        count: result.length,
      },
    );
    return result;
  }

  async createSubject(
    authentication: IntegrationAuthentication,
    input: CreateSubjectInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "subjects.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(
      authentication,
      grant,
      {},
    );
    const result = await this.options.academics.createSubject(
      this.context(authentication, requestId, _idempotencyKey),
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_SUBJECT_CREATE",
      result.id,
      requestId,
    );
    return result;
  }

  async updateSubject(
    authentication: IntegrationAuthentication,
    subjectId: Id,
    input: UpdateSubjectInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "subjects.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      subjectId,
    });
    const result = await this.options.academics.updateSubject(
      this.context(authentication, requestId, _idempotencyKey),
      subjectId,
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_SUBJECT_UPDATE",
      result.id,
      requestId,
    );
    return result;
  }

  async getTeacherScopes(
    authentication: IntegrationAuthentication,
    teacherId: Id,
    requestId: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "teacher_scopes.read",
      requestId,
    );
    this.assertTeacherTarget(authentication, teacherId);
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: teacherId,
    });
    const result = await this.options.academics.getTeacherScopes(
      this.context(authentication, requestId),
      teacherId,
    );
    if (!result) throw new IntegrationNotFoundError("Teacher was not found");
    return result;
  }

  async replaceTeacherScopes(
    authentication: IntegrationAuthentication,
    teacherId: Id,
    input: ScopeInput,
    requestId: string,
    _idempotencyKey: string,
  ) {
    const grant = await this.options.integration.assertCapability(
      authentication,
      "teacher_scopes.write",
      requestId,
    );
    this.requireAdmin(authentication);
    await this.options.integration.assertResourceScope(authentication, grant, {
      ownerUserId: teacherId,
    });
    const result = await this.options.academics.replaceTeacherScopes(
      this.context(authentication, requestId, _idempotencyKey),
      teacherId,
      input,
    );
    await this.audit(
      authentication,
      "INTEGRATION_TEACHER_SCOPES_REPLACE",
      teacherId,
      requestId,
    );
    return result;
  }

  private context(
    authentication: IntegrationAuthentication,
    requestId: string,
    idempotencyKey?: string,
  ): UseCaseContext {
    const actor: ActorContext = {
      actorType: "EXTERNAL_AGENT",
      userId: authentication.client.ownerUserId,
      role: authentication.client.ownerRole,
      active: true,
      integrationClientId: authentication.client.id,
      requestId,
    };
    return idempotencyKey ? { actor, idempotencyKey } : { actor };
  }

  private requireAdmin(authentication?: IntegrationAuthentication): void {
    if (authentication && authentication.client.ownerRole !== "ADMIN")
      throw new IntegrationScopeError();
  }

  private assertTeacherTarget(
    authentication: IntegrationAuthentication,
    teacherId: Id,
  ): void {
    if (
      authentication.client.ownerRole === "TEACHER" &&
      authentication.client.ownerUserId !== teacherId
    )
      throw new IntegrationScopeError();
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: string,
    entityId: Id,
    requestId: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "integration_resource",
      entityId,
      requestId,
      outcome: "SUCCESS",
      ...(metadata ? { metadata } : {}),
    });
  }
}
