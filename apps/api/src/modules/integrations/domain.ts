import type { Id, UtcTimestamp } from "@gezycbt/contracts";

export const INTEGRATION_CLIENT_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type IntegrationClientStatus =
  (typeof INTEGRATION_CLIENT_STATUSES)[number];
export const INTEGRATION_CREDENTIAL_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type IntegrationCredentialStatus =
  (typeof INTEGRATION_CREDENTIAL_STATUSES)[number];
export const INTEGRATION_GRANT_STATUSES = ["ACTIVE", "REVOKED"] as const;
export type IntegrationGrantStatus =
  (typeof INTEGRATION_GRANT_STATUSES)[number];

export const INTEGRATION_SCOPE_TYPES = [
  "SCHOOL",
  "SUBJECT",
  "CLASS",
  "QUESTION_BANK",
  "EXAM",
  "SCHEDULE",
  "ACADEMIC_YEAR",
  "OWNER",
] as const;
export type IntegrationScopeType = (typeof INTEGRATION_SCOPE_TYPES)[number];

/** Capability names intentionally remain explicit so a new release cannot widen old grants. */
export const BASELINE_INTEGRATION_CAPABILITIES = [
  "users.read",
  "users.create",
  "users.update",
  "users.disable",
  "users.reset_password",
  "classes.read",
  "classes.write",
  "subjects.read",
  "subjects.write",
  "teacher_scopes.read",
  "teacher_scopes.write",
  "question_banks.read",
  "question_banks.write",
  "questions.read",
  "questions.read_key",
  "questions.create",
  "questions.update",
  "questions.archive",
  "questions.publish",
  "media.upload",
  "exams.read",
  "exams.create",
  "exams.update",
  "exams.archive",
  "exams.attach_questions",
  "exams.publish",
  "schedules.read",
  "schedules.create",
  "schedules.update",
  "schedules.activate",
  "schedules.close",
  "schedules.rotate_token",
  "sessions.read",
  "sessions.monitor",
  "sessions.extend_time",
  "sessions.end",
  "sessions.reset_attempt",
  "results.read",
  "results.read_practice",
  "results.release",
  "results.unrelease",
  "results.export",
  "audit.read",
  "settings.read",
  "settings.write",
] as const;
export type IntegrationCapability =
  (typeof BASELINE_INTEGRATION_CAPABILITIES)[number];

export interface IntegrationClient {
  readonly id: Id;
  readonly name: string;
  readonly platformHint: string;
  readonly ownerUserId: Id;
  readonly ownerDisplayName: string;
  readonly ownerRole: "ADMIN" | "TEACHER";
  readonly status: IntegrationClientStatus;
  readonly description: string | null;
  readonly policyVersion: number;
  readonly createdByUserId: Id;
  readonly lastUsedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface IntegrationCredential {
  readonly id: Id;
  readonly integrationClientId: Id;
  readonly tokenPrefix: string;
  readonly status: IntegrationCredentialStatus;
  readonly validFrom: UtcTimestamp;
  readonly expiresAt: UtcTimestamp | null;
  readonly lastUsedAt: UtcTimestamp | null;
  readonly revokedAt: UtcTimestamp | null;
  readonly revokeReason: string | null;
  readonly createdAt: UtcTimestamp;
}

export interface IntegrationGrant {
  readonly id: Id;
  readonly integrationClientId: Id;
  readonly capability: string;
  readonly scopeType: IntegrationScopeType;
  readonly scopeIds: readonly Id[];
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly grantVersion: number;
  readonly status: IntegrationGrantStatus;
  readonly validFrom: UtcTimestamp;
  readonly expiresAt: UtcTimestamp | null;
  readonly issuedByUserId: Id;
  readonly revokedAt: UtcTimestamp | null;
  readonly revokeReason: string | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface IntegrationAuthentication {
  readonly client: IntegrationClient;
  readonly credential: IntegrationCredential;
  readonly grants: readonly IntegrationGrant[];
}

export interface CreateIntegrationClientInput {
  readonly name: string;
  readonly platformHint: string;
  readonly ownerUserId: Id;
  readonly description?: string | null;
  readonly createdByUserId: Id;
}

export interface CreateIntegrationGrantInput {
  readonly clientId: Id;
  readonly capability: string;
  readonly scopeType: IntegrationScopeType;
  readonly scopeIds: readonly Id[];
  readonly constraints?: Readonly<Record<string, unknown>>;
  readonly expiresAt?: UtcTimestamp | null;
  readonly issuedByUserId: Id;
  readonly expectedPolicyVersion?: number;
}

export class IntegrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationValidationError";
  }
}

