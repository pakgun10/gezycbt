import {
  formatUtcTimestamp,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";

export type AuthThrottleCategory =
  | "LOGIN_ACCOUNT"
  | "LOGIN_IP"
  | "PRACTICE_TOKEN"
  | "PRACTICE_IP"
  | "MAIN_CODE_IP";

export interface AuthThrottleBucket {
  readonly windowStartedAt: UtcTimestamp;
  readonly failureCount: number;
  readonly blockedUntil: UtcTimestamp | null;
  readonly lastFailureAt: UtcTimestamp;
}

export interface AuthThrottleRepository {
  find(
    category: AuthThrottleCategory,
    keyHash: Uint8Array,
  ): Promise<AuthThrottleBucket | null>;
  recordFailure(input: {
    readonly category: AuthThrottleCategory;
    readonly keyHash: Uint8Array;
    readonly now: UtcTimestamp;
    readonly windowMs: number;
    readonly limit: number;
  }): Promise<void>;
  clear(category: AuthThrottleCategory, keyHash: Uint8Array): Promise<void>;
  cleanupExpired(input: {
    readonly before: UtcTimestamp;
    readonly now: UtcTimestamp;
    readonly limit?: number;
  }): Promise<number>;
}

type ThrottleRow = Record<string, unknown> & {
  window_started_at: unknown;
  failure_count: unknown;
  blocked_until: unknown;
  last_failure_at: unknown;
};

export class SqlAuthThrottleRepository implements AuthThrottleRepository {
  constructor(private readonly database: DatabasePort) {}

  async find(
    category: AuthThrottleCategory,
    keyHash: Uint8Array,
  ): Promise<AuthThrottleBucket | null> {
    const rows = await this.database.query<ThrottleRow>(
      `SELECT window_started_at, failure_count, blocked_until, last_failure_at
       FROM auth_throttles WHERE category = ? AND key_hash = ? LIMIT 1`,
      [category, keyHash],
    );
    return rows[0] ? mapThrottleRow(rows[0]) : null;
  }

  async recordFailure(input: {
    readonly category: AuthThrottleCategory;
    readonly keyHash: Uint8Array;
    readonly now: UtcTimestamp;
    readonly windowMs: number;
    readonly limit: number;
  }): Promise<void> {
    await this.database.transaction(async (connection) => {
      const rows = await connection.query<ThrottleRow>(
        `SELECT window_started_at, failure_count, blocked_until, last_failure_at
         FROM auth_throttles WHERE category = ? AND key_hash = ?
         LIMIT 1 FOR UPDATE`,
        [input.category, input.keyHash],
      );
      const existing = rows[0] ? mapThrottleRow(rows[0]) : null;
      const nowMs = new Date(input.now).getTime();
      const windowStartMs = existing
        ? new Date(existing.windowStartedAt).getTime()
        : Number.NaN;
      const withinWindow =
        existing !== null && nowMs - windowStartMs < input.windowMs;
      // A request that raced with a blocked check must not extend the lockout.
      if (withinWindow && existing?.blockedUntil) {
        const blockedUntilMs = new Date(existing.blockedUntil).getTime();
        if (blockedUntilMs > nowMs) return;
      }
      const windowStartedAt = withinWindow
        ? existing.windowStartedAt
        : input.now;
      const failureCount = withinWindow ? (existing?.failureCount ?? 0) + 1 : 1;
      const blockedUntil =
        failureCount >= input.limit
          ? formatUtcTimestamp(new Date(nowMs + input.windowMs))
          : null;
      if (!existing) {
        await connection.execute(
          `INSERT INTO auth_throttles
             (category, key_hash, window_started_at, failure_count, blocked_until, last_failure_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            input.category,
            input.keyHash,
            toDatabaseDate(windowStartedAt),
            failureCount,
            blockedUntil ? toDatabaseDate(blockedUntil) : null,
            toDatabaseDate(input.now),
          ],
        );
      } else {
        await connection.execute(
          `UPDATE auth_throttles
           SET window_started_at = ?, failure_count = ?, blocked_until = ?, last_failure_at = ?
           WHERE category = ? AND key_hash = ?`,
          [
            toDatabaseDate(windowStartedAt),
            failureCount,
            blockedUntil ? toDatabaseDate(blockedUntil) : null,
            toDatabaseDate(input.now),
            input.category,
            input.keyHash,
          ],
        );
      }
    });
  }

  async clear(
    category: AuthThrottleCategory,
    keyHash: Uint8Array,
  ): Promise<void> {
    await this.database.execute(
      "DELETE FROM auth_throttles WHERE category = ? AND key_hash = ?",
      [category, keyHash],
    );
  }

  cleanupExpired(input: {
    readonly before: UtcTimestamp;
    readonly now: UtcTimestamp;
    readonly limit?: number;
  }): Promise<number> {
    const limit = input.limit ?? 1_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000)
      throw new RangeError("cleanup limit must be between 1 and 10000");
    return this.database
      .execute(
        `DELETE FROM auth_throttles
         WHERE last_failure_at < ? AND (blocked_until IS NULL OR blocked_until <= ?)
         LIMIT ${limit}`,
        [toDatabaseDate(input.before), toDatabaseDate(input.now)],
      )
      .then((result) => result.affectedRows);
  }
}

function mapThrottleRow(row: ThrottleRow): AuthThrottleBucket {
  const windowStartedAt = toTimestamp(row.window_started_at);
  const lastFailureAt = toTimestamp(row.last_failure_at);
  const failureCount = Number(row.failure_count);
  if (!Number.isSafeInteger(failureCount) || failureCount < 0)
    throw new Error("Database returned an invalid throttle failure count");
  return {
    windowStartedAt,
    failureCount,
    blockedUntil:
      row.blocked_until === null || row.blocked_until === undefined
        ? null
        : toTimestamp(row.blocked_until),
    lastFailureAt,
  };
}

function toDatabaseDate(timestamp: UtcTimestamp): string {
  return timestamp.replace("T", " ").replace("Z", "");
}

function toTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const timestamp = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (timestamp) return timestamp;
  }
  throw new Error("Database returned an invalid auth throttle timestamp");
}
