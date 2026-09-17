import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type AuthSession,
  type AuthSessionRepository,
  AuthSessionService,
  readAuthCookie,
} from "./session";

const USER_ID = "42" as Id;
const START = new Date("2026-09-17T00:00:00.000Z");

describe("AuthSessionService", () => {
  test("creates a 256-bit opaque token and stores only digests", async () => {
    const repository = new FakeAuthSessionRepository();
    const service = new AuthSessionService({
      repository,
      clock: () => new Date(START),
      tokenGenerator: () => "a".repeat(43),
      csrfGenerator: () => "b".repeat(43),
    });

    const credentials = await service.create(USER_ID, "ADMIN");

    expect(credentials.token).toBe("a".repeat(43));
    expect(credentials.csrfSecret).toBe("b".repeat(43));
    expect(credentials.cookie).toContain("__Host-gezycbt-auth=");
    expect(credentials.cookie).toContain("Secure");
    expect(credentials.cookie).toContain("HttpOnly");
    expect(credentials.cookie).toContain("SameSite=Strict");
    expect(credentials.cookie).toContain("Path=/");
    expect(credentials.cookie).not.toContain(USER_ID);
    expect(repository.created[0]?.tokenHash).not.toContain(credentials.token);
    expect(repository.created[0]?.csrfSecretHash).not.toContain(
      credentials.csrfSecret,
    );
    expect(repository.created[0]?.absoluteExpiresAt).toBe(
      "2026-09-17T12:00:00.000Z" as UtcTimestamp,
    );
    expect(
      await service.verifyCsrfSecret(
        credentials.session.id,
        credentials.csrfSecret,
      ),
    ).toBe(true);
    expect(
      await service.verifyCsrfSecret(credentials.session.id, "c".repeat(43)),
    ).toBe(false);
  });

  test("resolves, throttles last-seen writes, and extends only to absolute expiry", async () => {
    const repository = new FakeAuthSessionRepository();
    let now = new Date(START);
    const service = new AuthSessionService({
      repository,
      clock: () => new Date(now),
      tokenGenerator: () => "c".repeat(43),
      csrfGenerator: () => "d".repeat(43),
    });
    const credentials = await service.create(USER_ID, "ADMIN");
    const first = await service.resolve(credentials.token);
    expect(first?.userId).toBe(USER_ID);
    expect(repository.touchCalls).toBe(0);
    if (!first) throw new Error("Expected an active session");

    now = new Date("2026-09-17T00:05:01.000Z");
    const touched = await service.touch(first);
    if (!touched) throw new Error("Expected the session to be touched");
    expect(touched?.lastSeenAt).toBe(
      "2026-09-17T00:05:01.000Z" as UtcTimestamp,
    );
    expect(touched?.idleExpiresAt).toBe(
      "2026-09-17T00:35:01.000Z" as UtcTimestamp,
    );
    expect(repository.touchCalls).toBe(1);

    now = new Date("2026-09-17T11:59:00.000Z");
    repository.replace({
      ...touched,
      lastSeenAt: "2026-09-17T11:50:00.000Z" as UtcTimestamp,
      idleExpiresAt: "2026-09-17T12:00:01.000Z" as UtcTimestamp,
    });
    const nearAbsolute = await service.touch(touched);
    expect(nearAbsolute?.idleExpiresAt).toBe(
      "2026-09-17T12:00:00.000Z" as UtcTimestamp,
    );
  });

  test("rotates atomically and invalidates the previous token", async () => {
    const repository = new FakeAuthSessionRepository();
    const service = new AuthSessionService({
      repository,
      clock: () => new Date(START),
      tokenGenerator: (() => {
        const values = ["e".repeat(43), "f".repeat(43)];
        return () => values.shift() ?? "g".repeat(43);
      })(),
      csrfGenerator: (() => {
        const values = ["h".repeat(43), "i".repeat(43)];
        return () => values.shift() ?? "j".repeat(43);
      })(),
    });
    const first = await service.create(USER_ID, "TEACHER");
    const second = await service.rotate(first.token);

    expect(second?.token).toBe("f".repeat(43));
    expect(await service.resolve(first.token)).toBeNull();
    if (!second) throw new Error("Expected a rotated session");
    expect(await service.resolve(second.token)).not.toBeNull();
    expect(repository.revokeReasons).toEqual(["ROTATED"]);
  });

  test("logout and user revoke are idempotent", async () => {
    const repository = new FakeAuthSessionRepository();
    const service = new AuthSessionService({
      repository,
      clock: () => new Date(START),
      tokenGenerator: (() => {
        const values = ["k".repeat(43), "l".repeat(43)];
        return () => values.shift() ?? "m".repeat(43);
      })(),
    });
    const first = await service.create(USER_ID, "PARTICIPANT");
    const second = await service.create(USER_ID, "PARTICIPANT");

    expect(await service.logout(first.token)).toBe(true);
    expect(await service.logout(first.token)).toBe(false);
    expect(await service.revokeUserSessions(USER_ID, "PASSWORD_RESET")).toBe(1);
    expect(await service.resolve(second.token)).toBeNull();
  });
});

