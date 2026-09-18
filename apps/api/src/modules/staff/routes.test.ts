import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import type { AuthSession } from "../auth/session";
import { createStaffRoutes, type StaffRouteOptions } from "./routes";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function user(role: "ADMIN" | "TEACHER") {
  return {
    id: (role === "ADMIN" ? "1" : "2") as Id,
    username: role.toLowerCase(),
    usernameNormalized: role.toLowerCase(),
    passwordHash: "$argon2id$v=19$m=1,t=1,p=1$hash",
    role,
    status: "ACTIVE" as const,
    displayName: role,
    forcePasswordChange: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function session(userId: Id, role: "ADMIN" | "TEACHER"): AuthSession {
  return {
    id: `${userId}-session` as Id,
    userId,
    role,
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: "2026-09-17T12:00:00.000Z" as UtcTimestamp,
    absoluteExpiresAt: "2026-09-18T00:00:00.000Z" as UtcTimestamp,
    revokedAt: null,
    revokeReason: null,
  };
}

function appFor(currentRole: "ADMIN" | "TEACHER") {
  const current = user(currentRole);
  const queries: unknown[][] = [];
  const options: StaffRouteOptions = {
    database: {
      async query(_sql, parameters) {
        queries.push([...(parameters ?? [])]);
        return [];
      },
      async execute() {
        return { affectedRows: 1 };
      },
      async transaction(operation) {
        return operation(this);
      },
      async close() {
        return undefined;
      },
    },
    users: {
      async findById() {
        return current;
      },
      async create() {
        return current;
      },
      async update() {
        return current;
      },
      async disable() {
        return { ...current, status: "DISABLED" as const };
      },
    },
    sessionService: {
      async resolve(token: string) {
        return token === "a".repeat(43)
          ? session(current.id, current.role)
          : null;
      },
      async verifyCsrfSecret() {
        return true;
      },
    },
    academics: {} as StaffRouteOptions["academics"],
    expectedOrigin: "https://cbt.example.test",
  };
  const app = new Elysia()
    .use(createStaffRoutes(options))
    .onError(({ error, set }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        return { error: { code: error.code } };
      }
      set.status = 500;
      return { error: { code: "INTERNAL_ERROR" } };
    });
  return { app, queries };
}

test("staff routes require a session and enforce admin-only users", async () => {
  const admin = appFor("ADMIN").app;
  const unauthenticated = await admin.handle(
    new Request("https://cbt.example.test/api/v1/admin/users"),
  );
  expect(unauthenticated.status).toBe(401);

  const teacher = appFor("TEACHER").app;
  const forbidden = await teacher.handle(
    new Request("https://cbt.example.test/api/v1/admin/users", {
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );
  expect(forbidden.status).toBe(403);
});

test("teacher list queries include the authenticated owner scope", async () => {
  const { app, queries } = appFor("TEACHER");
  const response = await app.handle(
    new Request("https://cbt.example.test/api/v1/teacher/questions", {
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(queries.some((parameters) => parameters.includes("2"))).toBe(true);
});

test("teacher subject options include only the authenticated teacher scope", async () => {
  const { app, queries } = appFor("TEACHER");
  const response = await app.handle(
    new Request("https://cbt.example.test/api/v1/teacher/subjects", {
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );
  expect(response.status).toBe(200);
  expect(queries.some((parameters) => parameters.includes("2"))).toBe(true);
});
