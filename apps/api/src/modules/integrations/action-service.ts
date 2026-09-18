import {
  formatUtcTimestamp,
  type Id,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import type {
  ActorContext,
  UseCaseContext,
} from "../../application/actor-context";
import type { IntegrationAuthentication, IntegrationGrant } from "./domain";
import type { IntegrationService } from "./service";

export const AGENT_ACTION_OPERATIONS = [
  "exams.publish",
  "results.release",
  "results.unrelease",
  "schedules.close",
  "sessions.extend_time",
  "sessions.end",
  "sessions.reset_attempt",
  "users.disable",
] as const;
export type AgentActionOperation = (typeof AGENT_ACTION_OPERATIONS)[number];

export const AGENT_ACTION_TARGET_TYPES = [
  "exam_revision",
  "schedule",
  "session",
  "result",
  "user",
] as const;
export type AgentActionTargetType = (typeof AGENT_ACTION_TARGET_TYPES)[number];

export const AGENT_ACTION_RISK_LEVELS = ["R0", "R1", "R2", "R3", "R4"] as const;
export type AgentActionRiskLevel = (typeof AGENT_ACTION_RISK_LEVELS)[number];

export const AGENT_ACTION_STATUSES = [
  "AWAITING_CONFIRMATION",
  "AWAITING_APPROVAL",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export const AGENT_ACTION_APPROVAL_METHODS = [
  "NONE",
  "AGENT_CONFIRM",
  "WEB_APPROVAL",
] as const;
export type AgentActionApprovalMethod =
  (typeof AGENT_ACTION_APPROVAL_METHODS)[number];

export interface AgentActionPrepareInput {
  readonly operation: AgentActionOperation;
  readonly targetType: AgentActionTargetType;
  readonly targetId: Id;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface AgentActionExecutionContext {
  readonly actionId: Id;
  readonly authentication: IntegrationAuthentication;
  readonly useCase: UseCaseContext;
  readonly plan: Readonly<Record<string, unknown>>;
}

export interface AgentActionExecutor {
  readonly publishExam?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
  readonly releaseResults?: (
    context: AgentActionExecutionContext,
    release: boolean,
  ) => Promise<unknown>;
  readonly closeSchedule?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
  readonly extendTime?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
  readonly endSession?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
  readonly resetAttempt?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
  readonly disableUser?: (
    context: AgentActionExecutionContext,
  ) => Promise<unknown>;
}

export interface AgentActionView {
  readonly id: Id;
  readonly clientId: Id;
  readonly ownerUserId: Id;
  readonly capability: string;
  readonly operation: AgentActionOperation;
  readonly targetType: AgentActionTargetType;
  readonly targetId: Id;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly planHash: string;
  readonly riskLevel: AgentActionRiskLevel;
  readonly expectedVersions: Readonly<Record<string, unknown>>;
  readonly grantVersion: number;
  readonly status: AgentActionStatus;
  readonly approvalMethod: AgentActionApprovalMethod;
  readonly expiresAt: UtcTimestamp;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly executedAt: UtcTimestamp | null;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
}

interface AgentActionRecord extends AgentActionView {
  readonly planBytes: Uint8Array;
}

interface ActionRow extends Record<string, unknown> {}

export class AgentActionNotFoundError extends Error {
  constructor() {
    super("Action request was not found");
    this.name = "AgentActionNotFoundError";
  }
}

export class AgentActionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentActionValidationError";
  }
}

export class AgentActionConflictError extends Error {
  constructor(code = "ACTION_NOT_CONFIRMABLE") {
    super(code);
    this.name = "AgentActionConflictError";
    this.code = code;
  }

  readonly code: string;
}

export class AgentActionPlanMismatchError extends AgentActionConflictError {
  constructor() {
    super("ACTION_PLAN_MISMATCH");
    this.name = "AgentActionPlanMismatchError";
  }
}

export class AgentActionGrantChangedError extends AgentActionConflictError {
  constructor() {
    super("ACTION_GRANT_CHANGED");
    this.name = "AgentActionGrantChangedError";
  }
}

export class AgentActionApprovalRequiredError extends AgentActionConflictError {
  constructor() {
    super("ACTION_APPROVAL_REQUIRED");
    this.name = "AgentActionApprovalRequiredError";
  }
}

export class AgentActionExpiredError extends AgentActionConflictError {
  constructor() {
    super("ACTION_EXPIRED");
    this.name = "AgentActionExpiredError";
  }
}

export class AgentActionExecutionError extends AgentActionConflictError {
  constructor(code = "ACTION_EXECUTION_FAILED") {
    super(code);
    this.name = "AgentActionExecutionError";
  }
}

const CAPABILITY_BY_OPERATION: Readonly<Record<AgentActionOperation, string>> =
  {
    "exams.publish": "exams.publish",
    "results.release": "results.release",
    "results.unrelease": "results.unrelease",
    "schedules.close": "schedules.close",
    "sessions.extend_time": "sessions.extend_time",
    "sessions.end": "sessions.end",
    "sessions.reset_attempt": "sessions.reset_attempt",
    "users.disable": "users.disable",
  };

const RISK_BY_OPERATION: Readonly<
  Record<AgentActionOperation, AgentActionRiskLevel>
> = {
  "exams.publish": "R2",
  "results.release": "R3",
  "results.unrelease": "R3",
  "schedules.close": "R3",
  "sessions.extend_time": "R3",
  "sessions.end": "R3",
  "sessions.reset_attempt": "R3",
  "users.disable": "R3",
};

/**
 * Durable prepare/confirm boundary. It validates a target and freezes the
 * exact plan before any domain mutation is allowed to run.
 */
export class IntegrationActionService {
  constructor(
    private readonly options: {
      readonly database: DatabasePort;
      readonly integration: IntegrationService;
      readonly executor?: AgentActionExecutor;
    },
  ) {}

  async prepare(
    authentication: IntegrationAuthentication,
    input: AgentActionPrepareInput,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentActionView> {
    const normalized = await this.preparePlan(authentication, input, requestId);
    const requestHash = await sha256Bytes(
      canonicalJson({
        operation: normalized.operation,
        targetType: normalized.targetType,
        targetId: normalized.targetId,
        parameters: normalized.parameters,
      }),
    );
    const result = await this.options.database.transaction(
      async (connection) => {
        const existingRows = await connection.query<ActionRow>(
          `SELECT id, request_hash, status, response_json, expires_at
         FROM integration_idempotency_keys
         WHERE integration_client_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`,
          [authentication.client.id, idempotencyKey],
        );
        const existing = existingRows[0];
        if (existing) {
          if (existing.expires_at && !isFuture(existing.expires_at)) {
            await connection.execute(
              "DELETE FROM integration_idempotency_keys WHERE id = ?",
              [existing.id],
            );
          } else {
            if (!bytesEqual(existing.request_hash, requestHash))
              throw new AgentActionConflictError("IDEMPOTENCY_CONFLICT");
            if (String(existing.status) === "COMPLETED") {
              const replay = parseStoredView(existing.response_json);
              if (replay) return { record: replay, created: false };
            }
            throw new AgentActionConflictError("IDEMPOTENCY_IN_PROGRESS");
          }
        }
        await connection.execute(
          `INSERT INTO integration_idempotency_keys
          (integration_client_id, idempotency_key, request_hash, status, expires_at)
         VALUES (?, ?, ?, 'PROCESSING', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY))`,
          [authentication.client.id, idempotencyKey, requestHash],
        );
        const inserted = await connection.execute(
          `INSERT INTO agent_action_requests
          (integration_client_id, owner_user_id, capability, operation,
           target_type, target_id, normalized_plan, plan_hash, risk_level,
           expected_versions_json, grant_version, status, approval_method,
           expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE))`,
          [
            authentication.client.id,
            authentication.client.ownerUserId,
            normalized.capability,
            normalized.operation,
            normalized.targetType,
            normalized.targetId,
            canonicalJson(normalized.plan),
            normalized.planHash,
            normalized.riskLevel,
            canonicalJson(normalized.expectedVersions),
            normalized.grantVersion,
            normalized.status,
            normalized.approvalMethod,
          ],
        );
        if (inserted.insertId === undefined)
          throw new Error("Action insert did not return an ID");
        const record = await this.readAction(
          connection,
          String(inserted.insertId) as Id,
        );
        if (!record) throw new Error("Action could not be read back");
        await connection.execute(
          `UPDATE integration_idempotency_keys
         SET status = 'COMPLETED', response_json = ?, completed_at = UTC_TIMESTAMP(6)
         WHERE integration_client_id = ? AND idempotency_key = ?`,
          [
            JSON.stringify(toView(record)),
            authentication.client.id,
            idempotencyKey,
          ],
        );
        return { record, created: true };
      },
    );
    await this.audit(
      authentication,
      result.record,
      requestId,
      result.created
        ? "INTEGRATION_ACTION_PREPARE"
        : "INTEGRATION_ACTION_REPLAY",
      { replayed: !result.created },
    );
    return toView(result.record);
  }

  async list(
    authentication: IntegrationAuthentication,
    options: {
      readonly status?: AgentActionStatus;
      readonly cursor?: Id;
      readonly limit: number;
    },
  ): Promise<{
    readonly items: readonly AgentActionView[];
    readonly nextCursor: Id | null;
  }> {
    const limit = boundedLimit(options.limit);
    const where = ["integration_client_id = ?"];
    const parameters: unknown[] = [authentication.client.id];
    if (options.status) {
      where.push("status = ?");
      parameters.push(options.status);
    }
    if (options.cursor) {
      where.push("id < ?");
      parameters.push(options.cursor);
    }
    parameters.push(limit + 1);
    await this.cancelInvalidPending();
    await this.expirePending(authentication.client.id);
    const rows = await this.options.database.query<ActionRow>(
      `SELECT * FROM agent_action_requests WHERE ${where.join(" AND ")}
       ORDER BY id DESC LIMIT ?`,
      parameters,
    );
    const records = rows.map(mapActionRow);
    return {
      items: records.slice(0, limit).map(toView),
      nextCursor: rows.length > limit ? requiredId(rows[limit]?.id) : null,
    };
  }

  async get(
    authentication: IntegrationAuthentication,
    actionId: Id,
  ): Promise<AgentActionView> {
    await this.expirePendingForAction(actionId, authentication.client.id);
    const record = await this.readAction(this.options.database, actionId);
    if (!record || record.clientId !== authentication.client.id)
      throw new AgentActionNotFoundError();
    return toView(record);
  }

  async cancel(
    authentication: IntegrationAuthentication,
    actionId: Id,
    requestId: string,
  ): Promise<AgentActionView> {
    const record = await this.readAction(this.options.database, actionId);
    if (!record || record.clientId !== authentication.client.id)
      throw new AgentActionNotFoundError();
    if (!isPending(record.status)) return toView(record);
    await this.options.database.execute(
      `UPDATE agent_action_requests SET status = 'CANCELLED', updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND integration_client_id = ?
         AND status IN ('AWAITING_CONFIRMATION', 'AWAITING_APPROVAL')`,
      [actionId, authentication.client.id],
    );
    const updated = await this.readAction(this.options.database, actionId);
    if (!updated) throw new AgentActionNotFoundError();
    await this.audit(
      authentication,
      updated,
      requestId,
      "INTEGRATION_ACTION_CANCEL",
      {},
    );
    return toView(updated);
  }

  async confirm(
    authentication: IntegrationAuthentication,
    actionId: Id,
    planHash: string,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentActionView> {
    const record = await this.readAction(this.options.database, actionId);
    if (!record || record.clientId !== authentication.client.id)
      throw new AgentActionNotFoundError();
    if (!isFuture(record.expiresAt)) {
      await this.expirePendingForAction(actionId, authentication.client.id);
      throw new AgentActionExpiredError();
    }
    if (!constantTimeHexEqual(record.planHash, planHash))
      throw new AgentActionPlanMismatchError();
    if (record.approvalMethod === "WEB_APPROVAL")
      throw new AgentActionApprovalRequiredError();
    if (record.status === "SUCCEEDED") return toView(record);
    if (record.status !== "AWAITING_CONFIRMATION")
      throw new AgentActionConflictError(record.status);
    const grant = await this.options.integration.assertCapability(
      authentication,
      record.capability,
      requestId,
    );
    await this.assertCurrentGrantAndScope(authentication, grant, record);
    const claimed = await this.options.database.execute(
      `UPDATE agent_action_requests SET status = 'EXECUTING', updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND integration_client_id = ? AND status = 'AWAITING_CONFIRMATION'
         AND expires_at > UTC_TIMESTAMP(6)`,
      [actionId, authentication.client.id],
    );
    if (claimed.affectedRows !== 1) {
      const latest = await this.readAction(this.options.database, actionId);
      if (latest?.status === "SUCCEEDED") return toView(latest);
      throw new AgentActionConflictError(
        latest?.status ?? "ACTION_NOT_CONFIRMABLE",
      );
    }
    return this.executeClaimed(
      authentication,
      record,
      requestId,
      idempotencyKey,
      "AGENT_CONFIRM",
    );
  }

  async listForAdmin(options: {
    readonly status?: AgentActionStatus;
    readonly clientId?: Id;
    readonly cursor?: Id;
    readonly limit: number;
  }): Promise<{
    readonly items: readonly AgentActionView[];
    readonly nextCursor: Id | null;
  }> {
    const limit = boundedLimit(options.limit);
    await this.cancelInvalidPending();
    const where: string[] = [];
    const parameters: unknown[] = [];
    if (options.status) {
      where.push("status = ?");
      parameters.push(options.status);
    }
    if (options.clientId) {
      where.push("integration_client_id = ?");
      parameters.push(options.clientId);
    }
    if (options.cursor) {
      where.push("id < ?");
      parameters.push(options.cursor);
    }
    parameters.push(limit + 1);
    const rows = await this.options.database.query<ActionRow>(
      `SELECT * FROM agent_action_requests${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
       ORDER BY id DESC LIMIT ?`,
      parameters,
    );
    return {
      items: rows.slice(0, limit).map((row) => toView(mapActionRow(row))),
      nextCursor: rows.length > limit ? requiredId(rows[limit]?.id) : null,
    };
  }

  async getForAdmin(actionId: Id): Promise<AgentActionView> {
    await this.expirePendingForAction(actionId);
    const record = await this.readAction(this.options.database, actionId);
    if (!record) throw new AgentActionNotFoundError();
    return toView(record);
  }

  async approve(
    actionId: Id,
    planHash: string,
    adminUserId: Id,
    requestId: string,
    idempotencyKey: string,
  ): Promise<AgentActionView> {
    const record = await this.readAction(this.options.database, actionId);
    if (!record) throw new AgentActionNotFoundError();
    if (record.approvalMethod !== "WEB_APPROVAL")
      throw new AgentActionConflictError(
        "ACTION_DOES_NOT_REQUIRE_WEB_APPROVAL",
      );
    if (!isFuture(record.expiresAt)) {
      await this.expirePendingForAction(actionId);
      throw new AgentActionExpiredError();
    }
    if (!constantTimeHexEqual(record.planHash, planHash))
      throw new AgentActionPlanMismatchError();
    if (record.status === "SUCCEEDED") return toView(record);
    if (record.status !== "AWAITING_APPROVAL")
      throw new AgentActionConflictError(record.status);
    const authorization = await this.currentClientAuthorization(
      record.clientId,
      record.capability,
    );
    await this.assertCurrentGrantAndScope(
      authorization.authentication,
      authorization.grant,
      record,
    );
    const claimed = await this.options.database.transaction(
      async (connection) => {
        const updated = await connection.execute(
          `UPDATE agent_action_requests SET status = 'EXECUTING', updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'AWAITING_APPROVAL' AND expires_at > UTC_TIMESTAMP(6)`,
          [actionId],
        );
        if (updated.affectedRows !== 1) return false;
        await connection.execute(
          `INSERT INTO agent_action_approvals
          (action_request_id, approved_by_user_id, approval_source, plan_hash, outcome)
         VALUES (?, ?, 'WEB', ?, 'APPROVED')`,
          [actionId, adminUserId, record.planBytes],
        );
        return true;
      },
    );
    if (!claimed) {
      const latest = await this.readAction(this.options.database, actionId);
      if (latest?.status === "SUCCEEDED") return toView(latest);
      throw new AgentActionConflictError(
        latest?.status ?? "ACTION_NOT_CONFIRMABLE",
      );
    }
    return this.executeClaimed(
      authorization.authentication,
      record,
      requestId,
      idempotencyKey,
      "WEB",
      adminUserId,
    );
  }

  private async executeClaimed(
    authentication: IntegrationAuthentication,
    record: AgentActionRecord,
    requestId: string,
    idempotencyKey: string,
    approvalSource: "AGENT_CONFIRM" | "WEB",
    approverUserId?: Id,
  ): Promise<AgentActionView> {
    const actor: ActorContext = {
      actorType: approverUserId ? "HUMAN" : "EXTERNAL_AGENT",
      userId: approverUserId ?? authentication.client.ownerUserId,
      role: approverUserId ? "ADMIN" : authentication.client.ownerRole,
      active: true,
      ...(approverUserId
        ? {}
        : { integrationClientId: authentication.client.id }),
      requestId,
    };
    const useCase: UseCaseContext = { actor, idempotencyKey };
    let output: unknown;
    try {
      output = await this.executeOperation(record, authentication, useCase);
    } catch (error) {
      const code =
        error instanceof AgentActionExecutionError
          ? error.code
          : "ACTION_EXECUTION_FAILED";
      await this.options.database.execute(
        `UPDATE agent_action_requests
         SET status = 'FAILED', error_code = ?, updated_at = UTC_TIMESTAMP(6), executed_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'EXECUTING'`,
        [code, record.id],
      );
      const failed = await this.readAction(this.options.database, record.id);
      if (!failed) throw new AgentActionNotFoundError();
      await this.audit(
        authentication,
        failed,
        requestId,
        "INTEGRATION_ACTION_FAILED",
        { errorCode: code },
      );
      throw new AgentActionExecutionError(code);
    }
    const result = redactAgentResult(output);
    await this.options.database.transaction(async (connection) => {
      await connection.execute(
        `UPDATE agent_action_requests
         SET status = 'SUCCEEDED', result_json = ?, updated_at = UTC_TIMESTAMP(6), executed_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'EXECUTING'`,
        [JSON.stringify(result), record.id],
      );
      if (approvalSource === "WEB") {
        await connection.execute(
          `UPDATE agent_action_approvals
           SET consumed_at = UTC_TIMESTAMP(6)
           WHERE action_request_id = ? AND approval_source = 'WEB'
             AND consumed_at IS NULL AND outcome = 'APPROVED'`,
          [record.id],
        );
      } else {
        await connection.execute(
          `INSERT INTO agent_action_approvals
            (action_request_id, approved_by_user_id, approval_source, plan_hash, outcome, consumed_at)
           VALUES (?, NULL, 'AGENT_CONFIRM', ?, 'APPROVED', UTC_TIMESTAMP(6))`,
          [record.id, record.planBytes],
        );
      }
    });
    const succeeded = await this.readAction(this.options.database, record.id);
    if (!succeeded) throw new AgentActionNotFoundError();
    await this.audit(
      authentication,
      succeeded,
      requestId,
      "INTEGRATION_ACTION_SUCCESS",
      {
        approvalSource,
      },
    );
    return toView(succeeded);
  }

  private async executeOperation(
    record: AgentActionRecord,
    authentication: IntegrationAuthentication,
    useCase: UseCaseContext,
  ): Promise<unknown> {
    const context: AgentActionExecutionContext = {
      actionId: record.id,
      authentication,
      useCase,
      plan: record.plan,
    };
    const executor = this.options.executor;
    if (
      record.operation === "results.release" ||
      record.operation === "results.unrelease"
    ) {
      if (!executor?.releaseResults)
        throw new AgentActionExecutionError("ACTION_EXECUTOR_UNAVAILABLE");
      return executor.releaseResults(
        context,
        record.operation === "results.release",
      );
    }
    const callback:
      | ((context: AgentActionExecutionContext) => Promise<unknown>)
      | undefined =
      record.operation === "exams.publish"
        ? executor?.publishExam
        : record.operation === "schedules.close"
          ? executor?.closeSchedule
          : record.operation === "sessions.extend_time"
            ? executor?.extendTime
            : record.operation === "sessions.end"
              ? executor?.endSession
              : record.operation === "sessions.reset_attempt"
                ? executor?.resetAttempt
                : executor?.disableUser;
    if (!callback)
      throw new AgentActionExecutionError("ACTION_EXECUTOR_UNAVAILABLE");
    return callback(context);
  }

  private async preparePlan(
    authentication: IntegrationAuthentication,
    input: AgentActionPrepareInput,
    requestId: string,
  ): Promise<{
    readonly operation: AgentActionOperation;
    readonly targetType: AgentActionTargetType;
    readonly targetId: Id;
    readonly capability: string;
    readonly riskLevel: AgentActionRiskLevel;
    readonly approvalMethod: AgentActionApprovalMethod;
    readonly grantVersion: number;
    readonly expectedVersions: Readonly<Record<string, unknown>>;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly plan: Readonly<Record<string, unknown>>;
    readonly planHash: Uint8Array;
    readonly status: AgentActionStatus;
  }> {
    if (!AGENT_ACTION_OPERATIONS.includes(input.operation))
      throw new AgentActionValidationError("Operation tidak didukung.");
    if (!AGENT_ACTION_TARGET_TYPES.includes(input.targetType))
      throw new AgentActionValidationError("Target type tidak didukung.");
    const targetId = requiredId(input.targetId);
    const capability = CAPABILITY_BY_OPERATION[input.operation];
    const grant = await this.options.integration.assertCapability(
      authentication,
      capability,
      requestId,
    );
    const target = await this.readTarget(input.targetType, targetId);
    if (!target) throw new AgentActionNotFoundError();
    await this.options.integration.assertResourceScope(
      authentication,
      grant,
      scopeResource(target),
    );
    const parameters = normalizeParameters(
      input.operation,
      input.parameters,
      target,
    );
    enforceConstraints(grant, input.operation, target, parameters);
    const riskLevel = RISK_BY_OPERATION[input.operation];
    const approvalMethod: AgentActionApprovalMethod =
      riskLevel === "R3" ? "WEB_APPROVAL" : "AGENT_CONFIRM";
    const expectedVersions = target.expectedVersions;
    const plan: Readonly<Record<string, unknown>> = {
      capability,
      operation: input.operation,
      target: { type: input.targetType, id: targetId },
      expectedVersions,
      parameters,
      impact: target.impact,
      riskLevel,
      approvalMethod,
      clientId: authentication.client.id,
      ownerUserId: authentication.client.ownerUserId,
      grantVersion: grant.grantVersion,
    };
    const planHash = await sha256Bytes(canonicalJson(plan));
    return {
      operation: input.operation,
      targetType: input.targetType,
      targetId,
      capability,
      riskLevel,
      approvalMethod,
      grantVersion: grant.grantVersion,
      expectedVersions,
      parameters,
      plan,
      planHash,
      status:
        approvalMethod === "WEB_APPROVAL"
          ? "AWAITING_APPROVAL"
          : "AWAITING_CONFIRMATION",
    };
  }

  private async readTarget(
    targetType: AgentActionTargetType,
    targetId: Id,
  ): Promise<{
    readonly ownerUserId?: Id;
    readonly subjectId?: Id;
    readonly resourceId: Id;
    readonly scopeResourceId?: Id;
    readonly expectedVersions: Readonly<Record<string, unknown>>;
    readonly impact: Readonly<Record<string, unknown>>;
    readonly status?: string;
    readonly participantId?: Id | null;
    readonly scheduleId?: Id;
  } | null> {
    if (targetType === "user") {
      const rows = await this.options.database.query<ActionRow>(
        "SELECT id, updated_at, status, display_name, role FROM users WHERE id = ? LIMIT 1",
        [targetId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        resourceId: targetId,
        scopeResourceId: targetId,
        expectedVersions: { updatedAt: isoValue(row.updated_at) },
        impact: {
          userId: targetId,
          displayName: String(row.display_name),
          role: String(row.role),
          status: String(row.status),
        },
        status: String(row.status),
      };
    }
    if (targetType === "schedule") {
      const rows = await this.options.database.query<ActionRow>(
        `SELECT es.id, es.updated_at, es.status, e.subject_id, e.owner_teacher_id,
                (SELECT COUNT(*) FROM exam_sessions s WHERE s.schedule_id = es.id AND s.status = 'ACTIVE') AS active_sessions,
                (SELECT COUNT(*) FROM exam_results r WHERE r.schedule_id = es.id) AS result_count
         FROM exam_schedules es
         JOIN exam_revisions er ON er.id = es.exam_revision_id
         JOIN exams e ON e.id = er.exam_id
         WHERE es.id = ? LIMIT 1`,
        [targetId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        resourceId: targetId,
        scopeResourceId: targetId,
        ownerUserId: String(row.owner_teacher_id) as Id,
        subjectId: String(row.subject_id) as Id,
        expectedVersions: { updatedAt: isoValue(row.updated_at) },
        impact: {
          scheduleId: targetId,
          status: String(row.status),
          activeSessionCount: toNumber(row.active_sessions),
          resultCount: toNumber(row.result_count),
        },
        status: String(row.status),
        scheduleId: targetId,
      };
    }
    if (targetType === "session") {
      const rows = await this.options.database.query<ActionRow>(
        `SELECT s.id, s.schedule_id, s.participant_id, s.version, s.status,
                s.participant_name_snapshot, s.deadline_at,
                es.updated_at AS schedule_updated_at, e.subject_id, e.owner_teacher_id
         FROM exam_sessions s
         JOIN exam_schedules es ON es.id = s.schedule_id
         JOIN exam_revisions er ON er.id = es.exam_revision_id
         JOIN exams e ON e.id = er.exam_id
         WHERE s.id = ? LIMIT 1`,
        [targetId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        resourceId: targetId,
        scopeResourceId: String(row.schedule_id) as Id,
        ownerUserId: String(row.owner_teacher_id) as Id,
        subjectId: String(row.subject_id) as Id,
        expectedVersions: { version: toNumber(row.version) },
        impact: {
          sessionId: targetId,
          scheduleId: String(row.schedule_id),
          participantId:
            row.participant_id == null ? null : String(row.participant_id),
          participantName: String(row.participant_name_snapshot ?? ""),
          status: String(row.status),
          deadlineAt: isoValue(row.deadline_at),
        },
        status: String(row.status),
        participantId:
          row.participant_id == null
            ? null
            : (String(row.participant_id) as Id),
        scheduleId: String(row.schedule_id) as Id,
      };
    }
    if (targetType === "result") {
      const rows = await this.options.database.query<ActionRow>(
        `SELECT r.id, r.schedule_id, r.released_at, s.participant_id,
                s.participant_name_snapshot, es.updated_at AS schedule_updated_at,
                e.subject_id, e.owner_teacher_id
         FROM exam_results r
         JOIN exam_sessions s ON s.id = r.session_id
         JOIN exam_schedules es ON es.id = r.schedule_id
         JOIN exam_revisions er ON er.id = es.exam_revision_id
         JOIN exams e ON e.id = er.exam_id
         WHERE r.id = ? LIMIT 1`,
        [targetId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        resourceId: targetId,
        scopeResourceId: String(row.schedule_id) as Id,
        ownerUserId: String(row.owner_teacher_id) as Id,
        subjectId: String(row.subject_id) as Id,
        expectedVersions: {
          scheduleUpdatedAt: isoValue(row.schedule_updated_at),
        },
        impact: {
          resultId: targetId,
          scheduleId: String(row.schedule_id),
          participantName: String(row.participant_name_snapshot ?? ""),
          released: row.released_at !== null && row.released_at !== undefined,
        },
        scheduleId: String(row.schedule_id) as Id,
      };
    }
    const rows = await this.options.database.query<ActionRow>(
      `SELECT er.id, er.updated_at, er.exam_id, e.subject_id, e.owner_teacher_id,
              COUNT(eq.id) AS question_count
       FROM exam_revisions er
       JOIN exams e ON e.id = er.exam_id
       LEFT JOIN exam_questions eq ON eq.exam_revision_id = er.id
       WHERE er.id = ? GROUP BY er.id, er.updated_at, er.exam_id, e.subject_id, e.owner_teacher_id LIMIT 1`,
      [targetId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      resourceId: targetId,
      scopeResourceId: String(row.exam_id) as Id,
      ownerUserId: String(row.owner_teacher_id) as Id,
      subjectId: String(row.subject_id) as Id,
      expectedVersions: { updatedAt: isoValue(row.updated_at) },
      impact: {
        examRevisionId: targetId,
        examId: String(row.exam_id),
        questionCount: toNumber(row.question_count),
      },
    };
  }

  private async assertCurrentGrantAndScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    record: AgentActionRecord,
  ): Promise<void> {
    if (grant.grantVersion !== record.grantVersion)
      throw new AgentActionGrantChangedError();
    const target = await this.readTarget(record.targetType, record.targetId);
    if (!target) throw new AgentActionNotFoundError();
    await this.options.integration.assertResourceScope(
      authentication,
      grant,
      scopeResource(target),
    );
    if (
      !matchesExpectedVersions(record.expectedVersions, target.expectedVersions)
    )
      throw new AgentActionConflictError("ACTION_TARGET_CHANGED");
  }

  private async currentClientAuthorization(
    clientId: Id,
    capability: string,
  ): Promise<{
    readonly authentication: IntegrationAuthentication;
    readonly grant: IntegrationGrant;
  }> {
    const client = await this.options.integration.findClient(clientId);
    if (!client || client.status !== "ACTIVE")
      throw new AgentActionNotFoundError();
    const owners = await this.options.database.query<ActionRow>(
      "SELECT status, role FROM users WHERE id = ? LIMIT 1",
      [client.ownerUserId],
    );
    const owner = owners[0];
    if (
      !owner ||
      String(owner.status) !== "ACTIVE" ||
      !["ADMIN", "TEACHER"].includes(String(owner.role))
    )
      throw new AgentActionNotFoundError();
    const grants = await this.options.integration.listGrants(clientId);
    const grant = grants.find(
      (candidate) =>
        candidate.capability === capability &&
        this.options.integration.grantUsable(candidate),
    );
    if (!grant) throw new AgentActionGrantChangedError();
    const credential = {
      id: "0" as Id,
      integrationClientId: client.id,
      tokenPrefix: "approval",
      status: "ACTIVE" as const,
      validFrom: formatUtcTimestamp(new Date()),
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: formatUtcTimestamp(new Date()),
    };
    return { authentication: { client, credential, grants }, grant };
  }

  private async audit(
    authentication: IntegrationAuthentication,
    action: AgentActionRecord,
    requestId: string,
    name: string,
    metadata: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.options.integration.recordAgentAudit({
      action: name,
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "agent_action_request",
      entityId: action.id,
      requestId,
      outcome: "SUCCESS",
      metadata: {
        capability: action.capability,
        operation: action.operation,
        targetType: action.targetType,
        targetId: action.targetId,
        riskLevel: action.riskLevel,
        planHash: action.planHash,
        ...metadata,
      },
    });
  }

  private async expirePending(clientId?: Id): Promise<void> {
    await this.options.database.execute(
      `UPDATE agent_action_requests SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
       WHERE status IN ('AWAITING_CONFIRMATION', 'AWAITING_APPROVAL')
         AND expires_at <= UTC_TIMESTAMP(6)${clientId ? " AND integration_client_id = ?" : ""}`,
      clientId ? [clientId] : [],
    );
  }

  private async cancelInvalidPending(): Promise<void> {
    await this.options.database.execute(
      `UPDATE agent_action_requests a
       JOIN integration_clients c ON c.id = a.integration_client_id
       JOIN users u ON u.id = a.owner_user_id
       SET a.status = 'CANCELLED', a.updated_at = UTC_TIMESTAMP(6), a.error_code = 'OWNER_OR_CLIENT_DISABLED'
       WHERE a.status IN ('AWAITING_CONFIRMATION', 'AWAITING_APPROVAL')
         AND (c.status <> 'ACTIVE' OR u.status <> 'ACTIVE')`,
    );
  }

  private async expirePendingForAction(
    actionId: Id,
    clientId?: Id,
  ): Promise<void> {
    await this.options.database.execute(
      `UPDATE agent_action_requests SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(6)
       WHERE id = ? AND status IN ('AWAITING_CONFIRMATION', 'AWAITING_APPROVAL')
         AND expires_at <= UTC_TIMESTAMP(6)${clientId ? " AND integration_client_id = ?" : ""}`,
      clientId ? [actionId, clientId] : [actionId],
    );
  }

  private async readAction(
    connection: DatabaseConnection | DatabasePort,
    actionId: Id,
  ): Promise<AgentActionRecord | null> {
    const rows = await connection.query<ActionRow>(
      "SELECT * FROM agent_action_requests WHERE id = ? LIMIT 1",
      [actionId],
    );
    return rows[0] ? mapActionRow(rows[0]) : null;
  }
}

function normalizeParameters(
  operation: AgentActionOperation,
  value: Readonly<Record<string, unknown>> | undefined,
  target: { readonly participantId?: Id | null },
): Readonly<Record<string, unknown>> {
  const input = value ?? {};
  if (operation === "sessions.extend_time") {
    const minutes = Number(input.minutes ?? input.additionalMinutes);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440)
      throw new AgentActionValidationError(
        "minutes harus berupa integer 1-1440.",
      );
    return { minutes, reason: requiredReason(input.reason) };
  }
  if (
    operation === "sessions.end" ||
    operation === "schedules.close" ||
    operation === "users.disable"
  )
    return { reason: requiredReason(input.reason) };
  if (operation === "sessions.reset_attempt") {
    if (!target.participantId)
      throw new AgentActionValidationError(
        "Target session bukan peserta utama.",
      );
    return { reason: requiredReason(input.reason) };
  }
  if (operation === "results.release" || operation === "results.unrelease") {
    const allFiltered = input.allFiltered === true;
    const filter = input.filter ?? "ALL";
    if (filter !== "ALL" && filter !== "RELEASED" && filter !== "UNRELEASED")
      throw new AgentActionValidationError("filter hasil tidak valid.");
    const ids = input.resultIds;
    if (
      !allFiltered &&
      (!Array.isArray(ids) || ids.length === 0 || ids.length > 500)
    )
      throw new AgentActionValidationError(
        "resultIds harus berisi 1-500 ID atau allFiltered=true.",
      );
    if (Array.isArray(ids) && ids.some((id) => !/^\d+$/u.test(String(id))))
      throw new AgentActionValidationError("resultIds tidak valid.");
    return {
      allFiltered,
      filter,
      ...(allFiltered
        ? {}
        : { resultIds: [...new Set((ids as unknown[]).map(String))] }),
    };
  }
  return {};
}

function enforceConstraints(
  grant: IntegrationGrant,
  operation: AgentActionOperation,
  target: {
    readonly status?: string;
    readonly impact?: Readonly<Record<string, unknown>>;
  },
  parameters: Readonly<Record<string, unknown>>,
): void {
  if (
    [
      "schedules.close",
      "sessions.extend_time",
      "sessions.end",
      "sessions.reset_attempt",
    ].includes(operation) &&
    target.status === "ACTIVE" &&
    grant.constraints.active_exam_operation_allowed === false
  )
    throw new AgentActionValidationError(
      "Operasi pada ujian aktif tidak diizinkan grant.",
    );
  if (operation === "sessions.extend_time") {
    const maximum = Number(
      grant.constraints.max_time_extension_minutes ??
        grant.constraints.maximum_time_extension_minutes ??
        1440,
    );
    if (Number.isSafeInteger(maximum) && Number(parameters.minutes) > maximum)
      throw new AgentActionValidationError(
        "Perpanjangan melebihi batas grant.",
      );
  }
  if (operation === "results.release" || operation === "results.unrelease") {
    const maximum = Number(grant.constraints.max_bulk_items ?? 500);
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      throw new AgentActionValidationError("Batas bulk grant tidak valid.");
    const requested =
      parameters.allFiltered === true
        ? Number(target.impact?.resultCount ?? maximum)
        : Array.isArray(parameters.resultIds)
          ? parameters.resultIds.length
          : 0;
    if (requested > maximum)
      throw new AgentActionValidationError(
        "Jumlah hasil melebihi batas bulk grant.",
      );
  }
}

function mapActionRow(row: ActionRow): AgentActionRecord {
  const status = String(row.status) as AgentActionStatus;
  const operation = String(row.operation) as AgentActionOperation;
  const targetType = String(row.target_type) as AgentActionTargetType;
  const riskLevel = String(row.risk_level) as AgentActionRiskLevel;
  const approvalMethod = String(
    row.approval_method,
  ) as AgentActionApprovalMethod;
  if (!AGENT_ACTION_STATUSES.includes(status))
    throw new Error("Invalid action status");
  if (!AGENT_ACTION_OPERATIONS.includes(operation))
    throw new Error("Invalid action operation");
  if (!AGENT_ACTION_TARGET_TYPES.includes(targetType))
    throw new Error("Invalid action target type");
  const planBytes = toBytes(row.plan_hash);
  return {
    id: requiredId(row.id),
    clientId: requiredId(row.integration_client_id),
    ownerUserId: requiredId(row.owner_user_id),
    capability: String(row.capability),
    operation,
    targetType,
    targetId: requiredId(row.target_id),
    plan: parseObject(row.normalized_plan),
    planHash: hex(planBytes),
    planBytes,
    riskLevel,
    expectedVersions: parseObject(row.expected_versions_json),
    grantVersion: toNumber(row.grant_version),
    status,
    approvalMethod,
    expiresAt: isoValue(row.expires_at),
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
    executedAt: row.executed_at == null ? null : isoValue(row.executed_at),
    result: row.result_json == null ? null : parseObject(row.result_json),
    errorCode: row.error_code == null ? null : String(row.error_code),
  };
}

function toView(record: AgentActionRecord): AgentActionView {
  const { planBytes: _planBytes, ...view } = record;
  return view;
}

function parseStoredView(value: unknown): AgentActionRecord | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const item = parsed as Record<string, unknown>;
    const planHash = String(item.planHash ?? "");
    const planBytes = fromHex(planHash);
    if (!planBytes) return null;
    return {
      id: requiredId(item.id),
      clientId: requiredId(item.clientId),
      ownerUserId: requiredId(item.ownerUserId),
      capability: String(item.capability),
      operation: String(item.operation) as AgentActionOperation,
      targetType: String(item.targetType) as AgentActionTargetType,
      targetId: requiredId(item.targetId),
      plan: parseObject(item.plan),
      planHash,
      planBytes,
      riskLevel: String(item.riskLevel) as AgentActionRiskLevel,
      expectedVersions: parseObject(item.expectedVersions),
      grantVersion: toNumber(item.grantVersion),
      status: String(item.status) as AgentActionStatus,
      approvalMethod: String(item.approvalMethod) as AgentActionApprovalMethod,
      expiresAt: isoValue(item.expiresAt),
      createdAt: isoValue(item.createdAt),
      updatedAt: isoValue(item.updatedAt),
      executedAt: item.executedAt == null ? null : isoValue(item.executedAt),
      result: item.result == null ? null : parseObject(item.result),
      errorCode: item.errorCode == null ? null : String(item.errorCode),
    };
  } catch {
    return null;
  }
}

function parseObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Action JSON is invalid");
  return parsed as Readonly<Record<string, unknown>>;
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new AgentActionValidationError("Plan number is invalid");
    return canonicalNumber(value);
  }
  if (typeof value === "bigint") return JSON.stringify(String(value));
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  throw new AgentActionValidationError("Plan value is not serializable");
}

function canonicalNumber(value: number): string {
  if (Object.is(value, -0)) return "0";
  const raw = value.toString();
  if (!/[eE]/u.test(raw)) return raw;
  const [coefficient = "0", exponentText = "0"] = raw.toLowerCase().split("e");
  const unsignedCoefficient = coefficient.startsWith("-")
    ? coefficient.slice(1)
    : coefficient;
  const exponent = Number(exponentText);
  const negative = coefficient.startsWith("-");
  const digits = unsignedCoefficient.replace(".", "");
  const decimalIndex =
    (unsignedCoefficient.includes(".")
      ? unsignedCoefficient.indexOf(".")
      : unsignedCoefficient.length) + exponent;
  const point =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return negative ? `-${point}` : point;
}

function requiredReason(value: unknown): string {
  if (typeof value !== "string")
    throw new AgentActionValidationError("reason wajib diisi.");
  const reason = value.normalize("NFKC").trim();
  if (!reason || reason.length > 500)
    throw new AgentActionValidationError("reason wajib 1-500 karakter.");
  return reason;
}

function matchesExpectedVersions(
  expected: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => String(current[key]) === String(value),
  );
}

function scopeResource(target: {
  readonly ownerUserId?: Id;
  readonly subjectId?: Id;
  readonly scopeResourceId?: Id;
  readonly resourceId: Id;
}): {
  readonly ownerUserId?: Id;
  readonly subjectId?: Id;
  readonly resourceId: Id;
} {
  return {
    ...(target.ownerUserId ? { ownerUserId: target.ownerUserId } : {}),
    ...(target.subjectId ? { subjectId: target.subjectId } : {}),
    resourceId: target.scopeResourceId ?? target.resourceId,
  };
}

/** Removes secrets and domain payloads before an action result crosses the
 * integration boundary. Keep this allowlist conservative: action responses
 * are summaries, not a second result/session API. */
export function redactAgentResult(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { completed: true };
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      ["password", "token", "secret", "finalization_note", "content"].some(
        (blocked) => key.toLowerCase().includes(blocked),
      )
    )
      continue;
    if (["string", "number", "boolean"].includes(typeof item) || item === null)
      result[key] = item;
  }
  return result;
}

