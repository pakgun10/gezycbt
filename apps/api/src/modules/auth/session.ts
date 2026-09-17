import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import { type UserRole, validateUserRole } from "../users/domain";

export const AUTH_COOKIE_NAME = "__Host-gezycbt-auth";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
export const AUTH_COOKIE_ATTRIBUTES = [
  "Path=/",
  "Secure",
  "HttpOnly",
  "SameSite=Strict",
] as const;

const TOKEN_BYTES = 32;
const STAFF_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const STAFF_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const PARTICIPANT_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const PARTICIPANT_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface AuthSession {
  readonly id: Id;
  readonly userId: Id;
  readonly role: UserRole;
  readonly createdAt: UtcTimestamp;
  readonly lastSeenAt: UtcTimestamp;
  readonly idleExpiresAt: UtcTimestamp;
  readonly absoluteExpiresAt: UtcTimestamp;
  readonly revokedAt: UtcTimestamp | null;
  readonly revokeReason: string | null;
}

export interface CreateAuthSessionInput {
  readonly userId: Id;
  readonly role: UserRole;
  readonly tokenHash: Uint8Array;
  readonly csrfSecretHash: Uint8Array;
  readonly createdAt: UtcTimestamp;
  readonly lastSeenAt: UtcTimestamp;
  readonly idleExpiresAt: UtcTimestamp;
  readonly absoluteExpiresAt: UtcTimestamp;
  readonly ipPrefixHash?: Uint8Array;
  readonly userAgentHash?: Uint8Array;
}

export interface RotateAuthSessionInput extends CreateAuthSessionInput {
  readonly previousTokenHash: Uint8Array;
  readonly previousExpiresAt: UtcTimestamp;
}

export interface AuthSessionRepository {
  create(input: CreateAuthSessionInput): Promise<AuthSession>;
  findActiveByTokenHash(
    tokenHash: Uint8Array,
    now: UtcTimestamp,
  ): Promise<AuthSession | null>;
  findActiveCsrfSecretHash(
    id: Id,
    now: UtcTimestamp,
  ): Promise<Uint8Array | null>;
  touch(
    id: Id,
    lastSeenAt: UtcTimestamp,
    idleExpiresAt: UtcTimestamp,
    now: UtcTimestamp,
  ): Promise<boolean>;
  rotate(input: RotateAuthSessionInput): Promise<AuthSession | null>;
  revokeByTokenHash(
    tokenHash: Uint8Array,
    reason: string,
    now: UtcTimestamp,
  ): Promise<boolean>;
  revoke(id: Id, reason: string, now: UtcTimestamp): Promise<boolean>;
  revokeAllForUser(
    userId: Id,
    reason: string,
    now: UtcTimestamp,
  ): Promise<number>;
}

export interface AuthSessionServiceOptions {
  readonly repository: AuthSessionRepository;
  readonly clock?: () => Date;
  readonly tokenGenerator?: () => string;
  readonly csrfGenerator?: () => string;
  readonly touchIntervalMs?: number;
}

export interface AuthSessionCredentials {
  readonly token: string;
  readonly csrfSecret: string;
  readonly cookie: string;
  readonly session: AuthSession;
}

export class AuthSessionService {
  private readonly clock: () => Date;
  private readonly tokenGenerator: () => string;
  private readonly csrfGenerator: () => string;
  private readonly touchIntervalMs: number;

  constructor(private readonly options: AuthSessionServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.tokenGenerator = options.tokenGenerator ?? generateOpaqueToken;
    this.csrfGenerator = options.csrfGenerator ?? generateOpaqueToken;
    this.touchIntervalMs = options.touchIntervalMs ?? 5 * 60 * 1000;
    if (
      !Number.isInteger(this.touchIntervalMs) ||
      this.touchIntervalMs < 0 ||
      this.touchIntervalMs > 60 * 60 * 1000
    ) {
      throw new RangeError("touchIntervalMs must be between 0 and 3600000");
    }
  }

