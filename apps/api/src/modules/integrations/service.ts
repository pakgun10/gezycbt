import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { TeacherScope } from "../academics/domain";
import {
  type DiscoveryAccess,
  type DiscoveryClass,
  type DiscoveryExam,
  type DiscoveryPage,
  type DiscoveryQuery,
  type DiscoveryQuestion,
  type DiscoveryQuestionBank,
  type DiscoveryResourceType,
  type DiscoverySchedule,
  type DiscoverySubject,
  discoveryCapability,
  type IntegrationDiscoveryRepository,
} from "./discovery";
import {
  type CreateIntegrationClientInput,
  type CreateIntegrationGrantInput,
  type IntegrationAuthentication,
  IntegrationAuthenticationError,
  IntegrationCapabilityError,
  type IntegrationClient,
  type IntegrationClientStatus,
  type IntegrationCredential,
  type IntegrationGrant,
  IntegrationNotFoundError,
  IntegrationRateLimitError,
  IntegrationScopeError,
  IntegrationValidationError,
} from "./domain";
import type { IntegrationRepository } from "./repository";

export interface IntegrationAuditEvent {
  readonly action: string;
  readonly actorType?: "HUMAN" | "EXTERNAL_AGENT" | "SYSTEM" | undefined;
  readonly clientId?: Id | undefined;
  readonly actorUserId?: Id | undefined;
  readonly entityType: string;
  readonly entityId?: Id | undefined;
  readonly requestId?: string | undefined;
  readonly outcome: "SUCCESS" | "FAILURE";
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface IntegrationAuditSink {
  record(event: IntegrationAuditEvent): Promise<void>;
}

export class SqlIntegrationAuditSink implements IntegrationAuditSink {
  constructor(
    private readonly database: {
      execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
    },
  ) {}

