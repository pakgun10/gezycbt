import {
  formatUtcTimestamp,
  type Id,
  parseId,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection } from "@gezycbt/database";
import {
  type CreateIntegrationClientInput,
  type CreateIntegrationGrantInput,
  type IntegrationAuthentication,
  type IntegrationClient,
  type IntegrationClientStatus,
  IntegrationConflictError,
  type IntegrationCredential,
  type IntegrationCredentialStatus,
  type IntegrationGrant,
  type IntegrationGrantStatus,
  IntegrationNotFoundError,
  IntegrationValidationError,
  parseJsonIds,
  parseJsonObject,
  validateCapability,
  validateClientName,
  validateConstraints,
  validateDescription,
  validatePlatformHint,
  validateScopeIds,
  validateScopeType,
} from "./domain";

export interface IntegrationRepository {
  authenticate(
    tokenDigest: Uint8Array,
  ): Promise<IntegrationAuthentication | null>;
  touchCredential(credentialId: Id, clientId: Id): Promise<void>;
  listClients(): Promise<readonly IntegrationClient[]>;
  findClient(id: Id): Promise<IntegrationClient | null>;
  createClient(input: CreateIntegrationClientInput): Promise<IntegrationClient>;
  updateClient(
    id: Id,
    input: { readonly name?: string; readonly description?: string | null },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<IntegrationClient | null>;
  setClientStatus(
    id: Id,
    status: IntegrationClientStatus,
    changedByUserId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<IntegrationClient | null>;
  listCredentials(clientId: Id): Promise<readonly IntegrationCredential[]>;
  issueCredential(
    clientId: Id,
    input: {
      readonly tokenPrefix: string;
      readonly tokenDigest: Uint8Array;
      readonly expiresAt?: UtcTimestamp | null;
      readonly rotationParentId?: Id | null;
    },
  ): Promise<IntegrationCredential>;
  revokeCredential(
    clientId: Id,
    credentialId: Id,
    revokedByUserId: Id,
    reason: string,
  ): Promise<boolean>;
  listGrants(clientId: Id): Promise<readonly IntegrationGrant[]>;
  createGrant(input: CreateIntegrationGrantInput): Promise<IntegrationGrant>;
  revokeGrant(
    clientId: Id,
    grantId: Id,
    revokedByUserId: Id,
    reason: string,
  ): Promise<boolean>;
}

interface IntegrationRepositoryDatabase {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
  transaction<T>(
    operation: (connection: DatabaseConnection) => Promise<T>,
  ): Promise<T>;
}

const CLIENT_COLUMNS = `
  SELECT c.id, c.name, c.platform_hint, c.owner_user_id, c.status,
         c.description, c.policy_version, c.created_by_user_id,
         c.last_used_at, c.created_at, c.updated_at,
         u.display_name AS owner_display_name, u.role AS owner_role
  FROM integration_clients c
  JOIN users u ON u.id = c.owner_user_id`;

export class SqlIntegrationRepository implements IntegrationRepository {
  constructor(private readonly database: IntegrationRepositoryDatabase) {}

  async authenticate(
    tokenDigest: Uint8Array,
  ): Promise<IntegrationAuthentication | null> {
    const credentials = await this.database.query<Record<string, unknown>>(
      `SELECT c.id AS client_id, c.name AS client_name, c.platform_hint,
              c.owner_user_id, c.status AS client_status, c.description,
              c.policy_version, c.created_by_user_id, c.last_used_at,
              c.created_at AS client_created_at, c.updated_at AS client_updated_at,
              owner.display_name AS owner_display_name, owner.role AS owner_role,
              ic.id AS credential_id, ic.token_prefix, ic.status AS credential_status,
              ic.valid_from, ic.expires_at, ic.last_used_at AS credential_last_used_at,
              ic.revoked_at, ic.revoke_reason, ic.created_at AS credential_created_at
       FROM integration_credentials ic
       JOIN integration_clients c ON c.id = ic.integration_client_id
       JOIN users owner ON owner.id = c.owner_user_id
       WHERE ic.token_digest = ?
         AND ic.status = 'ACTIVE'
         AND c.status = 'ACTIVE'
         AND owner.status = 'ACTIVE'
         AND owner.role IN ('ADMIN', 'TEACHER')
         AND ic.valid_from <= UTC_TIMESTAMP(6)
         AND (ic.expires_at IS NULL OR ic.expires_at > UTC_TIMESTAMP(6))
       LIMIT 1`,
      [tokenDigest],
    );
    const row = credentials[0];
    if (!row) return null;
    const clientId = id(row.client_id);
    const grants = await this.listActiveGrants(clientId);
    return {
      client: mapClient({
        id: row.client_id,
        name: row.client_name,
        platform_hint: row.platform_hint,
        owner_user_id: row.owner_user_id,
        status: row.client_status,
        description: row.description,
        policy_version: row.policy_version,
        created_by_user_id: row.created_by_user_id,
        last_used_at: row.last_used_at,
        created_at: row.client_created_at,
        updated_at: row.client_updated_at,
        owner_display_name: row.owner_display_name,
        owner_role: row.owner_role,
      }),
      credential: mapCredential({
        id: row.credential_id,
        integration_client_id: row.client_id,
        token_prefix: row.token_prefix,
        status: row.credential_status,
        valid_from: row.valid_from,
        expires_at: row.expires_at,
        credential_last_used_at: row.credential_last_used_at,
        revoked_at: row.revoked_at,
        revoke_reason: row.revoke_reason,
        credential_created_at: row.credential_created_at,
      }),
      grants,
    };
  }

  async touchCredential(credentialId: Id, clientId: Id): Promise<void> {
    await this.database.execute(
      `UPDATE integration_credentials ic
       JOIN integration_clients c ON c.id = ic.integration_client_id
       SET ic.last_used_at = UTC_TIMESTAMP(6), c.last_used_at = UTC_TIMESTAMP(6)
       WHERE ic.id = ? AND ic.integration_client_id = ?
         AND ic.status = 'ACTIVE' AND c.status = 'ACTIVE'`,
      [credentialId, clientId],
    );
  }

  async listClients(): Promise<readonly IntegrationClient[]> {
    const rows = await this.database.query<Record<string, unknown>>(
      `${CLIENT_COLUMNS} ORDER BY c.id DESC LIMIT 500`,
    );
    return rows.map(mapClient);
  }

  async findClient(idValue: Id): Promise<IntegrationClient | null> {
    const rows = await this.database.query<Record<string, unknown>>(
      `${CLIENT_COLUMNS} WHERE c.id = ? LIMIT 1`,
      [idValue],
    );
    return rows[0] ? mapClient(rows[0]) : null;
  }

  async createClient(
    input: CreateIntegrationClientInput,
  ): Promise<IntegrationClient> {
    const name = validateClientName(input.name);
    const platformHint = validatePlatformHint(input.platformHint);
    const description = validateDescription(input.description);
    return this.database.transaction(async (connection) => {
      const owners = await connection.query<Record<string, unknown>>(
        "SELECT id, role, status FROM users WHERE id = ? LIMIT 1",
        [input.ownerUserId],
      );
      const owner = owners[0];
      if (
        owner?.status !== "ACTIVE" ||
        !["ADMIN", "TEACHER"].includes(String(owner?.role))
      )
        throw new IntegrationValidationError(
          "Owner must be an active admin or teacher",
        );
      await connection.execute(
        `INSERT INTO integration_clients
          (name, platform_hint, owner_user_id, status, description, created_by_user_id)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          name,
          platformHint,
          input.ownerUserId,
          description,
          input.createdByUserId,
        ],
      );
      const rows = await connection.query<Record<string, unknown>>(
        `${CLIENT_COLUMNS} WHERE c.owner_user_id = ? AND c.name = ? ORDER BY c.id DESC LIMIT 1`,
        [input.ownerUserId, name],
      );
      if (!rows[0])
        throw new Error("Created integration client could not be read back");
      return mapClient(rows[0]);
    });
  }

  async updateClient(
    idValue: Id,
    input: { readonly name?: string; readonly description?: string | null },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<IntegrationClient | null> {
    const assignments: string[] = [];
    const parameters: unknown[] = [];
    if (input.name !== undefined) {
      assignments.push("name = ?");
      parameters.push(validateClientName(input.name));
    }
    if (input.description !== undefined) {
      assignments.push("description = ?");
      parameters.push(validateDescription(input.description));
    }
    if (assignments.length === 0)
      throw new IntegrationValidationError(
        "At least one client field must be updated",
      );
    assignments.push("updated_at = UTC_TIMESTAMP(6)");
    return this.database.transaction(async (connection) => {
      const current = await findClientOn(connection, idValue, true);
      if (!current) return null;
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)
        throw new IntegrationConflictError(
          "Integration client was changed by another request",
        );
      await connection.execute(
        `UPDATE integration_clients SET ${assignments.join(", ")} WHERE id = ?`,
        [...parameters, idValue],
      );
      return findClientOn(connection, idValue, false);
    });
  }

  async setClientStatus(
    idValue: Id,
    status: IntegrationClientStatus,
    changedByUserId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<IntegrationClient | null> {
    return this.database.transaction(async (connection) => {
      const current = await findClientOn(connection, idValue, true);
      if (!current) return null;
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)
        throw new IntegrationConflictError(
          "Integration client was changed by another request",
        );
      await connection.execute(
        "UPDATE integration_clients SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [status, idValue],
      );
      if (status === "DISABLED") {
        await connection.execute(
          `UPDATE integration_credentials
           SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(6),
               revoked_by_user_id = ?, revoke_reason = 'Client kill switch'
           WHERE integration_client_id = ? AND status = 'ACTIVE'`,
          [changedByUserId, idValue],
        );
      }
      return findClientOn(connection, idValue, false);
    });
  }

  async listCredentials(
    clientId: Id,
  ): Promise<readonly IntegrationCredential[]> {
    const rows = await this.database.query<Record<string, unknown>>(
      `SELECT id, integration_client_id, token_prefix, status, valid_from,
              expires_at, last_used_at, revoked_at, revoke_reason, created_at
       FROM integration_credentials WHERE integration_client_id = ?
       ORDER BY id DESC LIMIT 100`,
      [clientId],
    );
    return rows.map(mapCredential);
  }

  async issueCredential(
    clientId: Id,
    input: {
      readonly tokenPrefix: string;
      readonly tokenDigest: Uint8Array;
      readonly expiresAt?: UtcTimestamp | null;
      readonly rotationParentId?: Id | null;
    },
  ): Promise<IntegrationCredential> {
    return this.database.transaction(async (connection) => {
      const client = await findClientOn(connection, clientId, true);
      if (client?.status !== "ACTIVE")
        throw new IntegrationNotFoundError(
          "Active integration client was not found",
        );
      await connection.execute(
        `INSERT INTO integration_credentials
          (integration_client_id, token_prefix, token_digest, status, expires_at, rotation_parent_id)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          clientId,
          input.tokenPrefix,
          input.tokenDigest,
          input.expiresAt ?? null,
          input.rotationParentId ?? null,
        ],
      );
      const rows = await connection.query<Record<string, unknown>>(
        `SELECT id, integration_client_id, token_prefix, status, valid_from,
                expires_at, last_used_at, revoked_at, revoke_reason, created_at
         FROM integration_credentials WHERE integration_client_id = ? AND token_prefix = ? LIMIT 1`,
        [clientId, input.tokenPrefix],
      );
      if (!rows[0])
        throw new Error("Issued integration credential could not be read back");
      return mapCredential(rows[0]);
    });
  }

  async revokeCredential(
    clientId: Id,
    credentialId: Id,
    revokedByUserId: Id,
    reason: string,
  ): Promise<boolean> {
    const normalizedReason = reason.normalize("NFKC").trim();
    if (!normalizedReason || normalizedReason.length > 500)
      throw new IntegrationValidationError(
        "Revoke reason must be 1-500 characters",
      );
    return this.database.transaction(async (connection) => {
      const result = await connection.execute(
        `UPDATE integration_credentials
         SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(6),
             revoked_by_user_id = ?, revoke_reason = ?
         WHERE id = ? AND integration_client_id = ? AND status = 'ACTIVE'`,
        [revokedByUserId, normalizedReason, credentialId, clientId],
      );
      return (
        Number((result as { affectedRows?: number }).affectedRows ?? 0) === 1
      );
    });
  }

  async listGrants(clientId: Id): Promise<readonly IntegrationGrant[]> {
    const rows = await this.database.query<Record<string, unknown>>(
      `SELECT id, integration_client_id, capability, scope_type, scope_ids_json,
              constraints_json, grant_version, status, valid_from, expires_at,
              issued_by_user_id, revoked_at, revoke_reason, created_at, updated_at
       FROM integration_grants WHERE integration_client_id = ?
       ORDER BY id DESC LIMIT 500`,
      [clientId],
    );
    return rows.map(mapGrant);
  }

  async createGrant(
    input: CreateIntegrationGrantInput,
  ): Promise<IntegrationGrant> {
    const capability = validateCapability(input.capability);
    const scopeType = validateScopeType(input.scopeType);
    const scopeIds = validateScopeIds(scopeType, input.scopeIds);
    const constraints = validateConstraints(input.constraints);
    return this.database.transaction(async (connection) => {
      const client = await findClientOn(connection, input.clientId, true);
      if (client?.status !== "ACTIVE")
        throw new IntegrationNotFoundError(
          "Active integration client was not found",
        );
      if (
        input.expectedPolicyVersion !== undefined &&
        client.policyVersion !== input.expectedPolicyVersion
      )
        throw new IntegrationConflictError(
          "Integration grant policy was changed by another request",
        );
      const nextVersion = client.policyVersion + 1;
      await connection.execute(
        "UPDATE integration_clients SET policy_version = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [nextVersion, input.clientId],
      );
      await connection.execute(
        `INSERT INTO integration_grants
          (integration_client_id, capability, scope_type, scope_ids_json,
           constraints_json, grant_version, status, expires_at, issued_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [
          input.clientId,
          capability,
          scopeType,
          JSON.stringify(scopeIds),
          JSON.stringify(constraints),
          nextVersion,
          input.expiresAt ?? null,
          input.issuedByUserId,
        ],
      );
      const rows = await connection.query<Record<string, unknown>>(
        `SELECT id, integration_client_id, capability, scope_type, scope_ids_json,
                constraints_json, grant_version, status, valid_from, expires_at,
                issued_by_user_id, revoked_at, revoke_reason, created_at, updated_at
         FROM integration_grants WHERE integration_client_id = ? AND grant_version = ? ORDER BY id DESC LIMIT 1`,
        [input.clientId, nextVersion],
      );
      if (!rows[0])
        throw new Error("Created integration grant could not be read back");
      return mapGrant(rows[0]);
    });
  }

  async revokeGrant(
    clientId: Id,
    grantId: Id,
    revokedByUserId: Id,
    reason: string,
  ): Promise<boolean> {
    const normalizedReason = reason.normalize("NFKC").trim();
    if (!normalizedReason || normalizedReason.length > 500)
      throw new IntegrationValidationError(
        "Revoke reason must be 1-500 characters",
      );
    return this.database.transaction(async (connection) => {
      const client = await findClientOn(connection, clientId, true);
      if (!client) return false;
      const grants = await connection.query<Record<string, unknown>>(
        "SELECT id FROM integration_grants WHERE id = ? AND integration_client_id = ? AND status = 'ACTIVE' FOR UPDATE",
        [grantId, clientId],
      );
      if (!grants[0]) return false;
      const nextVersion = client.policyVersion + 1;
      await connection.execute(
        "UPDATE integration_clients SET policy_version = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [nextVersion, clientId],
      );
      await connection.execute(
        `UPDATE integration_grants SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(6),
                revoked_by_user_id = ?, revoke_reason = ?, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND integration_client_id = ? AND status = 'ACTIVE'`,
        [revokedByUserId, normalizedReason, grantId, clientId],
      );
      return true;
    });
  }

  private async listActiveGrants(
    clientId: Id,
  ): Promise<readonly IntegrationGrant[]> {
    const rows = await this.database.query<Record<string, unknown>>(
      `SELECT id, integration_client_id, capability, scope_type, scope_ids_json,
              constraints_json, grant_version, status, valid_from, expires_at,
              issued_by_user_id, revoked_at, revoke_reason, created_at, updated_at
       FROM integration_grants
       WHERE integration_client_id = ? AND status = 'ACTIVE'
         AND valid_from <= UTC_TIMESTAMP(6)
         AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(6))
       ORDER BY id ASC`,
      [clientId],
    );
    return rows.map(mapGrant);
  }
}

async function findClientOn(
  connection: Pick<DatabaseConnection, "query">,
  idValue: Id,
  forUpdate: boolean,
): Promise<IntegrationClient | null> {
  const rows = await connection.query<Record<string, unknown>>(
    `${CLIENT_COLUMNS} WHERE c.id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [idValue],
  );
  return rows[0] ? mapClient(rows[0]) : null;
}

function mapClient(row: Record<string, unknown>): IntegrationClient {
  const ownerRole = String(row.owner_role);
  if (ownerRole !== "ADMIN" && ownerRole !== "TEACHER")
    throw new IntegrationValidationError("Integration owner role is invalid");
  const status = String(row.status) as IntegrationClientStatus;
  if (status !== "ACTIVE" && status !== "DISABLED")
    throw new IntegrationValidationError(
      "Integration client status is invalid",
    );
  return {
    id: id(row.id),
    name: String(row.name),
    platformHint: String(row.platform_hint),
    ownerUserId: id(row.owner_user_id),
    ownerDisplayName: String(row.owner_display_name),
    ownerRole,
    status,
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    policyVersion: Number(row.policy_version),
    createdByUserId: id(row.created_by_user_id),
    lastUsedAt: timestampOrNull(row.last_used_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapCredential(row: Record<string, unknown>): IntegrationCredential {
  const status = String(row.status) as IntegrationCredentialStatus;
  if (status !== "ACTIVE" && status !== "REVOKED")
    throw new IntegrationValidationError(
      "Integration credential status is invalid",
    );
  return {
    id: id(row.id),
    integrationClientId: id(row.integration_client_id),
    tokenPrefix: String(row.token_prefix),
    status,
    validFrom: timestamp(row.valid_from),
    expiresAt: timestampOrNull(row.expires_at),
    lastUsedAt: timestampOrNull(
      row.credential_last_used_at ?? row.last_used_at,
    ),
    revokedAt: timestampOrNull(row.revoked_at),
    revokeReason:
      row.revoke_reason === null || row.revoke_reason === undefined
        ? null
        : String(row.revoke_reason),
    createdAt: timestamp(row.credential_created_at ?? row.created_at),
  };
}

function mapGrant(row: Record<string, unknown>): IntegrationGrant {
  const status = String(row.status) as IntegrationGrantStatus;
  if (status !== "ACTIVE" && status !== "REVOKED")
    throw new IntegrationValidationError("Integration grant status is invalid");
  const scopeType = validateScopeType(String(row.scope_type));
  return {
    id: id(row.id),
    integrationClientId: id(row.integration_client_id),
    capability: validateCapability(String(row.capability)),
    scopeType,
    scopeIds: validateScopeIds(
      scopeType,
      parseJsonIds(parseJson(row.scope_ids_json)),
    ),
    constraints: validateConstraints(
      parseJsonObject(parseJson(row.constraints_json)),
    ),
    grantVersion: Number(row.grant_version),
    status,
    validFrom: timestamp(row.valid_from),
    expiresAt: timestampOrNull(row.expires_at),
    issuedByUserId: id(row.issued_by_user_id),
    revokedAt: timestampOrNull(row.revoked_at),
    revokeReason:
      row.revoke_reason === null || row.revoke_reason === undefined
        ? null
        : String(row.revoke_reason),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  if (value instanceof Uint8Array)
    return JSON.parse(new TextDecoder().decode(value)) as unknown;
  return value;
}

function id(value: unknown): Id {
  const parsed = parseId(String(value));
  if (!parsed)
    throw new IntegrationValidationError(
      "Database returned an invalid integration ID",
    );
  return parsed;
}

function timestamp(value: unknown): UtcTimestamp {
  const date = value instanceof Date ? value : new Date(String(value));
  return formatUtcTimestamp(date);
}

function timestampOrNull(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined ? null : timestamp(value);
}
