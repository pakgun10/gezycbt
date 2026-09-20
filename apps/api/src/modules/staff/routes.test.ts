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

function appFor(
  currentRole: "ADMIN" | "TEACHER",
  rowsForQuery?: (sql: string) => readonly Record<string, unknown>[],
) {
  const current = user(currentRole);
  const queries: unknown[][] = [];
  const options: StaffRouteOptions = {
    database: {
      async query<T extends Record<string, unknown>>(
        _sql: string,
        parameters?: readonly unknown[],
      ): Promise<readonly T[]> {
        queries.push([...(parameters ?? [])]);
        return (rowsForQuery?.(_sql) ?? []) as readonly T[];
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
    academics: {
      async listClassMemberProfiles() {
        return [];
      },
      async replaceClassMembers() {
        return [];
      },
    } as unknown as StaffRouteOptions["academics"],
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

test("schedule archive route delegates a CLOSED schedule to the archive service", async () => {
  const current = user("ADMIN");
  const archived = {
    id: "40" as Id,
    examRevisionId: "30" as Id,
    mode: "MAIN",
    status: "ARCHIVED",
    startsAt: NOW,
    endsAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
    durationSeconds: 60,
    maxAttempts: 1,
    hardEnd: true,
    allowLateStart: true,
    resultReleasePolicy: "MANUAL",
    hasPracticeToken: false,
    practiceTokenHint: null,
    hasMainAccessCode: true,
    mainAccessCodeHint: "•••-BC",
    identityFields: null,
    targetClassIds: [],
    targetParticipantIds: [],
    closedAt: NOW,
    closedByUserId: current.id,
    closeReason: "Selesai",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const calls: unknown[][] = [];
  const appWithSchedules = new Elysia()
    .use(
      createStaffRoutes({
        database: {
          async query() {
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
        academics: {
          async listClassMemberProfiles() {
            return [];
          },
          async replaceClassMembers() {
            return [];
          },
        } as unknown as StaffRouteOptions["academics"],
        schedules: {
          drafts: {
            async archiveSchedule(...input: unknown[]) {
              calls.push(input);
              return archived;
            },
          } as never,
          accessCodes: {} as never,
        },
        expectedOrigin: "https://cbt.example.test",
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
  const response = await appWithSchedules.handle(
    new Request(
      "https://cbt.example.test/api/v1/teacher/schedules/40/archive",
      {
        method: "POST",
        headers: {
          cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
          origin: "https://cbt.example.test",
          "content-type": "application/json",
          "x-csrf-token": "test-token",
          "idempotency-key": "archive-schedule-test-0001",
        },
        body: JSON.stringify({ expectedUpdatedAt: NOW }),
      },
    ),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: { id: "40", status: "ARCHIVED" },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.slice(1)).toEqual(["40", NOW]);
});

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

test("admin user list returns bounded numbered pages with a total", async () => {
  const { app, queries } = appFor("ADMIN", (sql) =>
    sql.includes("COUNT(*) AS total") ? [{ total: 76 }] : [],
  );
  const response = await app.handle(
    new Request("https://cbt.example.test/api/v1/admin/users?page=4&limit=25", {
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: {
      items: [],
      nextCursor: null,
      page: 4,
      pageSize: 25,
      totalItems: 76,
      totalPages: 4,
    },
  });
  expect(queries).toEqual([[], [25, 75]]);
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

test("teacher target pickers include class and participant scope predicates", async () => {
  const { app, queries } = appFor("TEACHER");
  const headers = { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` };
  expect(
    (
      await app.handle(
        new Request("https://cbt.example.test/api/v1/teacher/classes", {
          headers,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await app.handle(
        new Request(
          "https://cbt.example.test/api/v1/teacher/participants?search=ani",
          { headers },
        ),
      )
    ).status,
  ).toBe(200);
  expect(queries.some((parameters) => parameters.includes("2"))).toBe(true);
  expect(queries.some((parameters) => parameters.includes("%ani%"))).toBe(true);
});

test("admin class roster routes are protected and support atomic replacement", async () => {
  const { app } = appFor("ADMIN");
  const cookie = `__Host-gezycbt-auth=${"a".repeat(43)}`;
  const read = await app.handle(
    new Request("https://cbt.example.test/api/v1/admin/classes/30/members", {
      headers: { cookie },
    }),
  );
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ data: { items: [] } });

  const write = await app.handle(
    new Request("https://cbt.example.test/api/v1/admin/classes/30/members", {
      method: "PUT",
      headers: {
        cookie,
        origin: "https://cbt.example.test",
        "content-type": "application/json",
        "x-csrf-token": "test-token",
        "idempotency-key": "roster-test-0001",
      },
      body: JSON.stringify({ participantIds: ["50"] }),
    }),
  );
  expect(write.status).toBe(200);
  expect(await write.json()).toEqual({ data: { items: [] } });
});