export class IntegrationNotFoundError extends Error {
  constructor(message = "Integration resource was not found") {
    super(message);
    this.name = "IntegrationNotFoundError";
  }
}

export class IntegrationConflictError extends Error {
  constructor(message = "Integration resource conflicts with another request") {
    super(message);
    this.name = "IntegrationConflictError";
  }
}

export class IntegrationAuthenticationError extends Error {
  constructor() {
    super("Integration authentication failed");
    this.name = "IntegrationAuthenticationError";
  }
}

export class IntegrationCapabilityError extends Error {
  readonly code = "CAPABILITY_DENIED";

  constructor(readonly capability: string) {
    super("Integration capability is not granted");
    this.name = "IntegrationCapabilityError";
  }
}

export class IntegrationScopeError extends Error {
  readonly code = "RESOURCE_SCOPE_DENIED";

  constructor() {
    super("Integration resource is outside the effective scope");
    this.name = "IntegrationScopeError";
  }
}

export class IntegrationRateLimitError extends Error {
  readonly code = "RATE_LIMITED";

  constructor(readonly retryAfterSeconds: number) {
    super("Integration request rate limit exceeded");
    this.name = "IntegrationRateLimitError";
  }
}

export function validateClientName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < 1 || normalized.length > 120)
    throw new IntegrationValidationError(
      "Client name must be 1-120 characters",
    );
  return normalized;
}

export function validatePlatformHint(value: string): string {
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/u.test(normalized))
    throw new IntegrationValidationError("Platform hint is invalid");
  return normalized;
}

export function validateDescription(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > 500)
    throw new IntegrationValidationError(
      "Description must be at most 500 characters",
    );
  return normalized;
}

export function validateCapability(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u.test(normalized))
    throw new IntegrationValidationError("Capability is invalid");
  return normalized;
}

export function validateScopeType(value: string): IntegrationScopeType {
  if (!INTEGRATION_SCOPE_TYPES.includes(value as IntegrationScopeType))
    throw new IntegrationValidationError("Scope type is invalid");
  return value as IntegrationScopeType;
}

export function validateScopeIds(
  scopeType: IntegrationScopeType,
  ids: readonly Id[],
): Id[] {
  const unique = [...new Set(ids)];
  if (unique.length > 500)
    throw new IntegrationValidationError("Scope contains too many IDs");
  if (scopeType === "SCHOOL" && unique.length !== 0)
    throw new IntegrationValidationError("School scope must not contain IDs");
  if (scopeType !== "SCHOOL" && unique.length === 0)
    throw new IntegrationValidationError(
      "Scoped grant requires at least one ID",
    );
  if (unique.some((id) => !/^\d+$/u.test(id)))
    throw new IntegrationValidationError("Scope ID is invalid");
  return unique;
}

export function validateConstraints(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  const constraints = value ?? {};
  const keys = Object.keys(constraints);
  if (keys.length > 20)
    throw new IntegrationValidationError("Too many grant constraints");
  const allowed = new Set([
    "auto_approve_r1",
    "allowed_hours",
    "max_bulk_items",
    "publish_allowed",
    "active_exam_operation_allowed",
    "result_pii_export_allowed",
    "max_export_rows",
    "max_time_extension_minutes",
    "action_count_per_hour",
  ]);
  if (keys.some((key) => !allowed.has(key)))
    throw new IntegrationValidationError("Grant constraint is not allowed");
  return Object.fromEntries(keys.sort().map((key) => [key, constraints[key]]));
}

export function parseJsonObject(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new IntegrationValidationError("JSON object is invalid");
  return value as Readonly<Record<string, unknown>>;
}

export function parseJsonIds(value: unknown): Id[] {
  if (!Array.isArray(value))
    throw new IntegrationValidationError("Scope IDs are invalid");
  return value.map((id) => {
    if (typeof id !== "string" || !/^\d+$/u.test(id))
      throw new IntegrationValidationError("Scope ID is invalid");
    return id as Id;
  });
}