  async record(event: IntegrationAuditEvent): Promise<void> {
    await this.database.execute(
      `INSERT INTO audit_logs
        (actor_user_id, actor_type, integration_client_id, action, entity_type,
         entity_id, request_id, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.actorUserId ?? null,
        event.actorType ??
          (event.action.includes("AUTH_FAILURE") ||
          event.action.includes("CAPABILITY_DENIED") ||
          event.action.includes("SCOPE_DENIED")
            ? "EXTERNAL_AGENT"
            : event.actorUserId
              ? "HUMAN"
              : "SYSTEM"),
        event.clientId ?? null,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.requestId ?? "system",
        JSON.stringify({
          outcome: event.outcome,
          ...(event.metadata ?? {}),
        }),
      ],
    );
  }
}

export class InMemoryIntegrationAuditSink implements IntegrationAuditSink {
  readonly events: IntegrationAuditEvent[] = [];

  async record(event: IntegrationAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

export interface IntegrationRequestMeta {
  readonly requestId?: string | undefined;
  readonly kind?: "read" | "mutation";
}

export interface DiscoveryResponse<T> {
  readonly items: readonly T[];
  readonly nextCursor: Id | null;
  readonly ambiguity: {
    readonly code: "AMBIGUOUS_RESOURCE";
    readonly resourceType: DiscoveryResourceType;
    readonly candidateCount: number;
    readonly requiresSelection: true;
  } | null;
}

export type IntegrationOwnerScopeLookup = (
  teacherId: Id,
) => Promise<TeacherScope | null>;

export class IntegrationRateLimiter {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly limits: {
      readonly readPerMinute?: number;
      readonly mutationPerMinute?: number;
      readonly authFailurePer15Minutes?: number;
    } = {},
  ) {}

  check(clientId: Id, kind: "read" | "mutation"): void {
    const limit =
      kind === "read"
        ? (this.limits.readPerMinute ?? 60)
        : (this.limits.mutationPerMinute ?? 20);
    this.consume(`client:${clientId}:${kind}`, 60_000, limit);
  }

  checkExport(clientId: Id): void {
    this.consume(`client:${clientId}:export`, 10 * 60_000, 3);
  }

  checkAuthFailure(fingerprint: string): void {
    this.consume(
      `failure:${fingerprint}`,
      15 * 60_000,
      this.limits.authFailurePer15Minutes ?? 5,
    );
  }

  private consume(key: string, windowMs: number, limit: number): void {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowMs - (now - current.startedAt)) / 1000),
      );
      throw new IntegrationRateLimitError(retryAfterSeconds);
    }
    current.count += 1;
  }
}

export interface IssuedIntegrationCredential {
  readonly credential: IntegrationCredential;
  /** Plaintext is returned only by this mutation and never persisted. */
  readonly token: string;
}

export class IntegrationService {
  private readonly touched = new Map<Id, number>();

  constructor(
    private readonly repository: IntegrationRepository,
    private readonly options: {
      readonly audit?: IntegrationAuditSink;
      readonly ownerScopeLookup?: IntegrationOwnerScopeLookup;
      readonly rateLimiter?: IntegrationRateLimiter;
      readonly discovery?: IntegrationDiscoveryRepository;
    } = {},
  ) {}

  checkExportRateLimit(clientId: Id): void {
    this.options.rateLimiter?.checkExport(clientId);
  }

  async authenticate(
    token: string,
    meta: IntegrationRequestMeta = {},
  ): Promise<IntegrationAuthentication> {
    const normalized = token.trim();
    const digest = await sha256(normalized);
    const fingerprint = hex(digest);
    const authentication = await this.repository.authenticate(digest);
    if (!authentication) {
      this.options.rateLimiter?.checkAuthFailure(fingerprint);
      await this.options.audit?.record({
        action: "INTEGRATION_AUTH_FAILURE",
        entityType: "integration_credential",
        requestId: meta.requestId,
        outcome: "FAILURE",
      });
      throw new IntegrationAuthenticationError();
    }
    this.options.rateLimiter?.check(
      authentication.client.id,
      meta.kind ?? "read",
    );
    const lastTouch = this.touched.get(authentication.credential.id) ?? 0;
    if (Date.now() - lastTouch > 60_000) {
      this.touched.set(authentication.credential.id, Date.now());
      await this.repository.touchCredential(
        authentication.credential.id,
        authentication.client.id,
      );
    }
    return authentication;
  }

  async assertCapability(
    authentication: IntegrationAuthentication,
    capability: string,
    requestId?: string,
  ): Promise<IntegrationGrant> {
    const grant = authentication.grants.find(
      (candidate) =>
        candidate.capability === capability && this.grantUsable(candidate),
    );
    if (!grant) {
      await this.options.audit?.record({
        action: "INTEGRATION_CAPABILITY_DENIED",
        actorType: "EXTERNAL_AGENT",
        clientId: authentication.client.id,
        actorUserId: authentication.client.ownerUserId,
        entityType: "integration_client",
        entityId: authentication.client.id,
        requestId,
        outcome: "FAILURE",
        metadata: { capability },
      });
      throw new IntegrationCapabilityError(capability);
    }
    return grant;
  }

  /** Records a domain operation performed through a machine credential. */
  async recordAgentAudit(
    event: Omit<IntegrationAuditEvent, "actorType"> & {
      readonly clientId: Id;
      readonly actorUserId: Id;
    },
  ): Promise<void> {
    await this.options.audit?.record({
      ...event,
      actorType: "EXTERNAL_AGENT",
    });
  }

  async searchSubjects(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoverySubject>> {
    return this.searchDiscovery(
      authentication,
      "subjects",
      requestId,
      (access) => this.options.discovery?.searchSubjects(query, access),
    );
  }

  async searchClasses(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoveryClass>> {
    return this.searchDiscovery(
      authentication,
      "classes",
      requestId,
      (access) => this.options.discovery?.searchClasses(query, access),
    );
  }

  async searchQuestionBanks(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoveryQuestionBank>> {
    return this.searchDiscovery(
      authentication,
      "question_banks",
      requestId,
      (access) => this.options.discovery?.searchQuestionBanks(query, access),
    );
  }

  async searchQuestions(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoveryQuestion>> {
    return this.searchDiscovery(
      authentication,
      "questions",
      requestId,
      (access) => this.options.discovery?.searchQuestions(query, access),
    );
  }

  async searchExams(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoveryExam>> {
    return this.searchDiscovery(authentication, "exams", requestId, (access) =>
      this.options.discovery?.searchExams(query, access),
    );
  }

  async searchSchedules(
    authentication: IntegrationAuthentication,
    query: DiscoveryQuery,
    requestId?: string,
  ): Promise<DiscoveryResponse<DiscoverySchedule>> {
    return this.searchDiscovery(
      authentication,
      "schedules",
      requestId,
      (access) => this.options.discovery?.searchSchedules(query, access),
    );
  }

  private async searchDiscovery<T>(
    authentication: IntegrationAuthentication,
    resource: DiscoveryResourceType,
    requestId: string | undefined,
    operation: (
      access: DiscoveryAccess,
    ) => Promise<DiscoveryPage<T>> | undefined,
  ): Promise<DiscoveryResponse<T>> {
    const capability = discoveryCapability(resource);
    const grants = authentication.grants.filter(
      (grant) => grant.capability === capability && this.grantUsable(grant),
    );
    if (grants.length === 0) {
      await this.recordCapabilityDenied(authentication, capability, requestId);
      throw new IntegrationCapabilityError(capability);
    }
    if (!this.options.discovery)
      throw new Error("Integration discovery repository is not configured");
    const ownerScope =
      authentication.client.ownerRole === "TEACHER"
        ? await this.options.ownerScopeLookup?.(
            authentication.client.ownerUserId,
          )
        : null;
    const access: DiscoveryAccess = {
      ownerUserId: authentication.client.ownerUserId,
      ownerRole: authentication.client.ownerRole,
      teacherSubjectIds: ownerScope?.subjectIds ?? [],
      teacherClassIds: ownerScope?.classIds ?? [],
      grants,
    };
    const result = await operation(access);
    if (!result)
      throw new Error("Integration discovery operation is not available");
    const candidateCount = result.items.length + (result.nextCursor ? 1 : 0);
    const ambiguity =
      candidateCount > 1
        ? {
            code: "AMBIGUOUS_RESOURCE" as const,
            resourceType: resource,
            candidateCount,
            requiresSelection: true as const,
          }
        : null;
    return { ...result, ambiguity };
  }

  private async recordCapabilityDenied(
    authentication: IntegrationAuthentication,
    capability: string,
    requestId?: string,
  ): Promise<void> {
    await this.options.audit?.record({
      action: "INTEGRATION_CAPABILITY_DENIED",
      actorType: "EXTERNAL_AGENT",
      clientId: authentication.client.id,
      actorUserId: authentication.client.ownerUserId,
      entityType: "integration_client",
      entityId: authentication.client.id,
      requestId,
      outcome: "FAILURE",
      metadata: { capability },
    });
  }

  async assertResourceScope(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
    resource: {
      readonly ownerUserId?: Id;
      readonly subjectId?: Id;
      readonly classId?: Id;
      readonly resourceId?: Id;
    },
  ): Promise<void> {
    const ownerScope =
      authentication.client.ownerRole === "TEACHER"
        ? await this.options.ownerScopeLookup?.(
            authentication.client.ownerUserId,
          )
        : null;
    const ownerAllows =
      authentication.client.ownerRole === "ADMIN" ||
      (ownerScope !== null &&
        ownerScope !== undefined &&
        (resource.subjectId === undefined ||
          ownerScope.subjectIds.includes(resource.subjectId)) &&
        (resource.classId === undefined ||
          ownerScope.classIds.includes(resource.classId)));
    const grantAllows =
      grant.scopeType === "SCHOOL"
        ? true
        : grant.scopeType === "OWNER"
          ? resource.ownerUserId === authentication.client.ownerUserId &&
            grant.scopeIds.includes(authentication.client.ownerUserId)
          : grant.scopeType === "SUBJECT"
            ? resource.subjectId !== undefined &&
              grant.scopeIds.includes(resource.subjectId)
            : grant.scopeType === "CLASS"
              ? resource.classId !== undefined &&
                grant.scopeIds.includes(resource.classId)
              : resource.resourceId !== undefined &&
                grant.scopeIds.includes(resource.resourceId);
    if (!ownerAllows || !grantAllows) {
      await this.options.audit?.record({
        action: "INTEGRATION_SCOPE_DENIED",
        actorType: "EXTERNAL_AGENT",
        clientId: authentication.client.id,
        actorUserId: authentication.client.ownerUserId,
        entityType: "resource",
        entityId: resource.resourceId,
        outcome: "FAILURE",
      });
      throw new IntegrationScopeError();
    }
  }

  async listClients(): Promise<readonly IntegrationClient[]> {
    return this.repository.listClients();
  }

  async findClient(id: Id): Promise<IntegrationClient | null> {
    return this.repository.findClient(id);
  }

  async createClient(
    input: CreateIntegrationClientInput,
    requestId?: string,
  ): Promise<IntegrationClient> {
    const client = await this.repository.createClient(input);
    await this.options.audit?.record({
      action: "INTEGRATION_CLIENT_CREATE",
      actorUserId: input.createdByUserId,
      entityType: "integration_client",
      entityId: client.id,
      requestId,
      outcome: "SUCCESS",
      metadata: {
        platformHint: client.platformHint,
        ownerUserId: client.ownerUserId,
      },
    });
    return client;
  }

  async updateClient(
    id: Id,
    input: { readonly name?: string; readonly description?: string | null },
    expectedUpdatedAt?: UtcTimestamp,
    actorUserId?: Id,
    requestId?: string,
  ): Promise<IntegrationClient | null> {
    const client = await this.repository.updateClient(
      id,
      input,
      expectedUpdatedAt,
    );
    if (client)
      await this.options.audit?.record({
        action: "INTEGRATION_CLIENT_UPDATE",
        actorUserId,
        entityType: "integration_client",
        entityId: id,
        requestId,
        outcome: "SUCCESS",
      });
    return client;
  }

  async setClientStatus(
    id: Id,
    status: IntegrationClientStatus,
    actorUserId: Id,
    expectedUpdatedAt?: UtcTimestamp,
    requestId?: string,
  ): Promise<IntegrationClient | null> {
    const client = await this.repository.setClientStatus(
      id,
      status,
      actorUserId,
      expectedUpdatedAt,
    );
    if (client)
      await this.options.audit?.record({
        action:
          status === "DISABLED"
            ? "INTEGRATION_CLIENT_REVOKE"
            : "INTEGRATION_CLIENT_ENABLE",
        actorUserId,
        entityType: "integration_client",
        entityId: id,
        requestId,
        outcome: "SUCCESS",
        metadata: { killSwitch: status === "DISABLED" },
      });
    return client;
  }

  async listCredentials(
    clientId: Id,
  ): Promise<readonly IntegrationCredential[]> {
    return this.repository.listCredentials(clientId);
  }

  async issueCredential(
    clientId: Id,
    input: {
      readonly expiresAt?: UtcTimestamp | null;
      readonly rotationParentId?: Id | null;
    },
    actorUserId?: Id,
    requestId?: string,
  ): Promise<IssuedIntegrationCredential> {
    const token = toToken();
    const credential = await this.repository.issueCredential(clientId, {
      tokenPrefix: token.slice(0, 12),
      tokenDigest: await sha256(token),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.rotationParentId !== undefined
        ? { rotationParentId: input.rotationParentId }
        : {}),
    });
    await this.options.audit?.record({
      action: "INTEGRATION_CREDENTIAL_ISSUE",
      actorUserId,
      clientId,
      entityType: "integration_credential",
      entityId: credential.id,
      requestId,
      outcome: "SUCCESS",
    });
    return { credential, token };
  }

  async revokeCredential(
    clientId: Id,
    credentialId: Id,
    actorUserId: Id,
    reason: string,
    requestId?: string,
  ): Promise<boolean> {
    const revoked = await this.repository.revokeCredential(
      clientId,
      credentialId,
      actorUserId,
      reason,
    );
    if (revoked)
      await this.options.audit?.record({
        action: "INTEGRATION_CREDENTIAL_REVOKE",
        actorUserId,
        clientId,
        entityType: "integration_credential",
        entityId: credentialId,
        requestId,
        outcome: "SUCCESS",
        metadata: { reason: reason.slice(0, 500) },
      });
    return revoked;
  }

  async listGrants(clientId: Id): Promise<readonly IntegrationGrant[]> {
    return this.repository.listGrants(clientId);
  }

  async createGrant(
    input: CreateIntegrationGrantInput,
    requestId?: string,
  ): Promise<IntegrationGrant> {
    const client = await this.repository.findClient(input.clientId);
    if (!client)
      throw new IntegrationNotFoundError("Integration client was not found");
    if (client.ownerRole === "TEACHER") {
      if (input.scopeType === "SCHOOL")
        throw new IntegrationValidationError(
          "Teacher-owned clients require an explicit subject or class scope",
        );
      if (input.scopeType === "SUBJECT" || input.scopeType === "CLASS") {
        const ownerScope = await this.options.ownerScopeLookup?.(
          client.ownerUserId,
        );
        const allowed =
          input.scopeType === "SUBJECT"
            ? ownerScope?.subjectIds
            : ownerScope?.classIds;
        if (!ownerScope || input.scopeIds.some((id) => !allowed?.includes(id)))
          throw new IntegrationValidationError(
            "Grant scope exceeds the teacher owner scope",
          );
      }
    }
    const grant = await this.repository.createGrant(input);
    await this.options.audit?.record({
      action: "INTEGRATION_GRANT_CREATE",
      actorUserId: input.issuedByUserId,
      clientId: input.clientId,
      entityType: "integration_grant",
      entityId: grant.id,
      requestId,
      outcome: "SUCCESS",
      metadata: {
        capability: grant.capability,
        scopeType: grant.scopeType,
        grantVersion: grant.grantVersion,
      },
    });
    return grant;
  }

  async revokeGrant(
    clientId: Id,
    grantId: Id,
    actorUserId: Id,
    reason: string,
    requestId?: string,
  ): Promise<boolean> {
    const revoked = await this.repository.revokeGrant(
      clientId,
      grantId,
      actorUserId,
      reason,
    );
    if (revoked)
      await this.options.audit?.record({
        action: "INTEGRATION_GRANT_REVOKE",
        actorUserId,
        clientId,
        entityType: "integration_grant",
        entityId: grantId,
        requestId,
        outcome: "SUCCESS",
        metadata: { reason: reason.slice(0, 500) },
      });
    return revoked;
  }

  grantUsable(grant: IntegrationGrant): boolean {
    if (grant.status !== "ACTIVE") return false;
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now())
      return false;
    return true;
  }

  async effectiveCapabilities(
    authentication: IntegrationAuthentication,
  ): Promise<
    readonly {
      readonly capability: string;
      readonly grantVersion: number;
      readonly scopeType: IntegrationGrant["scopeType"];
      readonly scopeIds: readonly Id[];
      readonly constraints: Readonly<Record<string, unknown>>;
    }[]
  > {
    const output = [] as {
      capability: string;
      grantVersion: number;
      scopeType: IntegrationGrant["scopeType"];
      scopeIds: readonly Id[];
      constraints: Readonly<Record<string, unknown>>;
    }[];
    for (const grant of authentication.grants) {
      if (!this.grantUsable(grant)) continue;
      const ids = await this.effectiveScopeIds(authentication, grant);
      if (grant.scopeType !== "SCHOOL" && ids.length === 0) continue;
      output.push({
        capability: grant.capability,
        grantVersion: grant.grantVersion,
        scopeType: grant.scopeType,
        scopeIds: ids,
        constraints: grant.constraints,
      });
    }
    return output;
  }

  async effectiveScopeIds(
    authentication: IntegrationAuthentication,
    grant: IntegrationGrant,
  ): Promise<readonly Id[]> {
    if (
      authentication.client.ownerRole !== "TEACHER" ||
      !this.options.ownerScopeLookup
    )
      return grant.scopeIds;
    const ownerScope = await this.options.ownerScopeLookup(
      authentication.client.ownerUserId,
    );
    if (!ownerScope) return [];
    if (grant.scopeType === "SUBJECT")
      return grant.scopeIds.filter((id) => ownerScope.subjectIds.includes(id));
    if (grant.scopeType === "CLASS")
      return grant.scopeIds.filter((id) => ownerScope.classIds.includes(id));
    if (grant.scopeType === "SCHOOL") return [];
    return grant.scopeIds;
  }
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