  async create(userId: Id, role: UserRole): Promise<AuthSessionCredentials> {
    validateUserRole(role);
    const now = this.clock();
    const createdAt = formatUtcTimestamp(now);
    const policy = sessionPolicyFor(role);
    const absoluteExpiresAt = formatUtcTimestamp(
      new Date(now.getTime() + policy.absoluteTimeoutMs),
    );
    const idleExpiresAt = formatUtcTimestamp(
      new Date(
        Math.min(
          now.getTime() + policy.idleTimeoutMs,
          new Date(absoluteExpiresAt).getTime(),
        ),
      ),
    );
    const token = this.tokenGenerator();
    const csrfSecret = this.csrfGenerator();
    assertOpaqueToken(token);
    assertOpaqueToken(csrfSecret);
    const session = await this.options.repository.create({
      userId,
      role,
      tokenHash: await digestToken(token),
      csrfSecretHash: await digestToken(csrfSecret),
      createdAt,
      lastSeenAt: createdAt,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    return {
      token,
      csrfSecret,
      cookie: serializeAuthCookie(token, secondsUntil(absoluteExpiresAt, now)),
      session,
    };
  }

  async resolve(token: string): Promise<AuthSession | null> {
    if (!isOpaqueToken(token)) return null;
    return this.options.repository.findActiveByTokenHash(
      await digestToken(token),
      formatUtcTimestamp(this.clock()),
    );
  }

  async touch(session: AuthSession): Promise<AuthSession | null> {
    const now = this.clock();
    const lastSeenAt = new Date(session.lastSeenAt).getTime();
    if (now.getTime() - lastSeenAt < this.touchIntervalMs) return session;
    const policy = sessionPolicyFor(session.role);
    const idleExpiresAt = formatUtcTimestamp(
      new Date(
        Math.min(
          now.getTime() + policy.idleTimeoutMs,
          new Date(session.absoluteExpiresAt).getTime(),
        ),
      ),
    );
    const timestamp = formatUtcTimestamp(now);
    const touched = await this.options.repository.touch(
      session.id,
      timestamp,
      idleExpiresAt,
      timestamp,
    );
    if (!touched) return null;
    return { ...session, lastSeenAt: timestamp, idleExpiresAt };
  }

  async verifyCsrfSecret(sessionId: Id, csrfSecret: string): Promise<boolean> {
    if (!isOpaqueToken(csrfSecret)) return false;
    const storedHash = await this.options.repository.findActiveCsrfSecretHash(
      sessionId,
      formatUtcTimestamp(this.clock()),
    );
    if (!storedHash) return false;
    return secureEqualBytes(storedHash, await digestToken(csrfSecret));
  }

  async rotate(token: string): Promise<AuthSessionCredentials | null> {
    const previous = await this.resolve(token);
    if (!previous) return null;
    const now = this.clock();
    const createdAt = formatUtcTimestamp(now);
    const policy = sessionPolicyFor(previous.role);
    const absoluteExpiresAt = formatUtcTimestamp(
      new Date(
        Math.min(
          new Date(previous.absoluteExpiresAt).getTime(),
          now.getTime() + policy.absoluteTimeoutMs,
        ),
      ),
    );
    const idleExpiresAt = formatUtcTimestamp(
      new Date(
        Math.min(
          now.getTime() + policy.idleTimeoutMs,
          new Date(absoluteExpiresAt).getTime(),
        ),
      ),
    );
    const nextToken = this.tokenGenerator();
    const csrfSecret = this.csrfGenerator();
    assertOpaqueToken(nextToken);
    assertOpaqueToken(csrfSecret);
    const session = await this.options.repository.rotate({
      previousTokenHash: await digestToken(token),
      previousExpiresAt: formatUtcTimestamp(now),
      userId: previous.userId,
      role: previous.role,
      tokenHash: await digestToken(nextToken),
      csrfSecretHash: await digestToken(csrfSecret),
      createdAt,
      lastSeenAt: createdAt,
      idleExpiresAt,
      absoluteExpiresAt,
    });
    if (!session) return null;
    return {
      token: nextToken,
      csrfSecret,
      cookie: serializeAuthCookie(
        nextToken,
        secondsUntil(absoluteExpiresAt, now),
      ),
      session,
    };
  }

  async logout(token: string): Promise<boolean> {
    if (!isOpaqueToken(token)) return false;
    return this.options.repository.revokeByTokenHash(
      await digestToken(token),
      "LOGOUT",
      formatUtcTimestamp(this.clock()),
    );
  }

  revokeUserSessions(userId: Id, reason = "USER_REVOKED"): Promise<number> {
    return this.options.repository.revokeAllForUser(
      userId,
      reason,
      formatUtcTimestamp(this.clock()),
    );
  }
}

export function serializeAuthCookie(
  token: string,
  maxAgeSeconds = AUTH_COOKIE_MAX_AGE_SECONDS,
): string {
  assertOpaqueToken(token);
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new RangeError("Cookie max age must be a non-negative integer");
  }
  return `${AUTH_COOKIE_NAME}=${token}; Max-Age=${maxAgeSeconds}; ${AUTH_COOKIE_ATTRIBUTES.join("; ")}`;
}

export function serializeLogoutCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; ${AUTH_COOKIE_ATTRIBUTES.join("; ")}`;
}

export function readAuthCookie(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTH_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return isOpaqueToken(value) ? value : null;
  }
  return null;
}

export class SqlAuthSessionRepository implements AuthSessionRepository {
  constructor(private readonly database: DatabasePort) {}

  async create(input: CreateAuthSessionInput): Promise<AuthSession> {
    const result = await this.database.execute(
      `INSERT INTO auth_sessions
        (user_id, token_hash, csrf_secret_hash, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at, ip_prefix_hash, user_agent_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.tokenHash,
        input.csrfSecretHash,
        toDatabaseDate(input.createdAt),
        toDatabaseDate(input.lastSeenAt),
        toDatabaseDate(input.idleExpiresAt),
        toDatabaseDate(input.absoluteExpiresAt),
        input.ipPrefixHash ?? null,
        input.userAgentHash ?? null,
      ],
    );
    if (result.insertId === undefined) {
      throw new Error("Auth session insert did not return an ID");
    }
    const session = await this.findById(
      this.database,
      formatId(result.insertId),
    );
    if (!session)
      throw new Error("Created auth session could not be read back");
    return session;
  }

  findActiveByTokenHash(
    tokenHash: Uint8Array,
    now: UtcTimestamp,
  ): Promise<AuthSession | null> {
    return this.database
      .query<AuthSessionRow>(
        `${SESSION_COLUMNS}
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL
           AND u.status = 'ACTIVE'
           AND s.idle_expires_at > ? AND s.absolute_expires_at > ?
         LIMIT 1`,
        [tokenHash, toDatabaseDate(now), toDatabaseDate(now)],
      )
      .then((rows) => (rows[0] ? mapSessionRow(rows[0]) : null));
  }

  async findActiveCsrfSecretHash(
    id: Id,
    now: UtcTimestamp,
  ): Promise<Uint8Array | null> {
    const rows = await this.database.query<{
      csrf_secret_hash: unknown;
    }>(
      `SELECT csrf_secret_hash FROM auth_sessions
       WHERE id = ? AND revoked_at IS NULL
         AND idle_expires_at > ? AND absolute_expires_at > ?
       LIMIT 1`,
      [id, toDatabaseDate(now), toDatabaseDate(now)],
    );
    if (!rows[0]) return null;
    return toBytes(rows[0].csrf_secret_hash);
  }

  async touch(
    id: Id,
    lastSeenAt: UtcTimestamp,
    idleExpiresAt: UtcTimestamp,
    now: UtcTimestamp,
  ): Promise<boolean> {
    const result = await this.database.execute(
      `UPDATE auth_sessions
       SET last_seen_at = ?, idle_expires_at = ?
       WHERE id = ? AND revoked_at IS NULL
         AND idle_expires_at > ? AND absolute_expires_at > ?`,
      [
        toDatabaseDate(lastSeenAt),
        toDatabaseDate(idleExpiresAt),
        id,
        toDatabaseDate(now),
        toDatabaseDate(now),
      ],
    );
    return result.affectedRows === 1;
  }

  async rotate(input: RotateAuthSessionInput): Promise<AuthSession | null> {
    return this.database.transaction(async (connection) => {
      const current = await connection.query<{ id: unknown }>(
        `SELECT s.id FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL
           AND u.status = 'ACTIVE'
           AND s.idle_expires_at > ? AND s.absolute_expires_at > ?
         FOR UPDATE`,
        [
          input.previousTokenHash,
          toDatabaseDate(input.previousExpiresAt),
          toDatabaseDate(input.previousExpiresAt),
        ],
      );
      if (!current[0]) return null;
      await connection.execute(
        `UPDATE auth_sessions
         SET revoked_at = ?, revoke_reason = 'ROTATED'
         WHERE id = ? AND revoked_at IS NULL`,
        [toDatabaseDate(input.previousExpiresAt), current[0].id],
      );
      const result = await connection.execute(
        `INSERT INTO auth_sessions
          (user_id, token_hash, csrf_secret_hash, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, ip_prefix_hash, user_agent_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.userId,
          input.tokenHash,
          input.csrfSecretHash,
          toDatabaseDate(input.createdAt),
          toDatabaseDate(input.lastSeenAt),
          toDatabaseDate(input.idleExpiresAt),
          toDatabaseDate(input.absoluteExpiresAt),
          input.ipPrefixHash ?? null,
          input.userAgentHash ?? null,
        ],
      );
      if (result.insertId === undefined) {
        throw new Error("Rotated auth session insert did not return an ID");
      }
      return this.findById(connection, formatId(result.insertId));
    });
  }

  async revokeByTokenHash(
    tokenHash: Uint8Array,
    reason: string,
    now: UtcTimestamp,
  ): Promise<boolean> {
    const result = await this.database.execute(
      `UPDATE auth_sessions
       SET revoked_at = ?, revoke_reason = ?
       WHERE token_hash = ? AND revoked_at IS NULL`,
      [toDatabaseDate(now), boundedReason(reason), tokenHash],
    );
    return result.affectedRows === 1;
  }

  async revoke(id: Id, reason: string, now: UtcTimestamp): Promise<boolean> {
    const result = await this.database.execute(
      `UPDATE auth_sessions
       SET revoked_at = ?, revoke_reason = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [toDatabaseDate(now), boundedReason(reason), id],
    );
    return result.affectedRows === 1;
  }

  async revokeAllForUser(
    userId: Id,
    reason: string,
    now: UtcTimestamp,
  ): Promise<number> {
    const result = await this.database.execute(
      `UPDATE auth_sessions
       SET revoked_at = ?, revoke_reason = ?
       WHERE user_id = ? AND revoked_at IS NULL`,
      [toDatabaseDate(now), boundedReason(reason), userId],
    );
    return result.affectedRows;
  }

  private findById(
    connection: DatabaseConnection,
    id: Id,
  ): Promise<AuthSession | null> {
    return connection
      .query<AuthSessionRow>(
        `${SESSION_COLUMNS} JOIN users u ON u.id = s.user_id WHERE s.id = ? LIMIT 1`,
        [id],
      )
      .then((rows) => (rows[0] ? mapSessionRow(rows[0]) : null));
  }
}

type AuthSessionRow = Record<string, unknown> & {
  id: unknown;
  user_id: unknown;
  role: unknown;
  created_at: unknown;
  last_seen_at: unknown;
  idle_expires_at: unknown;
  absolute_expires_at: unknown;
  revoked_at: unknown;
  revoke_reason: unknown;
};

const SESSION_COLUMNS = `
  SELECT s.id, s.user_id, u.role, s.created_at, s.last_seen_at,
         s.idle_expires_at, s.absolute_expires_at, s.revoked_at,
         s.revoke_reason
  FROM auth_sessions s`;

function mapSessionRow(row: AuthSessionRow): AuthSession {
  const id = parseDatabaseId(row.id);
  const userId = parseDatabaseId(row.user_id);
  if (!id || !userId)
    throw new Error("Database returned an invalid auth session ID");
  if (typeof row.role !== "string")
    throw new Error("Database returned an invalid session role");
  validateUserRole(row.role);
  return {
    id,
    userId,
    role: row.role,
    createdAt: toTimestamp(row.created_at),
    lastSeenAt: toTimestamp(row.last_seen_at),
    idleExpiresAt: toTimestamp(row.idle_expires_at),
    absoluteExpiresAt: toTimestamp(row.absolute_expires_at),
    revokedAt: toNullableTimestamp(row.revoked_at),
    revokeReason:
      row.revoke_reason === null || row.revoke_reason === undefined
        ? null
        : String(row.revoke_reason),
  };
}

function sessionPolicyFor(role: UserRole): {
  readonly idleTimeoutMs: number;
  readonly absoluteTimeoutMs: number;
} {
  return role === "PARTICIPANT"
    ? {
        idleTimeoutMs: PARTICIPANT_IDLE_TIMEOUT_MS,
        absoluteTimeoutMs: PARTICIPANT_ABSOLUTE_TIMEOUT_MS,
      }
    : {
        idleTimeoutMs: STAFF_IDLE_TIMEOUT_MS,
        absoluteTimeoutMs: STAFF_ABSOLUTE_TIMEOUT_MS,
      };
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function digestToken(token: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return new Uint8Array(digest);
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function secureEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Database returned an invalid binary session value");
}

function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function assertOpaqueToken(value: string): void {
  if (!isOpaqueToken(value))
    throw new Error("Opaque token must contain 256 bits");
}

function secondsUntil(timestamp: UtcTimestamp, now: Date): number {
  return Math.max(
    0,
    Math.ceil((new Date(timestamp).getTime() - now.getTime()) / 1000),
  );
}

function toDatabaseDate(timestamp: UtcTimestamp): string {
  return timestamp.replace("T", " ").replace("Z", "");
}

function parseDatabaseId(value: unknown): Id | undefined {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return formatId(BigInt(value));
  }
  return parseId(value);
}

function toTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const timestamp = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (timestamp) return timestamp;
  }
  throw new Error("Database returned an invalid auth session timestamp");
}

function toNullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined ? null : toTimestamp(value);
}

function boundedReason(reason: string): string {
  const value = reason.trim();
  if (value.length < 1 || value.length > 100) {
    throw new RangeError("Session revoke reason must be 1-100 characters");
  }
  return value;
}
