import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import type { AuthSession } from "../auth/session";
import type { IntegrationAuthentication } from "./domain";
import type { IntegrationRepository } from "./repository";
import { createIntegrationRoutes } from "./routes";
import { IntegrationService } from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const admin = {
  id: "1" as Id,
  username: "admin",
  usernameNormalized: "admin",
  passwordHash: "$argon2id$v=19$m=1,t=1,p=1$hash",
  role: "ADMIN" as const,
  status: "ACTIVE" as const,
  displayName: "Admin",
  forcePasswordChange: false,
  passwordChangedAt: null,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const session: AuthSession = {
  id: "3" as Id,
  userId: admin.id,
  role: "ADMIN",
  createdAt: NOW,
  lastSeenAt: NOW,
  idleExpiresAt: "2026-09-17T12:00:00.000Z" as UtcTimestamp,
  absoluteExpiresAt: "2026-09-18T00:00:00.000Z" as UtcTimestamp,
  revokedAt: null,
  revokeReason: null,
};

function auth(capabilities: readonly string[] = []): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Agent",
      platformHint: "HIVEKEEP",
      ownerUserId: admin.id,
      ownerDisplayName: admin.displayName,
      ownerRole: "ADMIN",
      status: "ACTIVE",
      description: null,
      policyVersion: 1,
      createdByUserId: admin.id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "prefix",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: capabilities.map((capability, index) => ({
      id: String(100 + index) as Id,
      integrationClientId: "10" as Id,
      capability,
      scopeType: "SCHOOL" as const,
      scopeIds: [],
      constraints: {},
      grantVersion: index + 1,
      status: "ACTIVE" as const,
      validFrom: NOW,
      expiresAt: null,
      issuedByUserId: admin.id,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
      updatedAt: NOW,
    })),
  };
}

function app(
  reauthenticated = true,
  capabilities: readonly string[] = [],
  questionAuthoring?: unknown,
  examAuthoring?: unknown,
  resultReads?: unknown,
  exportService?: unknown,
  actionService?: unknown,
) {
  const repository = {
    async authenticate() {
      return auth(capabilities);
    },
    async touchCredential() {},
  } as unknown as IntegrationRepository;
  const service = new IntegrationService(repository);
  type FakeConnection = {
    query<T extends Record<string, unknown>>(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<readonly T[]>;
    execute(
      sql: string,
      parameters?: readonly unknown[],
    ): Promise<{ affectedRows: number }>;
  };
  const connection: FakeConnection = {
    async query<_T extends Record<string, unknown>>() {
      return [];
    },
    async execute() {
      return { affectedRows: 1 };
    },
  };
  const database = {
    ...connection,
    async transaction<T>(operation: (tx: FakeConnection) => Promise<T>) {
      return operation(connection);
    },
    async close() {},
  };
  return new Elysia()
    .use(
      createIntegrationRoutes({
        database,
        service,
        users: {
          async findById() {
            return admin;
          },
        },
        sessionService: {
          async resolve(token: string) {
            return token === "a".repeat(43) ? session : null;
          },
          async verifyCsrfSecret() {
            return true;
          },
        },
        isReauthenticated: () => reauthenticated,
        expectedOrigin: "https://cbt.example.test",
        ...(questionAuthoring
          ? { questionAuthoring: questionAuthoring as never }
          : {}),
        ...(examAuthoring ? { examAuthoring: examAuthoring as never } : {}),
        ...(resultReads ? { resultReads: resultReads as never } : {}),
        ...(exportService ? { exports: exportService as never } : {}),
        ...(actionService ? { actions: actionService as never } : {}),
      }),
    )
    .onError(({ error, set }) => {
      set.status = (error as { status?: number }).status ?? 500;
      return {
        error: { code: (error as { code?: string }).code ?? "INTERNAL_ERROR" },
      };
    });
}

test("agent routes require Bearer credential and never use the staff cookie", async () => {
  const application = app();
  const missing = await application.handle(
    new Request("https://cbt.example.test/api/v1/integrations/agent/me"),
  );
  expect(missing.status).toBe(401);
  const valid = await application.handle(
    new Request("https://cbt.example.test/api/v1/integrations/agent/me", {
      headers: { authorization: "Bearer integration-token" },
    }),
  );
  expect(valid.status).toBe(200);
  expect(await valid.json()).toMatchObject({ data: { client: { id: "10" } } });
});

test("management endpoint requires admin session and CSRF for mutations", async () => {
  const application = app();
  const unauthenticated = await application.handle(
    new Request("https://cbt.example.test/api/v1/admin/integration-clients"),
  );
  expect(unauthenticated.status).toBe(401);
  const missingHeaders = await application.handle(
    new Request("https://cbt.example.test/api/v1/admin/integration-clients", {
      method: "POST",
      headers: { cookie: `__Host-gezycbt-auth=${"a".repeat(43)}` },
    }),
  );
  expect(missingHeaders.status).toBe(403);
});

test("management mutation requires recent step-up reauthentication", async () => {
  const application = app(false);
  const response = await application.handle(
    new Request("https://cbt.example.test/api/v1/admin/integration-clients", {
      method: "POST",
      headers: {
        cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
        origin: "https://cbt.example.test",
        "x-csrf-token": "csrf",
        "idempotency-key": "integration-test-idempotency",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Agent",
        platformHint: "HERMES",
        ownerUserId: "1",
      }),
    }),
  );
  expect(response.status).toBe(401);
});

