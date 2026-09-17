import {
  type UserRole,
  UserValidationError,
  validatePasswordHash,
} from "../users/domain";

export type PasswordAccountRole = Extract<
  UserRole,
  "ADMIN" | "TEACHER" | "PARTICIPANT"
>;

export interface PasswordHashOptions {
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly algorithm: "argon2id";
}

export interface PasswordEngine {
  hash(password: string, options: PasswordHashOptions): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface PasswordServiceOptions {
  readonly maxConcurrent?: number;
  readonly maxQueue?: number;
  readonly engine?: PasswordEngine;
}

export const PASSWORD_HASH_OPTIONS: PasswordHashOptions = {
  algorithm: "argon2id",
  memoryCost: 19_456,
  timeCost: 2,
};

export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$xj6T/Uz/y58PA1IStE+jsV1ZnsXLGu5R5LC59/rNSrI$zDM46T4vNjnoa2vqe0nPTjogovPdUWfWS1BPe30BW5w";

export class PasswordBusyError extends Error {
  readonly retryAfterSeconds = 1;

  constructor() {
    super("Password hashing service is busy");
    this.name = "PasswordBusyError";
  }
}

export class PasswordHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordHashError";
  }
}

export interface PasswordPolicy {
  readonly minimumLength: number;
  readonly maximumLength: number;
}

export function passwordPolicyFor(role: PasswordAccountRole): PasswordPolicy {
  return role === "PARTICIPANT"
    ? { minimumLength: 8, maximumLength: 128 }
    : { minimumLength: 12, maximumLength: 128 };
}

export function validatePassword(
  password: string,
  role: PasswordAccountRole,
  usernameNormalized?: string,
): void {
  const policy = passwordPolicyFor(role);
  const length = [...password].length;
  if (length < policy.minimumLength || length > policy.maximumLength) {
    throw new UserValidationError(
      `${role === "PARTICIPANT" ? "Participant" : "Staff"} password must be ${policy.minimumLength}-${policy.maximumLength} characters`,
    );
  }
  if ([...password].some((character) => isControlCharacter(character))) {
    throw new UserValidationError(
      "Password contains an unsupported control character",
    );
  }
  if (
    usernameNormalized !== undefined &&
    password.normalize("NFKC").toLowerCase() === usernameNormalized
  ) {
    throw new UserValidationError("Password must differ from username");
  }
}

export class PasswordService {
  private readonly queue: BoundedAsyncQueue;
  private readonly engine: PasswordEngine;

  constructor(options: PasswordServiceOptions = {}) {
    this.queue = new BoundedAsyncQueue(
      options.maxConcurrent ?? 4,
      options.maxQueue ?? 32,
    );
    this.engine = options.engine ?? bunPasswordEngine;
  }

  hash(
    password: string,
    role: PasswordAccountRole,
    usernameNormalized?: string,
  ): Promise<string> {
    validatePassword(password, role, usernameNormalized);
    return this.queue.run(async () => {
      const hash = await this.engine.hash(password, PASSWORD_HASH_OPTIONS);
      try {
        return validatePasswordHash(hash);
      } catch {
        throw new PasswordHashError(
          "Password engine returned an invalid PHC hash",
        );
      }
    });
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    try {
      validatePasswordHash(storedHash);
    } catch {
      throw new PasswordHashError("Stored password hash is invalid");
    }
    return this.queue.run(() => this.engine.verify(password, storedHash));
  }

  verifyDummy(password: string): Promise<boolean> {
    return this.verify(password, DUMMY_PASSWORD_HASH);
  }

  get queueDepth(): number {
    return this.queue.depth;
  }
}

class BoundedAsyncQueue {
  private active = 0;
  private readonly pending: Array<{
    readonly operation: () => Promise<unknown>;
    readonly resolve: (value: unknown) => void;
    readonly reject: (reason?: unknown) => void;
  }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {
    if (
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < 1 ||
      maxConcurrent > 8
    ) {
      throw new UserValidationError("maxConcurrent must be between 1 and 8");
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 128) {
      throw new UserValidationError("maxQueue must be between 0 and 128");
    }
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.pending.length >= this.maxQueue) {
      throw new PasswordBusyError();
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        operation: async () => operation(),
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.drain();
    });
  }

  get depth(): number {
    return this.active + this.pending.length;
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) return;
      this.active += 1;
      Promise.resolve()
        .then(task.operation)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const bunPasswordEngine: PasswordEngine = {
  hash(password, options) {
    return Bun.password.hash(password, options);
  },
  verify(password, hash) {
    return Bun.password.verify(password, hash);
  },
};

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0 && codePoint < 0x20) ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}