describe("auth cookie parsing", () => {
  test("reads only the valid opaque auth cookie", () => {
    const token = "n".repeat(43);
    expect(readAuthCookie(`other=value; __Host-gezycbt-auth=${token}`)).toBe(
      token,
    );
    expect(readAuthCookie("__Host-gezycbt-auth=user-id-42")).toBeNull();
    expect(readAuthCookie(null)).toBeNull();
  });
});

class FakeAuthSessionRepository implements AuthSessionRepository {
  readonly created: Array<{
    tokenHash: string;
    csrfSecretHash: string;
    absoluteExpiresAt: UtcTimestamp;
  }> = [];
  readonly revokeReasons: string[] = [];
  touchCalls = 0;
  private nextId = 1;
  private readonly sessions = new Map<Id, AuthSession>();
  private readonly tokenIndex = new Map<string, Id>();
  private readonly csrfIndex = new Map<Id, Uint8Array>();

  async create(input: Parameters<AuthSessionRepository["create"]>[0]) {
    const session = this.makeSession(input);
    this.created.push({
      tokenHash: hex(input.tokenHash),
      csrfSecretHash: hex(input.csrfSecretHash),
      absoluteExpiresAt: input.absoluteExpiresAt,
    });
    this.sessions.set(session.id, session);
    this.tokenIndex.set(hex(input.tokenHash), session.id);
    this.csrfIndex.set(session.id, new Uint8Array(input.csrfSecretHash));
    return session;
  }

  async findActiveByTokenHash(hash: Uint8Array, now: UtcTimestamp) {
    const id = this.tokenIndex.get(hex(hash));
    const session = id ? this.sessions.get(id) : undefined;
    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return null;
    }
    return session;
  }

  async findActiveCsrfSecretHash(id: Id, now: UtcTimestamp) {
    const session = this.sessions.get(id);
    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return null;
    }
    const hash = this.csrfIndex.get(id);
    return hash ? new Uint8Array(hash) : null;
  }

  async touch(
    id: Id,
    lastSeenAt: UtcTimestamp,
    idleExpiresAt: UtcTimestamp,
    now: UtcTimestamp,
  ) {
    this.touchCalls += 1;
    const session = this.sessions.get(id);
    if (
      !session ||
      session.revokedAt ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      return false;
    }
    this.sessions.set(id, { ...session, lastSeenAt, idleExpiresAt });
    return true;
  }

  async rotate(input: Parameters<AuthSessionRepository["rotate"]>[0]) {
    const id = this.tokenIndex.get(hex(input.previousTokenHash));
    const previous = id ? this.sessions.get(id) : undefined;
    if (!previous || previous.revokedAt) return null;
    const revokedAt = input.previousExpiresAt;
    this.sessions.set(previous.id, {
      ...previous,
      revokedAt,
      revokeReason: "ROTATED",
    });
    this.revokeReasons.push("ROTATED");
    return this.create(input);
  }

  async revokeByTokenHash(hash: Uint8Array, reason: string, now: UtcTimestamp) {
    const id = this.tokenIndex.get(hex(hash));
    return id ? this.revoke(id, reason, now) : false;
  }

  async revoke(id: Id, reason: string, now: UtcTimestamp) {
    const session = this.sessions.get(id);
    if (!session || session.revokedAt) return false;
    this.sessions.set(id, { ...session, revokedAt: now, revokeReason: reason });
    this.revokeReasons.push(reason);
    return true;
  }

  async revokeAllForUser(userId: Id, reason: string, now: UtcTimestamp) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        await this.revoke(session.id, reason, now);
        count += 1;
      }
    }
    return count;
  }

  replace(session: AuthSession): void {
    this.sessions.set(session.id, session);
  }

  private makeSession(
    input: Parameters<AuthSessionRepository["create"]>[0],
  ): AuthSession {
    return {
      id: String(this.nextId++) as Id,
      userId: input.userId,
      role: input.role,
      createdAt: input.createdAt,
      lastSeenAt: input.lastSeenAt,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
      revokeReason: null,
    };
  }
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}
