import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import { canonicalJson, IntegrationActionService } from "./action-service";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const FUTURE = "2099-09-17T00:00:00.000Z" as UtcTimestamp;

function grant(capability = "exams.publish"): IntegrationGrant {
  return {
    id: "10" as Id,
    integrationClientId: "20" as Id,
    capability,
    scopeType: "EXAM",
    scopeIds: ["30" as Id],
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
  };
}

function auth(capability = "exams.publish"): IntegrationAuthentication {
  return {
    client: {
      id: "20" as Id,
      name: "Agent",
      platformHint: "HIVEKEEP",
      ownerUserId: "1" as Id,
      ownerDisplayName: "Admin",
      ownerRole: "ADMIN",
      status: "ACTIVE",
      description: null,
      policyVersion: 4,
      createdByUserId: "1" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "21" as Id,
      integrationClientId: "20" as Id,
      tokenPrefix: "prefix",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: [grant(capability)],
  };
}

function setup(
  capability = "exams.publish",
  extraExecutor: Record<string, unknown> = {},
) {
  const statements: { sql: string; parameters: readonly unknown[] }[] = [];
  const actionRows = new Map<string, Record<string, unknown>>();
  const idempotencyRows = new Map<string, Record<string, unknown>>();
  let actionId = 300n;
  const database = {
    async query<T extends Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<readonly T[]> {
      if (sql.includes("FROM exam_revisions"))
        return [
          {
            id: "30",
            updated_at: NOW,
            exam_id: "31",
            subject_id: "40",
            owner_teacher_id: "1",
            question_count: 2,
          },
        ] as unknown as T[];
      if (sql.includes("FROM users"))
        return [{ status: "ACTIVE", role: "ADMIN" }] as unknown as T[];
      if (sql.includes("FROM exam_schedules"))
        return [
          {
            id: "70",
            updated_at: NOW,
            status: "ACTIVE",
            subject_id: "40",
            owner_teacher_id: "1",
            active_sessions: 1,
            result_count: 2,
          },
        ] as unknown as T[];
      if (
        sql.includes("FROM agent_action_requests") &&
        sql.includes("WHERE id = ?")
      ) {
        const row = actionRows.get(String(parameters[0]));
        return row ? ([row] as unknown as T[]) : [];
      }
      if (sql.includes("FROM integration_idempotency_keys")) {
        const row = idempotencyRows.get(String(parameters[1]));
        return row ? ([row] as unknown as T[]) : [];
      }
      return [] as T[];
    },
    async execute(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<{ affectedRows: number; insertId?: bigint }> {
      statements.push({ sql, parameters });
      if (sql.startsWith("INSERT INTO agent_action_requests")) {
        const id = String(actionId++);
        actionRows.set(id, {
          id,
          integration_client_id: parameters[0],
          owner_user_id: parameters[1],
          capability: parameters[2],
          operation: parameters[3],
          target_type: parameters[4],
          target_id: parameters[5],
          normalized_plan: parameters[6],
          plan_hash: parameters[7],
          risk_level: parameters[8],
          expected_versions_json: parameters[9],
          grant_version: parameters[10],
          status: parameters[11],
          approval_method: parameters[12],
          expires_at: FUTURE,
          created_at: NOW,
          updated_at: NOW,
          executed_at: null,
          result_json: null,
          error_code: null,
        });
        return { affectedRows: 1, insertId: BigInt(id) };
      }
      if (sql.startsWith("INSERT INTO integration_idempotency_keys")) {
        idempotencyRows.set(String(parameters[1]), {
          id: String(parameters[1]),
          request_hash: parameters[2],
          status: "PROCESSING",
          response_json: null,
          expires_at: FUTURE,
        });
        return { affectedRows: 1 };
      }
      if (sql.startsWith("UPDATE integration_idempotency_keys")) {
        const row = idempotencyRows.get(String(parameters[2]));
        if (row) {
          row.status = "COMPLETED";
          row.response_json = parameters[0];
        }
        return { affectedRows: 1 };
      }
      if (sql.includes("SET status = 'SUCCEEDED'")) {
        const id = String(parameters.at(-1));
        const row = actionRows.get(id);
        if (row?.status === "EXECUTING") {
          row.status = "SUCCEEDED";
          row.result_json = JSON.stringify({ published: true });
          row.executed_at = NOW;
          row.updated_at = NOW;
          return { affectedRows: 1 };
        }
        return { affectedRows: 0 };
      }
      if (sql.includes("SET status = 'EXECUTING'")) {
        const id = String(parameters[0]);
        const row = actionRows.get(id);
        const canClaim =
          row?.status === "AWAITING_CONFIRMATION" ||
          row?.status === "AWAITING_APPROVAL";
        if (canClaim && row) {
          row.status = "EXECUTING";
          return { affectedRows: 1 };
        }
        return { affectedRows: 0 };
      }
      return { affectedRows: 1 };
    },
    async transaction<T>(
      operation: (connection: never) => Promise<T>,
    ): Promise<T> {
      return operation(database as never);
    },
    async close() {},
  };
  const audits: string[] = [];
  const executed: string[] = [];
  const integration = {
    async assertCapability() {
      return grant(capability);
    },
    async assertResourceScope() {},
    grantUsable() {
      return true;
    },
    async findClient() {
      return auth().client;
    },
    async listGrants() {
      return [grant(capability)];
    },
    async recordAgentAudit(event: { action: string }) {
      audits.push(event.action);
    },
  };
  const service = new IntegrationActionService({
    database: database as never,
    integration: integration as never,
    executor: {
      async publishExam() {
        executed.push("publish");
        return { published: true };
      },
      ...extraExecutor,
    },
  });
  return { service, statements, audits, executed };
}

describe("integration action service", () => {
  test("canonical plan JSON is stable and sorts nested object keys", () => {
    expect(canonicalJson({ z: 1, a: { b: true, a: "x" }, list: [2, 1] })).toBe(
      '{"a":{"a":"x","b":true},"list":[2,1],"z":1}',
    );
  });

  test("prepares an exact plan and confirms it once", async () => {
    const value = setup();
    const prepared = await value.service.prepare(
      auth(),
      {
        operation: "exams.publish",
        targetType: "exam_revision",
        targetId: "30" as Id,
      },
      "req-prepare",
      "action-idempotency-001",
    );
    expect(prepared).toMatchObject({
      status: "AWAITING_CONFIRMATION",
      operation: "exams.publish",
      riskLevel: "R2",
      approvalMethod: "AGENT_CONFIRM",
    });
    expect(prepared.planHash).toHaveLength(64);
    const replay = await value.service.prepare(
      auth(),
      {
        operation: "exams.publish",
        targetType: "exam_revision",
        targetId: "30" as Id,
      },
      "req-prepare-replay",
      "action-idempotency-001",
    );
    expect(replay.id).toBe(prepared.id);
    expect(replay.status).toBe("AWAITING_CONFIRMATION");
    const confirmed = await value.service.confirm(
      auth(),
      prepared.id,
      prepared.planHash,
      "req-confirm",
      "action-confirmation-001",
    );
    expect(confirmed.status).toBe("SUCCEEDED");
    expect(value.executed).toEqual(["publish"]);
    expect(value.audits).toContain("INTEGRATION_ACTION_PREPARE");
    expect(value.audits).toContain("INTEGRATION_ACTION_SUCCESS");
  });

  test("rejects a changed plan hash before execution", async () => {
    const value = setup();
    const prepared = await value.service.prepare(
      auth(),
      {
        operation: "exams.publish",
        targetType: "exam_revision",
        targetId: "30" as Id,
      },
      "req-prepare-2",
      "action-idempotency-002",
    );
    await expect(
      value.service.confirm(
        auth(),
        prepared.id,
        "0".repeat(64),
        "req-confirm-2",
        "action-confirmation-002",
      ),
    ).rejects.toThrow("ACTION_PLAN_MISMATCH");
    expect(value.executed).toHaveLength(0);
  });

  test("compare-and-set allows only one concurrent confirmation to execute", async () => {
    const value = setup();
    const prepared = await value.service.prepare(
      auth(),
      {
        operation: "exams.publish",
        targetType: "exam_revision",
        targetId: "30" as Id,
      },
      "req-prepare-race",
      "action-race-prepare-001",
    );
    const outcomes = await Promise.allSettled([
      value.service.confirm(
        auth(),
        prepared.id,
        prepared.planHash,
        "req-confirm-race-a",
        "action-race-confirm-a",
      ),
      value.service.confirm(
        auth(),
        prepared.id,
        prepared.planHash,
        "req-confirm-race-b",
        "action-race-confirm-b",
      ),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    expect(value.executed).toEqual(["publish"]);
  });

  test("R3 action cannot be agent-confirmed and executes the callback only after web approval", async () => {
    const value = setup("schedules.close", {
      async closeSchedule() {
        value.executed.push("close-schedule");
        return { closed: true };
      },
    });
    const prepared = await value.service.prepare(
      auth("schedules.close"),
      {
        operation: "schedules.close",
        targetType: "schedule",
        targetId: "70" as Id,
        parameters: { reason: "Penutupan terjadwal" },
      },
      "req-prepare-r3",
      "action-r3-prepare-001",
    );
    expect(prepared).toMatchObject({
      status: "AWAITING_APPROVAL",
      approvalMethod: "WEB_APPROVAL",
      riskLevel: "R3",
    });
    await expect(
      value.service.confirm(
        auth("schedules.close"),
        prepared.id,
        prepared.planHash,
        "req-confirm-r3",
        "action-r3-confirm-001",
      ),
    ).rejects.toThrow("ACTION_APPROVAL_REQUIRED");
    const approved = await value.service.approve(
      prepared.id,
      prepared.planHash,
      "1" as Id,
      "req-approve-r3",
      "action-r3-approve-001",
    );
    expect(approved.status).toBe("SUCCEEDED");
    expect(value.executed).toEqual(["close-schedule"]);
  });
});
