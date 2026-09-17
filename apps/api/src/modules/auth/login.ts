import {
  normalizeUsername,
  type StoredUser,
  toUserView,
  type UserRepository,
  UserValidationError,
} from "../users";
import { PasswordBusyError, type PasswordService } from "./password";
import type { AuthSessionCredentials, AuthSessionService } from "./session";

export type LoginAudience = "STAFF" | "PARTICIPANT";

export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly ipAddress?: string;
  readonly audience: LoginAudience;
}

export interface LoginResult {
  readonly user: ReturnType<typeof toUserView>;
  readonly session: AuthSessionCredentials;
}

export class InvalidLoginError extends Error {
  constructor() {
    super("Username atau password salah.");
    this.name = "InvalidLoginError";
  }
}

export class LoginRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Terlalu banyak percobaan login. Coba lagi nanti.");
    this.name = "LoginRateLimitedError";
  }
}

export interface LoginLimitInput {
  readonly accountKey: string;
  readonly ipKey: string;
  readonly audience: LoginAudience;
}

export interface LoginLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface LoginFailureLimiter {
  check(input: LoginLimitInput): Promise<LoginLimitDecision>;
  recordFailure(input: LoginLimitInput): Promise<void>;
  clearAccount(accountKey: string): Promise<void>;
}

export interface AuthLoginServiceOptions {
  readonly users: Pick<UserRepository, "findByUsernameNormalized">;
  readonly passwords: Pick<PasswordService, "verify" | "verifyDummy">;
  readonly sessions: Pick<AuthSessionService, "create">;
  readonly limiter: LoginFailureLimiter;
}

export class AuthLoginService {
  constructor(private readonly options: AuthLoginServiceOptions) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const normalized = normalizeLoginUsername(input.username);
    const limitInput: LoginLimitInput = {
      // Invalid usernames share a constant bucket. This avoids retaining
      // arbitrary attacker-controlled strings in the in-memory limiter.
      accountKey: normalized ?? "invalid",
      ipKey: normalizeIpKey(input.ipAddress),
      audience: input.audience,
    };
    const decision = await this.options.limiter.check(limitInput);
    if (!decision.allowed) {
      throw new LoginRateLimitedError(decision.retryAfterSeconds ?? 60);
    }

    const user = normalized
      ? await this.options.users.findByUsernameNormalized(normalized)
      : null;
    const eligible = isEligibleUser(user, input.audience);
    let passwordMatches = false;
    try {
      passwordMatches = eligible
        ? await this.options.passwords.verify(input.password, user.passwordHash)
        : await this.options.passwords.verifyDummy(input.password);
    } catch (error) {
      if (error instanceof PasswordBusyError) throw error;
      passwordMatches = false;
    }
    if (!eligible || !passwordMatches) {
      await this.options.limiter.recordFailure(limitInput);
      throw new InvalidLoginError();
    }

    await this.options.limiter.clearAccount(limitInput.accountKey);
    const session = await this.options.sessions.create(user.id, user.role);
    return { user: toUserView(user), session };
  }

  loginStaff(input: Omit<LoginInput, "audience">): Promise<LoginResult> {
    return this.login({ ...input, audience: "STAFF" });
  }

  loginParticipant(input: Omit<LoginInput, "audience">): Promise<LoginResult> {
    return this.login({ ...input, audience: "PARTICIPANT" });
  }
}

export class InMemoryLoginFailureLimiter implements LoginFailureLimiter {
  private readonly accounts = new Map<string, FailureBucket>();
  private readonly ips = new Map<string, FailureBucket>();
  private readonly now: () => number;
  private readonly accountLimit: number;
  private readonly ipLimit: number;
  private readonly windowMs: number;

  constructor(
    options: {
      readonly accountLimit?: number;
      readonly ipLimit?: number;
      readonly windowMs?: number;
      readonly clock?: () => number;
    } = {},
  ) {
    this.accountLimit = options.accountLimit ?? 5;
    this.ipLimit = options.ipLimit ?? 300;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.now = options.clock ?? Date.now;
    if (
      !Number.isInteger(this.accountLimit) ||
      this.accountLimit < 1 ||
      !Number.isInteger(this.ipLimit) ||
      this.ipLimit < 1 ||
      !Number.isInteger(this.windowMs) ||
      this.windowMs < 1000
    ) {
      throw new UserValidationError("Login limiter configuration is invalid");
    }
  }

  async check(input: LoginLimitInput): Promise<LoginLimitDecision> {
    const now = this.now();
    const account = checkBucket(
      this.accounts,
      input.accountKey,
      now,
      this.windowMs,
    );
    const ip = checkBucket(this.ips, input.ipKey, now, this.windowMs);
    const retryAfterSeconds = Math.max(
      account.retryAfterSeconds,
      ip.retryAfterSeconds,
    );
    return retryAfterSeconds > 0
      ? { allowed: false, retryAfterSeconds }
      : { allowed: true };
  }

  async recordFailure(input: LoginLimitInput): Promise<void> {
    const now = this.now();
    recordBucket(
      this.accounts,
      input.accountKey,
      now,
      this.windowMs,
      this.accountLimit,
    );
    recordBucket(this.ips, input.ipKey, now, this.windowMs, this.ipLimit);
  }

  async clearAccount(accountKey: string): Promise<void> {
    this.accounts.delete(accountKey);
  }
}

interface FailureBucket {
  windowStartedAt: number;
  failures: number;
  blockedUntil: number;
}

function checkBucket(
  buckets: Map<string, FailureBucket>,
  key: string,
  now: number,
  windowMs: number,
): { retryAfterSeconds: number } {
  const bucket = buckets.get(key);
  if (!bucket) return { retryAfterSeconds: 0 };
  if (now - bucket.windowStartedAt >= windowMs) {
    buckets.delete(key);
    return { retryAfterSeconds: 0 };
  }
  if (bucket.blockedUntil > now) {
    return {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((bucket.blockedUntil - now) / 1000),
      ),
    };
  }
  return { retryAfterSeconds: 0 };
}

function recordBucket(
  buckets: Map<string, FailureBucket>,
  key: string,
  now: number,
  windowMs: number,
  limit: number,
): void {
  const existing = buckets.get(key);
  const bucket =
    !existing || now - existing.windowStartedAt >= windowMs
      ? { windowStartedAt: now, failures: 0, blockedUntil: 0 }
      : existing;
  bucket.failures += 1;
  if (bucket.failures >= limit) bucket.blockedUntil = now + windowMs;
  buckets.set(key, bucket);
}

function normalizeLoginUsername(value: string): string | null {
  try {
    return normalizeUsername(value);
  } catch {
    return null;
  }
}

function normalizeIpKey(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 128 ? normalized : "unknown";
}

function isEligibleUser(
  user: StoredUser | null,
  audience: LoginAudience,
): user is StoredUser {
  if (!user || user.status !== "ACTIVE") return false;
  return audience === "STAFF"
    ? user.role === "ADMIN" || user.role === "TEACHER"
    : user.role === "PARTICIPANT";
}