function isPending(status: AgentActionStatus): boolean {
  return status === "AWAITING_CONFIRMATION" || status === "AWAITING_APPROVAL";
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new AgentActionValidationError("Limit harus 1-100.");
  return value;
}

function requiredId(value: unknown): Id {
  const id = String(value ?? "");
  if (!/^\d+$/u.test(id)) throw new Error("Invalid action ID");
  return id as Id;
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoValue(value: unknown): UtcTimestamp {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? "");
  return (
    raw.endsWith("Z") ? raw : `${raw.replace(" ", "T")}Z`
  ) as UtcTimestamp;
}

function isFuture(value: unknown): boolean {
  const timestamp =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string")
    return new Uint8Array(Buffer.from(value, "binary"));
  if (Array.isArray(value)) return new Uint8Array(value as number[]);
  throw new Error("Action hash is invalid");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/u.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function bytesEqual(left: unknown, right: Uint8Array): boolean {
  const bytes = toBytes(left);
  return (
    bytes.length === right.length &&
    bytes.every((value, index) => value === right[index])
  );
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const expected = fromHex(left);
  const actual = fromHex(right.toLowerCase());
  if (!expected || !actual || expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++)
    difference |= (expected[index] ?? 0) ^ (actual[index] ?? 0);
  return difference === 0;
}
