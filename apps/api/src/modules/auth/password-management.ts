import type { Id } from "@gezycbt/contracts";
import {
  type ActorContext,
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import {
  AuthorizationDeniedError,
  AuthorizationRequiredError,
} from "../../application/authorization";
import {
  type StoredUser,
  toUserView,
  type UserRepository,
  UserValidationError,
} from "../users";
import { PasswordBusyError, type PasswordService } from "./password";
import type { AuthSessionCredentials, AuthSessionService } from "./session";

export interface PasswordManagementRepository
  extends Pick<UserRepository, "findById" | "updatePassword"> {}

export interface PasswordManagementSessionService
  extends Pick<AuthSessionService, "create" | "revokeUserSessions"> {}

export interface PasswordAuditEvent {
  readonly action: "PASSWORD_CHANGED" | "PASSWORD_RESET";
  readonly actorUserId: Id;
  readonly targetUserId: Id;
  readonly revokedSessionCount: number;
  readonly requestId: string;
}

export interface PasswordAuditPort {
  record(event: PasswordAuditEvent): Promise<void>;
}

export interface ChangeOwnPasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface ResetPasswordInput {
  readonly adminCurrentPassword: string;
  readonly newPassword: string;
}

export interface PasswordMutationResult {
  readonly user: ReturnType<typeof toUserView>;
  readonly revokedSessionCount: number;
  /** A replacement session is issued only for the self-change flow. */
  readonly session?: AuthSessionCredentials;
}

export class CurrentPasswordInvalidError extends Error {
  constructor() {
    super("Password saat ini salah.");
    this.name = "CurrentPasswordInvalidError";
  }
}

export class PasswordTargetNotFoundError extends Error {
  constructor() {
    super("Akun target tidak ditemukan.");
    this.name = "PasswordTargetNotFoundError";
  }
}

export class PasswordManagementService {
  constructor(
    private readonly repository: PasswordManagementRepository,
    private readonly passwords: Pick<PasswordService, "hash" | "verify">,
    private readonly sessions: PasswordManagementSessionService,
    private readonly audit: PasswordAuditPort = {
      async record() {},
    },
  ) {}

  async changeOwnPassword(
    context: UseCaseContext,
    input: ChangeOwnPasswordInput,
  ): Promise<PasswordMutationResult> {
    assertMutationContext(context);
    assertPasswordMutationInput(input);
    const actor = requireActiveHuman(context.actor);
    const user = await this.repository.findById(actor.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AuthorizationRequiredError();
    }
    await verifyCurrentPassword(this.passwords, input.currentPassword, user);
    const passwordHash = await this.passwords.hash(
      input.newPassword,
      user.role,
      user.usernameNormalized,
    );
    const updated = await this.repository.updatePassword(
      user.id,
      passwordHash,
      false,
      user.updatedAt,
    );
    if (!updated) throw new PasswordTargetNotFoundError();
    const revokedSessionCount = await this.sessions.revokeUserSessions(
      user.id,
      "PASSWORD_CHANGED",
    );
    const session = await this.sessions.create(updated.id, updated.role);
    await this.audit.record({
      action: "PASSWORD_CHANGED",
      actorUserId: user.id,
      targetUserId: user.id,
      revokedSessionCount,
      requestId: context.actor.requestId,
    });
    return {
      user: toUserView(updated),
      revokedSessionCount,
      session,
    };
  }

  async resetPassword(
    context: UseCaseContext,
    targetUserId: Id,
    input: ResetPasswordInput,
  ): Promise<PasswordMutationResult> {
    assertMutationContext(context);
    assertPasswordMutationInput(input);
    const admin = requireActiveHuman(context.actor);
    if (admin.role !== "ADMIN") {
      throw new AuthorizationDeniedError("ADMIN_ONLY");
    }
    const adminUser = await this.repository.findById(admin.userId);
    if (!adminUser || adminUser.status !== "ACTIVE") {
      throw new AuthorizationRequiredError();
    }
    await verifyCurrentPassword(
      this.passwords,
      input.adminCurrentPassword,
      adminUser,
    );
    const target = await this.repository.findById(targetUserId);
    if (!target || target.status !== "ACTIVE") {
      throw new PasswordTargetNotFoundError();
    }
    const passwordHash = await this.passwords.hash(
      input.newPassword,
      target.role,
      target.usernameNormalized,
    );
    const updated = await this.repository.updatePassword(
      target.id,
      passwordHash,
      true,
      target.updatedAt,
    );
    if (!updated) throw new PasswordTargetNotFoundError();
    const revokedSessionCount = await this.sessions.revokeUserSessions(
      target.id,
      "PASSWORD_RESET",
    );
    await this.audit.record({
      action: "PASSWORD_RESET",
      actorUserId: admin.userId,
      targetUserId: target.id,
      revokedSessionCount,
      requestId: context.actor.requestId,
    });
    return { user: toUserView(updated), revokedSessionCount };
  }
}

function requireActiveHuman(actor: ActorContext): ActorContext & {
  readonly userId: Id;
  readonly role: StoredUser["role"];
} {
  assertActorContext(actor);
  if (
    actor.actorType !== "HUMAN" ||
    !actor.userId ||
    !actor.role ||
    !["ADMIN", "TEACHER", "PARTICIPANT"].includes(actor.role) ||
    actor.active === false
  ) {
    throw new AuthorizationRequiredError();
  }
  return actor as ActorContext & {
    readonly userId: Id;
    readonly role: StoredUser["role"];
  };
}

async function verifyCurrentPassword(
  passwords: Pick<PasswordService, "verify">,
  currentPassword: string,
  user: StoredUser,
): Promise<void> {
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    throw new CurrentPasswordInvalidError();
  }
  let matches = false;
  try {
    matches = await passwords.verify(currentPassword, user.passwordHash);
  } catch (error) {
    if (error instanceof PasswordBusyError) throw error;
  }
  if (!matches) throw new CurrentPasswordInvalidError();
}

export function assertPasswordMutationInput(
  input: ChangeOwnPasswordInput | ResetPasswordInput,
): void {
  if (typeof input.newPassword !== "string") {
    throw new UserValidationError("New password must be a string");
  }
}
