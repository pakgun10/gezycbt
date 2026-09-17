import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { StoredUser, UserRepository } from "../users";
import {
  AuthLoginService,
  InMemoryLoginFailureLimiter,
  InvalidLoginError,
  LoginRateLimitedError,
} from "./login";
import type { AuthSession, AuthSessionCredentials } from "./session";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const HASH = "$argon2id$v=19$m=19456,t=2,p=1$hash";

describe("AuthLoginService", () => {
  test("staff login accepts admin/teacher but never participant", async () => {
    const users = new FakeUsers([
      user("admin", "ADMIN"),
      user("teacher", "TEACHER"),
      user("student", "PARTICIPANT"),
    ]);
    const passwords = new FakePasswords();
    const service = makeService(users, passwords);

    expect(
      (await service.loginStaff({ username: "ADMIN", password: "password" }))
        .user.role,
    ).toBe("ADMIN");
    expect(
      (await service.loginStaff({ username: "teacher", password: "password" }))
        .user.role,
    ).toBe("TEACHER");
    await expect(
      service.loginStaff({ username: "student", password: "password" }),
    ).rejects.toBeInstanceOf(InvalidLoginError);
    expect(passwords.dummyCalls).toBe(1);
  });

  test("participant login only accepts active participant accounts", async () => {
    const users = new FakeUsers([
      user("student", "PARTICIPANT"),
      user("teacher", "TEACHER"),
    ]);
    const passwords = new FakePasswords();
    const service = makeService(users, passwords);

    expect(
      (
        await service.loginParticipant({
          username: "student",
          password: "password",
        })
      ).user.role,
    ).toBe("PARTICIPANT");
    await expect(
      service.loginParticipant({ username: "teacher", password: "password" }),
    ).rejects.toBeInstanceOf(InvalidLoginError);
    expect(passwords.dummyCalls).toBe(1);
  });

  test("unknown, disabled, and wrong-audience accounts use the same generic failure", async () => {
    const users = new FakeUsers([
      user("disabled", "ADMIN", "DISABLED"),
      user("teacher", "TEACHER"),
    ]);
    const passwords = new FakePasswords();
    const service = makeService(users, passwords);

    for (const username of ["missing", "disabled", "teacher"]) {
      await expect(
        service.loginParticipant({ username, password: "password" }),
      ).rejects.toThrow("Username atau password salah");
    }
    expect(passwords.dummyCalls).toBe(3);
  });

  test("checks limiter before expensive verification and returns retry metadata", async () => {
    let now = 0;
    const limiter = new InMemoryLoginFailureLimiter({
      accountLimit: 2,
      ipLimit: 100,
      windowMs: 60_000,
      clock: () => now,
    });
    const passwords = new FakePasswords();
    const service = makeService(
      new FakeUsers([user("student", "PARTICIPANT")]),
      passwords,
      limiter,
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        service.loginParticipant({ username: "student", password: "wrong" }),
      ).rejects.toBeInstanceOf(InvalidLoginError);
    }
    await expect(
      service.loginParticipant({ username: "student", password: "wrong" }),
    ).rejects.toBeInstanceOf(LoginRateLimitedError);
    expect(passwords.verifyCalls).toBe(2);
    now = 60_001;
    await expect(
      service.loginParticipant({ username: "student", password: "password" }),
    ).resolves.toBeDefined();
  });

  test("successful login creates a server session and clears account failures", async () => {
    const limiter = new InMemoryLoginFailureLimiter({ accountLimit: 2 });
    const users = new FakeUsers([user("student", "PARTICIPANT")]);
    const passwords = new FakePasswords();
    const sessions = new FakeSessions();
    const service = makeService(users, passwords, limiter, sessions);

    await expect(
      service.loginParticipant({ username: "student", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidLoginError);
    const result = await service.loginParticipant({
      username: "student",
      password: "password",
    });
    expect(result.session.cookie).toContain("__Host-gezycbt-auth=");
    expect(sessions.created).toBe(1);
    await expect(
      service.loginParticipant({ username: "student", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidLoginError);
  });
});

function makeService(
  users: FakeUsers,
  passwords: FakePasswords,
  limiter = new InMemoryLoginFailureLimiter(),
  sessions = new FakeSessions(),
) {
  return new AuthLoginService({
    users,
    passwords,
    limiter,
    sessions,
  });
}

function user(
  username: string,
  role: StoredUser["role"],
  status: StoredUser["status"] = "ACTIVE",
): StoredUser {
  return {
    id: `${username.length + 1}` as Id,
    username,
    usernameNormalized: username,
    passwordHash: HASH,
    role,
    status,
    displayName: username,
    forcePasswordChange: false,
    passwordChangedAt: NOW,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeUsers implements Pick<UserRepository, "findByUsernameNormalized"> {
  constructor(private readonly users: readonly StoredUser[]) {}

  async findByUsernameNormalized(username: string): Promise<StoredUser | null> {
    return (
      this.users.find((user) => user.usernameNormalized === username) ?? null
    );
  }
}

class FakePasswords {
  verifyCalls = 0;
  dummyCalls = 0;

  async verify(_password: string, _hash: string): Promise<boolean> {
    this.verifyCalls += 1;
    return _password === "password";
  }

  async verifyDummy(_password: string): Promise<boolean> {
    this.dummyCalls += 1;
    return false;
  }
}

class FakeSessions {
  created = 0;

  async create(
    userId: Id,
    role: StoredUser["role"],
  ): Promise<AuthSessionCredentials> {
    this.created += 1;
    const session: AuthSession = {
      id: "1" as Id,
      userId,
      role,
      createdAt: NOW,
      lastSeenAt: NOW,
      idleExpiresAt: NOW,
      absoluteExpiresAt: NOW,
      revokedAt: null,
      revokeReason: null,
    };
    return {
      token: "a".repeat(43),
      csrfSecret: "b".repeat(43),
      cookie: "__Host-gezycbt-auth=opaque",
      session,
    };
  }
}
