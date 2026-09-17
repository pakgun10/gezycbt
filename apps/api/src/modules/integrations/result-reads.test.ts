import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type IntegrationAuthentication,
  IntegrationCapabilityError,
  type IntegrationGrant,
} from "./domain";
import { IntegrationResultReadService } from "./result-reads";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function grant(capability: string): IntegrationGrant {
  return {
    id: "90" as Id,
    integrationClientId: "91" as Id,
    capability,
    scopeType: "SCHEDULE",
    scopeIds: ["70" as Id],
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
  };
}

function auth(capabilities: readonly string[]): IntegrationAuthentication {
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
      policyVersion: 1,
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
    grants: capabilities.map(grant),
  };
}

function setup(rows: readonly Record<string, unknown>[]) {
  let index = 0;
  const audits: string[] = [];
  const scopes: Record<string, unknown>[] = [];
  const database = {
    async query() {
      const row = rows[index];
      index += 1;
      return row ? [row] : [];
    },
    async execute() {
      return { affectedRows: 1 };
    },
    async transaction<T>(operation: (connection: never) => Promise<T>) {
      return operation(database as never);
    },
    async close() {},
  };
  const integration = {
    async assertCapability(
      authentication: IntegrationAuthentication,
      capability: string,
    ) {
      const found = authentication.grants.find(
        (item) => item.capability === capability,
      );
      if (!found) throw new IntegrationCapabilityError(capability);
      return found;
    },
    async assertResourceScope(
      _authentication: IntegrationAuthentication,
      _grant: IntegrationGrant,
      resource: Record<string, unknown>,
    ) {
      scopes.push(resource);
    },
    async recordAgentAudit(event: { action: string }) {
      audits.push(event.action);
    },
  };
  return {
    service: new IntegrationResultReadService({
      database: database as never,
      integration: integration as never,
    }),
    audits,
    scopes,
  };
}

const scheduleRow = {
  schedule_id: "70",
  mode: "PRACTICE",
  status: "CLOSED",
  exam_id: "60",
  title: "Latihan Matematika",
  subject_id: "30",
  owner_teacher_id: "40",
};

const resultRow = {
  id: "80",
  session_id: "81",
  schedule_id: "70",
  participant_id: null,
  correct_count: 7,
  incorrect_count: 2,
  unanswered_count: 1,
  earned_score: "7.00",
  max_score: "10.00",
  percentage: "70.00",
  scored_at: NOW,
  released_at: NOW,
  session_status: "SCORED",
  attempt_no: 1,
  participant_name_snapshot: "Budi",
  class_snapshot: "IX-A",
  institution_snapshot: "SMP 1",
  identity_extra_json: JSON.stringify({ nis: "123", ignored: 12 }),
  finalization_reason: "PARTICIPANT_SUBMIT",
};

describe("agent result reads", () => {
  test("practice result uses separate capability and exposes safe identity plus retry state", async () => {
    const value = setup([resultRow, scheduleRow]);
    const result = await value.service.getResult(
      auth(["results.read_practice"]),
      "81" as Id,
      "req-1",
    );
    expect(result).toMatchObject({
      id: "80",
      mode: "PRACTICE",
      identity: {
        name: "Budi",
        class: "IX-A",
        institution: "SMP 1",
        extra: { nis: "123" },
      },
      canRetry: false,
      canRetryReason: "SCHEDULE_CLOSED",
    });
    expect(result).not.toHaveProperty("participantId");
    expect(value.audits).toEqual(["INTEGRATION_RESULT_READ"]);
    expect(value.scopes).toEqual([
      { ownerUserId: "40", subjectId: "30", resourceId: "70" },
    ]);
  });

  test("summary is aggregate-only and does not create a PII result audit", async () => {
    const value = setup([
      scheduleRow,
      { status: "SCORED", count: 2 },
      { total: 2, released: 1 },
      { class_count: 1, participant_count: 20 },
    ]);
    const summary = await value.service.getScheduleSummary(
      auth(["results.read_practice"]),
      "70" as Id,
      "req-2",
    );
    expect(summary).toMatchObject({
      scheduleId: "70",
      targetParticipantCount: 20,
      sessions: { total: 2, scored: 2 },
      results: { total: 2, released: 1, unreleased: 1 },
    });
    expect(value.audits).toHaveLength(0);
  });

  test("main result list keeps participant ID and uses results.read", async () => {
    const mainSchedule = { ...scheduleRow, mode: "MAIN", status: "OPEN" };
    const mainResult = {
      ...resultRow,
      participant_id: "44",
      participant_name_snapshot: "Ani",
    };
    const value = setup([mainSchedule, mainResult]);
    const page = await value.service.listScheduleResults(
      auth(["results.read"]),
      "70" as Id,
      { limit: 20 },
      "req-3",
    );
    expect(page.items[0]).toMatchObject({
      mode: "MAIN",
      participantId: "44",
      participantName: "Ani",
    });
    expect(page.items[0]).not.toHaveProperty("identity");
    expect(page.nextCursor).toBeNull();
    expect(value.audits).toEqual(["INTEGRATION_RESULT_LIST"]);
  });
});
