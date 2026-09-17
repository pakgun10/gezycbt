import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import {
  AuthorizationDeniedError,
  AuthorizationRequiredError,
} from "../../application/authorization";
import type { StoredUser } from "../users";
import {
  CurrentPasswordInvalidError,
  type PasswordAuditEvent,
  type PasswordManagementRepository,
  PasswordManagementService,
} from "./password-management";
import type { AuthSessionCredentials, AuthSessionService } from "./session";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$hash";
const admin = makeUser("1", "ADMIN", "admin");
const teacher = makeUser("2", "TEACHER", "teacher");
const participant = makeUser("3", "PARTICIPANT", "student");

function context(user: StoredUser): UseCaseContext {
  return {
    actor: {
      actorType: "HUMAN",
      userId: user.id,
      role: user.role,
      requestId: "request-123",
    },
    idempotencyKey: "password-change-1234",
  };
}

function makeUser(
  id: string,
  role: StoredUser["role"],
  username: string,
): StoredUser {
  return {
    id: id as Id,
    username,
    usernameNormalized: username,
    passwordHash: HASH,
    role,
    status: "ACTIVE",
    displayName: username,
    forcePasswordChange: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeRepository implements PasswordManagementRepository {
  constructor(
    public users = new Map<Id, StoredUser>([
      [admin.id, admin],
      [teacher.id, teacher],
      [participant.id, participant],
    ]),
  ) {}

  async findById(id: Id): Promise<StoredUser | null> {
    return this.users.get(id) ?? null;
  }

  async updatePassword(
    id: Id,
    passwordHash: string,
    forcePasswordChange: boolean,
  ): Promise<StoredUser | null> {
    const current = this.users.get(id);
    if (!current) return null;
    const updated = {
      ...current,
      passwordHash,
      forcePasswordChange,
      passwordChangedAt: NOW,
      updatedAt: "2026-09-17T00:01:00.000Z" as UtcTimestamp,
    };
    this.users.set(id, updated);
    return updated;
  }
}

class FakePasswords {
  hashes: Array<{ password: string; role: StoredUser["role"] }> = [];

  async verify(password: string): Promise<boolean> {
    return password === "current-password" || password === "admin-current";
  }

  async hash(password: string, role: StoredUser["role"]): Promise<string> {
    this.hashes.push({ password, role });
    return `${HASH}-${this.hashes.length}`;
  }
}

class FakeSessions
  implements Pick<AuthSessionService, "create" | "revokeUserSessions">
{
  revoked: Array<{ userId: Id; reason: string }> = [];
  created = 0;

  async revokeUserSessions(userId: Id, reason?: string): Promise<number> {
    this.revoked.push({ userId, reason: reason ?? "" });
    return 2;
  }

  async create(
    userId: Id,
    role: StoredUser["role"],
  ): Promise<AuthSessionCredentials> {
    this.created += 1;
    return {
      token: "a".repeat(43),
      csrfSecret: "b".repeat(43),
      cookie: "__Host-gezycbt-auth=opaque",
      session: {
        id: "99" as Id,
        userId,
        role,
        createdAt: NOW,
        lastSeenAt: NOW,
        idleExpiresAt: NOW,
        absoluteExpiresAt: NOW,
        revokedAt: null,
        revokeReason: null,
      },
    };
  }
}

class FakeAudit {
  readonly events: PasswordAuditEvent[] = [];

  async record(event: PasswordAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function makeService(
  repository = new FakeRepository(),
  passwords = new FakePasswords(),
  sessions = new FakeSessions(),
) {
  const audit = new FakeAudit();
  return {
    service: new PasswordManagementService(
      repository,
      passwords,
      sessions,
      audit,
    ),
    repository,
    passwords,
    sessions,
    audit,
  };
}

describe("PasswordManagementService", () => {
  test("self change reauthenticates, updates hash, revokes all sessions, and issues replacement session", async () => {
    const setup = makeService();
    const result = await setup.service.changeOwnPassword(context(teacher), {
      currentPassword: "current-password",
      newPassword: "new-valid-password",
    });
    expect(result.user.id).toBe(teacher.id);
    expect(result.session?.cookie).toContain("__Host-gezycbt-auth=");
    expect(result.revokedSessionCount).toBe(2);
    expect(setup.sessions.revoked).toEqual([
      { userId: teacher.id, reason: "PASSWORD_CHANGED" },
    ]);
    expect(setup.sessions.created).toBe(1);
    expect(setup.passwords.hashes[0]).toEqual({
      password: "new-valid-password",
      role: "TEACHER",
    });
    expect(setup.audit.events[0]).toMatchObject({
      action: "PASSWORD_CHANGED",
      actorUserId: teacher.id,
      targetUserId: teacher.id,
      revokedSessionCount: 2,
    });
  });

  test("self change rejects a wrong current password without changing state", async () => {
    const setup = makeService();
    await expect(
      setup.service.changeOwnPassword(context(participant), {
        currentPassword: "wrong",
        newPassword: "new-valid-password",
      }),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    expect(setup.passwords.hashes).toHaveLength(0);
    expect(setup.sessions.revoked).toHaveLength(0);
  });

  test("only admin can reset another account and reset forces first change", async () => {
    const setup = makeService();
    const result = await setup.service.resetPassword(
      context(admin),
      teacher.id,
      {
        adminCurrentPassword: "admin-current",
        newPassword: "temporary-password",
      },
    );
    expect(result.user.forcePasswordChange).toBe(true);
    expect(result.session).toBeUndefined();
    expect(result.revokedSessionCount).toBe(2);
    expect(setup.sessions.revoked).toEqual([
      { userId: teacher.id, reason: "PASSWORD_RESET" },
    ]);
    expect(setup.audit.events[0]).toMatchObject({
      action: "PASSWORD_RESET",
      actorUserId: admin.id,
      targetUserId: teacher.id,
      revokedSessionCount: 2,
    });
    await expect(
      setup.service.resetPassword(context(teacher), participant.id, {
        adminCurrentPassword: "current-password",
        newPassword: "temporary-password",
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  test("unknown target and inactive actor do not mutate password", async () => {
    const setup = makeService();
    await expect(
      setup.service.resetPassword(context(admin), "404" as Id, {
        adminCurrentPassword: "admin-current",
        newPassword: "temporary-password",
      }),
    ).rejects.toThrow("Akun target tidak ditemukan");
    await expect(
      setup.service.changeOwnPassword(
        {
          ...context(participant),
          actor: { ...context(participant).actor, active: false },
        },
        {
          currentPassword: "current-password",
          newPassword: "new-valid-password",
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationRequiredError);
  });
});
