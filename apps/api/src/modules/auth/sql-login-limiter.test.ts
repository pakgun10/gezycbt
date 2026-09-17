import { describe, expect, test } from "bun:test";
import type { UtcTimestamp } from "@gezycbt/contracts";
import { SqlLoginFailureLimiter } from "./sql-login-limiter";
import type {
  AuthThrottleBucket,
  AuthThrottleCategory,
  AuthThrottleRepository,
} from "./throttle-repository";

const START = new Date("2026-09-17T00:00:00.000Z");

describe("SqlLoginFailureLimiter", () => {
  test("shares failure budget between limiter instances", async () => {
    let now = START;
    const repository = new FakeThrottleRepository();
    const first = new SqlLoginFailureLimiter(repository, {
      accountLimit: 2,
      ipLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });
    await first.recordFailure(input());
    await first.recordFailure(input());

    const restarted = new SqlLoginFailureLimiter(repository, {
      accountLimit: 2,
      ipLimit: 10,
      windowMs: 60_000,
      clock: () => now,
    });
    await expect(restarted.check(input())).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now = new Date(START.getTime() + 60_001);
    await expect(restarted.check(input())).resolves.toEqual({ allowed: true });
  });

  test("clears only the account bucket after a successful login", async () => {
    const repository = new FakeThrottleRepository();
    const limiter = new SqlLoginFailureLimiter(repository, {
      accountLimit: 2,
      ipLimit: 2,
      clock: () => START,
    });
    await limiter.recordFailure(input());
    await limiter.clearAccount("student");
    await expect(limiter.check(input())).resolves.toEqual({ allowed: true });
    expect(repository.count("LOGIN_IP")).toBe(1);
  });
});

function input() {
  return {
    accountKey: "student",
    ipKey: "192.0.2.10",
    audience: "PARTICIPANT" as const,
  };
}

class FakeThrottleRepository implements AuthThrottleRepository {
  private readonly buckets = new Map<string, AuthThrottleBucket>();

  async find(
    category: AuthThrottleCategory,
    keyHash: Uint8Array,
  ): Promise<AuthThrottleBucket | null> {
    return this.buckets.get(key(category, keyHash)) ?? null;
  }

  async recordFailure(input: {
    category: AuthThrottleCategory;
    keyHash: Uint8Array;
    now: UtcTimestamp;
    windowMs: number;
    limit: number;
  }): Promise<void> {
    const bucketKey = key(input.category, input.keyHash);
    const existing = this.buckets.get(bucketKey);
    const nowMs = Date.parse(input.now);
    const active =
      existing && nowMs - Date.parse(existing.windowStartedAt) < input.windowMs;
    const count = active ? existing.failureCount + 1 : 1;
    this.buckets.set(bucketKey, {
      windowStartedAt: active ? existing.windowStartedAt : input.now,
      failureCount: count,
      blockedUntil:
        count >= input.limit
          ? (new Date(nowMs + input.windowMs).toISOString() as UtcTimestamp)
          : null,
      lastFailureAt: input.now,
    });
  }

  async clear(
    category: AuthThrottleCategory,
    keyHash: Uint8Array,
  ): Promise<void> {
    this.buckets.delete(key(category, keyHash));
  }

  async cleanupExpired(): Promise<number> {
    return 0;
  }

  count(category: AuthThrottleCategory): number {
    return [...this.buckets.keys()].filter((value) =>
      value.startsWith(`${category}:`),
    ).length;
  }
}

function key(category: AuthThrottleCategory, hash: Uint8Array): string {
  return `${category}:${Buffer.from(hash).toString("hex")}`;
}