test("agent authoring route delegates safe question reads and enforces mutation idempotency", async () => {
  const authoring = {
    async getQuestion() {
      return { id: "50", answerKeyIncluded: false };
    },
    async createQuestion() {
      throw new Error("should not execute without idempotency key");
    },
  };
  const application = app(
    true,
    ["questions.read", "questions.create"],
    authoring,
  );
  const read = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/questions/50",
      {
        headers: { authorization: "Bearer integration-token" },
      },
    ),
  );
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({
    data: { answerKeyIncluded: false },
  });

  const mutation = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/questions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer integration-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    ),
  );
  expect(mutation.status).toBe(422);
});

test("agent exam authoring exposes safe reads and mutation idempotency", async () => {
  const examAuthoring = {
    async getExam() {
      return { id: "101", examId: "100", questions: [] };
    },
    async createExam() {
      throw new Error("should not execute without idempotency key");
    },
  };
  const application = app(
    true,
    ["exams.read", "exams.create"],
    undefined,
    examAuthoring,
  );
  const read = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/exams/100",
      {
        headers: { authorization: "Bearer integration-token" },
      },
    ),
  );
  expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({ data: { examId: "100" } });

  const mutation = await application.handle(
    new Request("https://cbt.example.test/api/v1/integrations/agent/exams", {
      method: "POST",
      headers: {
        authorization: "Bearer integration-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    }),
  );
  expect(mutation.status).toBe(422);
});

test("agent result routes expose summary and paginated schedule reads", async () => {
  const resultReads = {
    async getScheduleSummary() {
      return { scheduleId: "70", results: { total: 0 } };
    },
    async listScheduleResults() {
      return { items: [], nextCursor: null };
    },
  };
  const application = app(
    true,
    ["results.read"],
    undefined,
    undefined,
    resultReads,
  );
  const summary = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/schedules/70/summary",
      { headers: { authorization: "Bearer integration-token" } },
    ),
  );
  expect(summary.status).toBe(200);
  expect(await summary.json()).toMatchObject({
    data: { scheduleId: "70" },
  });

  const results = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/schedules/70/results?limit=10",
      { headers: { authorization: "Bearer integration-token" } },
    ),
  );
  expect(results.status).toBe(200);
  expect(await results.json()).toMatchObject({
    data: { items: [], nextCursor: null },
  });
});

