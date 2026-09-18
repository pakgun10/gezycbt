import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { redactAgentResult } from "./action-service";
import type { IntegrationAuthentication } from "./domain";
import {
  IntegrationCapabilityError,
  IntegrationRateLimitError,
} from "./domain";
import {
  InMemoryIntegrationAuditSink,
  IntegrationRateLimiter,
  IntegrationService,
} from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function authentication(
  grantStatus: "ACTIVE" | "REVOKED" = "ACTIVE",
): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Agent",
      platformHint: "HIVEKEEP",
      ownerUserId: "42" as Id,
      ownerDisplayName: "Guru",
      ownerRole: "TEACHER",
      status: "ACTIVE",
      description: null,
      policyVersion: 3,
      createdByUserId: "1" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "agent-prefix",
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
        scopeIds: ["7" as Id],
        constraints: {},
        grantVersion: 3,
        status: grantStatus,
        validFrom: NOW,
        expiresAt: null,
        issuedByUserId: "1" as Id,
        revokedAt: grantStatus === "REVOKED" ? NOW : null,
        revokeReason: grantStatus === "REVOKED" ? "test" : null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

test("revoked capability is denied and leaves a security audit event", async () => {
  const audit = new InMemoryIntegrationAuditSink();
  const service = new IntegrationService(
    {
      async authenticate() {
        return authentication("REVOKED");
      },
      async touchCredential() {},
    } as never,
    { audit },
  );
  const current = await service.authenticate("token");
  await expect(
    service.assertCapability(current, "questions.read"),
  ).rejects.toBeInstanceOf(IntegrationCapabilityError);
  expect(audit.events.at(-1)).toMatchObject({
    action: "INTEGRATION_CAPABILITY_DENIED",
    outcome: "FAILURE",
  });
});

test("action result redaction excludes secrets, answer payloads, and finalization notes", () => {
  const safe = redactAgentResult({
    changed: 2,
    password: "hidden",
    accessToken: "hidden",
    finalization_note: "staff-only",
    content: "raw-question-or-answer",
    nested: { secret: "hidden" },
  });
  expect(safe).toEqual({ changed: 2 });
});

test("read, mutation, export, and auth-failure buckets are isolated", () => {
  const limiter = new IntegrationRateLimiter({
    readPerMinute: 2,
    mutationPerMinute: 1,
    authFailurePer15Minutes: 1,
  });
  limiter.check("10" as Id, "read");
  limiter.check("10" as Id, "read");
  expect(() => limiter.check("10" as Id, "read")).toThrow(
    IntegrationRateLimitError,
  );
  limiter.check("10" as Id, "mutation");
  limiter.checkExport("10" as Id);
  expect(() => limiter.checkAuthFailure("fingerprint")).not.toThrow();
});

test("bounded agent read burst stays synchronous and does not share the mutation bucket", async () => {
  const limiter = new IntegrationRateLimiter({ readPerMinute: 1_000 });
  const started = performance.now();
  await Promise.all(
    Array.from({ length: 1_000 }, async () => {
      limiter.check("burst-client" as Id, "read");
    }),
  );
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(250);
  limiter.check("burst-client" as Id, "mutation");
});
