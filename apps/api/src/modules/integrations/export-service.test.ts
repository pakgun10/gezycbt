import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";
import { IntegrationExportService } from "./export-service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const FUTURE = "2099-09-17T00:00:00.000Z" as UtcTimestamp;

function grant(
  constraints: Readonly<Record<string, unknown>> = {},
): IntegrationGrant {
  return {
    id: "90" as Id,
    integrationClientId: "91" as Id,
    capability: "results.export",
    scopeType: "SCHEDULE",
    scopeIds: ["70" as Id],
    constraints,
    grantVersion: 3,
    status: "ACTIVE",
    validFrom: NOW,
    expiresAt: null,
    issuedByUserId: "1" as Id,
    revokedAt: null,
    revokeReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function auth(currentGrant = grant()): IntegrationAuthentication {
  return {
    client: {
      id: "91" as Id,
      name: "Result agent",
      platformHint: "HIVEKEEP",
      ownerUserId: "40" as Id,
      ownerDisplayName: "Guru",
      ownerRole: "TEACHER",
      status: "ACTIVE",
      description: null,
      policyVersion: 3,
      createdByUserId: "40" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "92" as Id,
      integrationClientId: "91" as Id,
      tokenPrefix: "prefix",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: [currentGrant],
  };
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "80" as Id,
    scheduleId: "70" as Id,
    format: "CSV" as const,
    status: "READY" as const,
    includePii: false,
    rowCount: 2,
    errorMessage: null,
    createdAt: NOW,
    expiresAt: FUTURE,
    requesterUserId: "40" as Id,
    integrationClientId: "91" as Id,
    integrationGrantVersion: 3,
    scopeSnapshot: {
      ownerUserId: "40",
      subjectId: "30",
      scheduleId: "70",
      mode: "PRACTICE",
    },
    filter: {},
    columns: ["id", "participantName"] as const,
    rowLimit: 100,
    ...overrides,
  };
}

function setup(options: { readonly pii?: boolean } = {}) {
  const audits: string[] = [];
  const created: Record<string, unknown>[] = [];
  const database = {
    async query() {
      return [
        {
          schedule_id: "70",
          mode: "PRACTICE",
          subject_id: "30",
          owner_teacher_id: "40",
        },
      ];
    },
  };
  const integration = {
    checkExportRateLimit() {},
    async assertCapability() {
      return grant(options.pii ? { result_pii_export_allowed: true } : {});
    },
    async assertResourceScope() {},
    async recordAgentAudit(event: { action: string }) {
      audits.push(event.action);
    },
  };
  const exports = {
    async createAgentJob(input: Record<string, unknown>) {
      created.push(input);
      return record({ includePii: input.includePii });
    },
    async getJob() {
      return record();
    },
    async issueDownloadToken() {
      return { token: "download-token", expiresAt: FUTURE };
    },
    async consumeDownload() {
      return {
        body: new TextEncoder().encode("id,participantName\n80,Budi\n"),
        format: "CSV" as const,
        jobId: "80" as Id,
      };
    },
  };
  return {
    service: new IntegrationExportService({
      database: database as never,
      integration: integration as never,
      exports: exports as never,
    }),
    audits,
    created,
  };
}

describe("integration export policy", () => {
  test("creates a scoped non-PII job and records export creation", async () => {
    const value = setup();
    const job = await value.service.createExport(
      auth(),
      "70" as Id,
      { format: "CSV", includePii: false },
      "req-1",
      "export-idempotency-001",
    );
    expect(job.id).toBe("80" as Id);
    expect(value.created[0]).toMatchObject({
      scheduleId: "70",
      integrationClientId: "91",
      rowLimit: 10_000,
      idempotencyKey: "export-idempotency-001",
    });
    expect(value.audits).toEqual(["INTEGRATION_EXPORT_CREATE"]);
  });

  test("requires the explicit PII grant for PII export", async () => {
    const value = setup();
    await expect(
      value.service.createExport(
        auth(),
        "70" as Id,
        { format: "CSV", includePii: true },
        "req-2",
        "export-idempotency-002",
      ),
    ).rejects.toThrow("PII");
    expect(value.created).toHaveLength(0);
  });

  test("issues a short-lived token and audits a successful download", async () => {
    const value = setup({ pii: true });
    const token = await value.service.issueDownloadToken(
      auth(grant({ result_pii_export_allowed: true })),
      "80" as Id,
      "req-3",
    );
    expect(token).toMatchObject({
      token: "download-token",
      downloadPath: "/api/v1/integrations/agent/exports/80/download",
    });
    const download = await value.service.download(
      auth(grant({ result_pii_export_allowed: true })),
      "80" as Id,
      "download-token",
      "req-4",
    );
    expect(new TextDecoder().decode(download.body)).toContain("Budi");
    expect(value.audits).toEqual([
      "INTEGRATION_EXPORT_TOKEN_ISSUE",
      "INTEGRATION_EXPORT_DOWNLOAD",
    ]);
  });
});
