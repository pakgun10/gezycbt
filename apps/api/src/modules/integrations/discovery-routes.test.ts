import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { Elysia } from "elysia";
import type { IntegrationDiscoveryRepository } from "./discovery";
import type { IntegrationAuthentication } from "./domain";
import type { IntegrationRepository } from "./repository";
import { createIntegrationRoutes } from "./routes";
import { IntegrationService } from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

test("agent discovery route returns stable candidates and rejects limits above 20", async () => {
  const authentication = createAuthentication();
  const discovery: IntegrationDiscoveryRepository = {
    async searchSubjects() {
      return {
        items: [
          { id: "7" as Id, code: "MAT", name: "Matematika", status: "ACTIVE" },
        ],
        nextCursor: null,
      };
    },
    async searchClasses() {
      return { items: [], nextCursor: null };
    },
    async searchQuestionBanks() {
      return { items: [], nextCursor: null };
    },
    async searchQuestions() {
      return { items: [], nextCursor: null };
    },
    async searchExams() {
      return { items: [], nextCursor: null };
    },
    async searchSchedules() {
      return { items: [], nextCursor: null };
    },
  };
  const service = new IntegrationService(
    {
      async authenticate() {
        return authentication;
      },
      async touchCredential() {},
    } as unknown as IntegrationRepository,
    { discovery },
  );
  const app = new Elysia()
    .use(
      createIntegrationRoutes({
        database: {} as never,
        service,
        users: {
          async findById() {
            return null;
          },
        },
        sessionService: {
          async resolve() {
            return null;
          },
          async verifyCsrfSecret() {
            return false;
          },
        },
        isReauthenticated: () => false,
        expectedOrigin: "https://cbt.example.test",
      }),
    )
    .onError(({ error, set }) => {
      set.status = (error as { status?: number }).status ?? 500;
      return {
        error: { code: (error as { code?: string }).code ?? "INTERNAL_ERROR" },
      };
    });

  const response = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/subjects?q=matematika&limit=20",
      { headers: { authorization: "Bearer test-token" } },
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: {
      items: [{ id: "7", code: "MAT" }],
      nextCursor: null,
      ambiguity: null,
    },
  });

  const invalidLimit = await app.handle(
    new Request(
      "https://cbt.example.test/api/v1/integrations/agent/subjects?limit=21",
      { headers: { authorization: "Bearer test-token" } },
    ),
  );
  expect(invalidLimit.status).toBe(422);
});

function createAuthentication(): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Discovery",
      platformHint: "HIVEKEEP",
      ownerUserId: "1" as Id,
      ownerDisplayName: "Admin",
      ownerRole: "ADMIN",
      status: "ACTIVE",
      description: null,
      policyVersion: 1,
      createdByUserId: "1" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "test",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: [
      {
        id: "12" as Id,
        integrationClientId: "10" as Id,
        capability: "subjects.read",
        scopeType: "SCHOOL",
        scopeIds: [],
        constraints: {},
        grantVersion: 1,
        status: "ACTIVE",
        validFrom: NOW,
        expiresAt: null,
        issuedByUserId: "1" as Id,
        revokedAt: null,
        revokeReason: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}
