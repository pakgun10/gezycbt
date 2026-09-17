import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import { AuthLoginService, InMemoryLoginFailureLimiter } from "./login";
import { createAuthRoutes } from "./routes";
import type { AuthSession } from "./session";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const USER = {
  id: "1" as Id,
  username: "teacher",
  usernameNormalized: "teacher",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  role: "TEACHER" as const,
  status: "ACTIVE" as const,
  displayName: "Teacher",
  forcePasswordChange: false,
  passwordChangedAt: NOW,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

test("auth routes enforce same-origin and set the opaque session cookie", async () => {
  const session: AuthSession = {
    id: "9" as Id,
    userId: USER.id,
    role: USER.role,
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: NOW,
    absoluteExpiresAt: "2026-09-17T12:00:00.000Z" as UtcTimestamp,
    revokedAt: null,
    revokeReason: null,
  };
  const sessionService = {
    async create() {
      return {
        token: "a".repeat(43),
        csrfSecret: "b".repeat(43),
        cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
        session,
      };
    },
    async resolve() {
      return null;
    },
    async verifyCsrfSecret() {
      return false;
    },
    async rotate() {
      return {
        token: "a".repeat(43),
        csrfSecret: "c".repeat(43),
        cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
        session,
      };
    },
  };
  const loginService = new AuthLoginService({
    users: {
      async findByUsernameNormalized() {
        return USER;
      },
    },
    passwords: {
      async verify() {
        return true;
      },
      async verifyDummy() {
        return false;
      },
    },
    sessions: sessionService,
    limiter: new InMemoryLoginFailureLimiter(),
  });
  const app = new Elysia()
    .use(
      createAuthRoutes({
        loginService,
        sessionService,
        expectedOrigin: "https://cbt.example.test",
        async currentUser() {
          return {
            id: USER.id,
            username: USER.username,
            displayName: USER.displayName,
            role: USER.role,
            forcePasswordChange: USER.forcePasswordChange,
          };
        },
      }),
    )
    .onError(({ error, set }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        return { error: { code: error.code } };
      }
      set.status = 500;
      return { error: { code: "INTERNAL_ERROR" } };
    });

  const response = await app.handle(
    new Request("https://cbt.example.test/api/v1/auth/staff/login", {
      method: "POST",
      headers: {
        origin: "https://cbt.example.test",
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "teacher", password: "password" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("__Host-gezycbt-auth=");
  expect((await response.json()).user.role).toBe("TEACHER");

  const me = await app.handle(
    new Request("https://cbt.example.test/api/v1/auth/me", {
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({
    user: { id: "1", role: "TEACHER" },
    csrfToken: "c".repeat(43),
  });

  const rejected = await app.handle(
    new Request("https://cbt.example.test/api/v1/auth/staff/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "teacher", password: "password" }),
    }),
  );
  expect(rejected.status).toBe(403);
});
