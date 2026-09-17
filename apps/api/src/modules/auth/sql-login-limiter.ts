import { formatUtcTimestamp } from "@gezycbt/contracts";
import type {
  LoginFailureLimiter,
  LoginLimitDecision,
  LoginLimitInput,
} from "./login";
import type { AuthThrottleRepository } from "./throttle-repository";

export interface SqlLoginFailureLimiterOptions {
  readonly accountLimit?: number;
  readonly ipLimit?: number;
  readonly windowMs?: number;
  readonly clock?: () => Date;
}

const THROTTLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** MariaDB-backed limiter; buckets survive process restarts and are shared by API workers. */
export class SqlLoginFailureLimiter implements LoginFailureLimiter {
  private readonly accountLimit: number;
  private readonly ipLimit: number;
  private readonly windowMs: number;
  private readonly clock: () => Date;

  constructor(
    private readonly repository: AuthThrottleRepository,
    options: SqlLoginFailureLimiterOptions = {},
  ) {
    this.accountLimit = options.accountLimit ?? 5;
    this.ipLimit = options.ipLimit ?? 300;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.clock = options.clock ?? (() => new Date());
    if (
      !Number.isInteger(this.accountLimit) ||
      this.accountLimit < 1 ||
      !Number.isInteger(this.ipLimit) ||
      this.ipLimit < 1 ||
      !Number.isInteger(this.windowMs) ||
      this.windowMs < 1_000
    )
      throw new RangeError("Login limiter configuration is invalid");
  }

  async check(input: LoginLimitInput): Promise<LoginLimitDecision> {
    const now = this.clock();
    const nowMs = now.getTime();
    const [account, ip] = await Promise.all([
      this.repository.find("LOGIN_ACCOUNT", await hashKey(input.accountKey)),
      this.repository.find("LOGIN_IP", await hashKey(input.ipKey)),
    ]);
    const retryAfterSeconds = Math.max(
      retryAfter(account, nowMs, this.windowMs),
      retryAfter(ip, nowMs, this.windowMs),
    );
    return retryAfterSeconds > 0
      ? { allowed: false, retryAfterSeconds }
      : { allowed: true };
  }

  async recordFailure(input: LoginLimitInput): Promise<void> {
    const now = formatUtcTimestamp(this.clock());
    await Promise.all([
      this.repository.recordFailure({
        category: "LOGIN_ACCOUNT",
        keyHash: await hashKey(input.accountKey),
        now,
        windowMs: this.windowMs,
        limit: this.accountLimit,
      }),
      this.repository.recordFailure({
        category: "LOGIN_IP",
        keyHash: await hashKey(input.ipKey),
        now,
        windowMs: this.windowMs,
        limit: this.ipLimit,
      }),
    ]);
  }

  clearAccount(accountKey: string): Promise<void> {
    return hashKey(accountKey).then((keyHash) =>
      this.repository.clear("LOGIN_ACCOUNT", keyHash),
    );
  }

  cleanupExpired(
    before = new Date(this.clock().getTime() - THROTTLE_RETENTION_MS),
    now = this.clock(),
  ): Promise<number> {
    return this.repository.cleanupExpired({
      before: formatUtcTimestamp(before),
      now: formatUtcTimestamp(now),
    });
  }
}

function retryAfter(
  bucket: Awaited<ReturnType<AuthThrottleRepository["find"]>>,
  nowMs: number,
  windowMs: number,
): number {
  if (!bucket) return 0;
  const windowExpired =
    nowMs - new Date(bucket.windowStartedAt).getTime() >= windowMs;
  if (windowExpired || !bucket.blockedUntil) return 0;
  return Math.max(
    1,
    Math.ceil((new Date(bucket.blockedUntil).getTime() - nowMs) / 1000),
  );
}

async function hashKey(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}
