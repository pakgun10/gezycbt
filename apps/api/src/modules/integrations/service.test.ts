import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type IntegrationAuthentication,
  IntegrationCapabilityError,
  IntegrationRateLimitError,
  IntegrationScopeError,
} from "./domain";
import type { IntegrationRepository } from "./repository";
import {
  InMemoryIntegrationAuditSink,
  IntegrationRateLimiter,
  IntegrationService,
} from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function authentication(): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Teacher agent",
      platformHint: "HERMES",
      ownerUserId: "42" as Id,
      ownerDisplayName: "Guru",
      ownerRole: "TEACHER",
      status: "ACTIVE",
      description: null,
      policyVersion: 4,
      createdByUserId: "1" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "abc123456789",
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
        capability: "questions.read",
        scopeType: "SUBJECT",
        scopeIds: ["7" as Id, "9" as Id],
        constraints: {},
        grantVersion: 4,
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

test("integration authentication keeps credential opaque and applies teacher scope intersection", async () => {
  const audit = new InMemoryIntegrationAuditSink();
  const current = authentication();
  let touched = 0;
  const repository = {
    async authenticate() {
      return current;
    },
    async touchCredential() {
      touched += 1;
    },
  } as unknown as IntegrationRepository;
  const service = new IntegrationService(repository, {
    audit,
    ownerScopeLookup: async () => ({
      teacherId: "42" as Id,
      subjectIds: ["7" as Id],
      classIds: [],
    }),
  });
  const result = await service.authenticate("a-secret-token", { kind: "read" });
  expect(result.credential).not.toHaveProperty("tokenDigest");
  expect((await service.effectiveCapabilities(result))[0]?.scopeIds).toEqual([
    "7" as Id,
  ]);
  expect(touched).toBe(1);
  await service.assertCapability(result, "questions.read");
  const grant = result.grants[0];
  if (!grant) throw new Error("Expected a grant");
  await service.assertResourceScope(result, grant, {
    subjectId: "7" as Id,
  });
  await expect(
    service.assertResourceScope(result, grant, {
      subjectId: "9" as Id,
    }),
  ).rejects.toBeInstanceOf(IntegrationScopeError);
  await expect(
    service.assertCapability(result, "questions.publish"),
  ).rejects.toBeInstanceOf(IntegrationCapabilityError);
  expect(
    audit.events.some(
      (event) => event.action === "INTEGRATION_CAPABILITY_DENIED",
    ),
  ).toBe(true);
});

test("integration authentication rejects unknown credentials and rate limits repeated failures", async () => {
  const repository = {
    async authenticate() {
      return null;
    },
  } as unknown as IntegrationRepository;
  const service = new IntegrationService(repository, {
    rateLimiter: new IntegrationRateLimiter({ authFailurePer15Minutes: 2 }),
  });
  await expect(service.authenticate("bad-token")).rejects.toThrow();
  await expect(service.authenticate("bad-token")).rejects.toThrow();
  await expect(service.authenticate("bad-token")).rejects.toBeInstanceOf(
    IntegrationRateLimitError,
  );
});