test("agent export routes require idempotency and expose status/download token", async () => {
  const exportService = {
    async createExport() {
      return { id: "80", status: "QUEUED" };
    },
    async getStatus() {
      return { id: "80", status: "READY" };
    },
    async issueDownloadToken() {
      return { token: "secret", expiresAt: "2099-01-01T00:00:00.000Z" };
    },
    async download() {
      return {
        body: new TextEncoder().encode("id\n80\n"),
        format: "CSV" as const,
        jobId: "80",
      };
    },
  };
  const application = app(
    true,
    ["results.export"],
    undefined,
    undefined,
    undefined,
    exportService,
  );
  const missingKey = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/schedules/70/exports",
      {
        method: "POST",
        headers: { authorization: "Bearer integration-token" },
      },
    ),
  );
  expect(missingKey.status).toBe(422);
  const created = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/schedules/70/exports",
      {
        method: "POST",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "export-route-idempotency-001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ format: "CSV" }),
      },
    ),
  );
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ data: { id: "80" } });
  const status = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/exports/80",
      { headers: { authorization: "Bearer integration-token" } },
    ),
  );
  expect(status.status).toBe(200);
  const token = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/exports/80/download-token",
      {
        method: "POST",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "export-token-idempotency-001",
        },
      },
    ),
  );
  expect(token.status).toBe(200);
  expect(await token.json()).toMatchObject({ data: { token: "secret" } });
  const download = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/exports/80/download",
      {
        headers: {
          authorization: "Bearer integration-token",
          "x-gezycbt-download-token": "secret",
        },
      },
    ),
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toContain("text/csv");
  expect(await download.text()).toContain("80");
});

test("agent action routes prepare and confirm exact plan with idempotency", async () => {
  const actionService = {
    async prepare() {
      return {
        id: "300",
        operation: "exams.publish",
        targetType: "exam_revision",
        targetId: "30",
        status: "AWAITING_CONFIRMATION",
        planHash: "a".repeat(64),
      };
    },
    async get() {
      return { id: "300", status: "AWAITING_CONFIRMATION" };
    },
    async list() {
      return { items: [], nextCursor: null };
    },
    async confirm() {
      return { id: "300", status: "SUCCEEDED" };
    },
    async cancel() {
      return { id: "300", status: "CANCELLED" };
    },
  };
  const application = app(
    true,
    ["exams.publish"],
    undefined,
    undefined,
    undefined,
    undefined,
    actionService,
  );
  const missingKey = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/actions/prepare",
      {
        method: "POST",
        headers: { authorization: "Bearer integration-token" },
        body: JSON.stringify({
          operation: "exams.publish",
          target: { type: "exam_revision", id: "30" },
        }),
      },
    ),
  );
  expect(missingKey.status).toBe(422);
  const prepared = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/actions/prepare",
      {
        method: "POST",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "action-route-idempotency-001",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "exams.publish",
          target: { type: "exam_revision", id: "30" },
        }),
      },
    ),
  );
  expect(prepared.status).toBe(200);
  expect(await prepared.json()).toMatchObject({
    data: { id: "300", status: "AWAITING_CONFIRMATION" },
  });
  const confirmed = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/actions/300/confirm",
      {
        method: "POST",
        headers: {
          authorization: "Bearer integration-token",
          "idempotency-key": "action-route-confirm-001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ planHash: "a".repeat(64) }),
      },
    ),
  );
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({
    data: { status: "SUCCEEDED" },
  });
});

test("admin action approval keeps CSRF, re-auth, and exact plan hash boundary", async () => {
  let approved: { id: string; planHash: string; adminUserId: string } | null =
    null;
  const actionService = {
    async listForAdmin() {
      return { items: [], nextCursor: null };
    },
    async getForAdmin() {
      return { id: "301", status: "AWAITING_APPROVAL" };
    },
    async approve(id: string, planHash: string, adminUserId: string) {
      approved = { id, planHash, adminUserId };
      return { id, status: "SUCCEEDED", planHash };
    },
  };
  const application = app(
    true,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    actionService,
  );
  const response = await application.handle(
    new Request(
      "https://cbt.example.test/api/v1/admin/integration-actions/301/approve",
      {
        method: "POST",
        headers: {
          cookie: `__Host-gezycbt-auth=${"a".repeat(43)}`,
          origin: "https://cbt.example.test",
          "x-csrf-token": "csrf",
          "idempotency-key": "admin-action-approval-001",
          "content-type": "application/json",
        },
        body: JSON.stringify({ planHash: "b".repeat(64) }),
      },
    ),
  );
  expect(response.status).toBe(200);
  if (!approved) throw new Error("Expected admin approval callback");
  expect(approved as unknown).toEqual({
    id: "301",
    planHash: "b".repeat(64),
    adminUserId: "1",
  });
});
