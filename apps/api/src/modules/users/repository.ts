import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  type CreateUserInput,
  normalizeUsername,
  type StoredUser,
  type UpdateUserInput,
  UserConflictError,
  UserValidationError,
  UserVersionConflictError,
  validateDisplayName,
  validatePasswordHash,
  validateUserRole,
  validateUserStatus,
} from "./domain";

export interface UserRepositoryConnection {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface UserRepositoryDatabase extends UserRepositoryConnection {
  transaction<T>(
    operation: (connection: UserRepositoryConnection) => Promise<T>,
  ): Promise<T>;
}

export interface UserRepository {
  create(input: CreateUserInput): Promise<StoredUser>;
  createFirstAdmin(input: CreateUserInput): Promise<StoredUser>;
  findById(id: Id): Promise<StoredUser | null>;
  findByUsernameNormalized(
    usernameNormalized: string,
  ): Promise<StoredUser | null>;
  update(
    id: Id,
    input: UpdateUserInput,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<StoredUser | null>;
  disable(id: Id, expectedUpdatedAt?: UtcTimestamp): Promise<StoredUser | null>;
  updatePassword(
    id: Id,
    passwordHash: string,
    forcePasswordChange: boolean,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<StoredUser | null>;
}

type UserRow = Record<string, unknown> & {
  id: unknown;
  username: unknown;
  username_normalized: unknown;
  password_hash: unknown;
  role: unknown;
  status: unknown;
  display_name: unknown;
  force_password_change: unknown;
  password_changed_at: unknown;
  last_login_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const SELECT_COLUMNS = `
  SELECT id, username, username_normalized, password_hash, role, status,
         display_name, force_password_change, password_changed_at,
         last_login_at, created_at, updated_at
  FROM users`;

export class SqlUserRepository implements UserRepository {
  constructor(private readonly database: UserRepositoryDatabase) {}

  async create(input: CreateUserInput): Promise<StoredUser> {
    return this.createInTransaction(input, false);
  }

  async createFirstAdmin(input: CreateUserInput): Promise<StoredUser> {
    if (input.role !== "ADMIN") {
      throw new UserValidationError("First bootstrap account must be an admin");
    }
    return this.createInTransaction(input, true);
  }

  private async createInTransaction(
    input: CreateUserInput,
    firstAdmin: boolean,
  ): Promise<StoredUser> {
    const username = input.username.trim();
    const usernameNormalized = normalizeUsername(input.username);
    const displayName = validateDisplayName(input.displayName);
    validateUserRole(input.role);
    const passwordHash = validatePasswordHash(input.passwordHash);
    const forcePasswordChange = input.forcePasswordChange ?? false;

    try {
      return await this.database.transaction(async (connection) => {
        if (firstAdmin) {
          const lock = await connection.query<{ lock_name: unknown }>(
            "SELECT lock_name FROM system_locks WHERE lock_name = 'ADMIN_BOOTSTRAP' FOR UPDATE",
          );
          if (!lock[0]) {
            throw new UserConflictError("Admin bootstrap lock is unavailable");
          }
          const admins = await connection.query<{ id: unknown }>(
            "SELECT id FROM users WHERE role = 'ADMIN' FOR UPDATE",
          );
          if (admins.length) {
            throw new UserConflictError(
              "Admin bootstrap has already completed",
            );
          }
          return this.insertUser(
            connection,
            {
              username,
              displayName,
              role: input.role,
              passwordHash,
              forcePasswordChange,
            },
            usernameNormalized,
          );
        }
        const existing = await this.findByUsername(
          connection,
          usernameNormalized,
        );
        if (existing) throw new UserConflictError();
        return this.insertUser(
          connection,
          {
            username,
            displayName,
            role: input.role,
            passwordHash,
            forcePasswordChange,
          },
          usernameNormalized,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new UserConflictError();
      throw error;
    }
  }

  private async insertUser(
    connection: UserRepositoryConnection,
    input: {
      readonly username: string;
      readonly displayName: string;
      readonly role: "ADMIN" | "TEACHER" | "PARTICIPANT";
      readonly passwordHash: string;
      readonly forcePasswordChange: boolean;
    },
    usernameNormalized: string,
  ): Promise<StoredUser> {
    await connection.execute(
      `INSERT INTO users
        (username, username_normalized, password_hash, role, status,
         display_name, force_password_change)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [
        input.username,
        usernameNormalized,
        input.passwordHash,
        input.role,
        input.displayName,
        input.forcePasswordChange,
      ],
    );
    const created = await this.findByUsername(connection, usernameNormalized);
    if (!created) throw new Error("Created user could not be read back");
    return created;
  }

  findById(id: Id): Promise<StoredUser | null> {
    return this.database.transaction((connection) =>
      this.findByIdOn(connection, id),
    );
  }

  findByUsernameNormalized(
    usernameNormalized: string,
  ): Promise<StoredUser | null> {
    const normalized = normalizeUsername(usernameNormalized);
    return this.database.transaction((connection) =>
      this.findByUsername(connection, normalized),
    );
  }

  async update(
    id: Id,
    input: UpdateUserInput,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<StoredUser | null> {
    if (
      input.displayName === undefined &&
      input.role === undefined &&
      input.forcePasswordChange === undefined
    ) {
      throw new UserValidationError("At least one user field must be updated");
    }
    const displayName =
      input.displayName === undefined
        ? undefined
        : validateDisplayName(input.displayName);
    if (input.role !== undefined) validateUserRole(input.role);
    if (
      input.forcePasswordChange !== undefined &&
      typeof input.forcePasswordChange !== "boolean"
    ) {
      throw new UserValidationError("forcePasswordChange must be boolean");
    }

    return this.database.transaction(async (connection) => {
      const current = await this.findByIdOn(connection, id);
      if (!current) return null;
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw new UserVersionConflictError();
      }
      const assignments: string[] = [];
      const parameters: unknown[] = [];
      if (displayName !== undefined) {
        assignments.push("display_name = ?");
        parameters.push(displayName);
      }
      if (input.role !== undefined) {
        assignments.push("role = ?");
        parameters.push(input.role);
      }
      if (input.forcePasswordChange !== undefined) {
        assignments.push("force_password_change = ?");
        parameters.push(input.forcePasswordChange);
      }
      assignments.push("updated_at = UTC_TIMESTAMP(6)");
      await connection.execute(
        `UPDATE users SET ${assignments.join(", ")} WHERE id = ?`,
        [...parameters, id],
      );
      return this.findByIdOn(connection, id);
    });
  }

  async disable(
    id: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<StoredUser | null> {
    return this.database.transaction(async (connection) => {
      const current = await this.findByIdOn(connection, id);
      if (!current) return null;
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw new UserVersionConflictError();
      }
      if (current.status === "DISABLED") return current;
      await connection.execute(
        "UPDATE users SET status = 'DISABLED', updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [id],
      );
      return this.findByIdOn(connection, id);
    });
  }

  async updatePassword(
    id: Id,
    passwordHash: string,
    forcePasswordChange: boolean,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<StoredUser | null> {
    const validatedHash = validatePasswordHash(passwordHash);
    return this.database.transaction(async (connection) => {
      const current = await this.findByIdOn(connection, id);
      if (!current) return null;
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw new UserVersionConflictError();
      }
      await connection.execute(
        `UPDATE users
         SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6),
             force_password_change = ?, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [validatedHash, forcePasswordChange, id],
      );
      return this.findByIdOn(connection, id);
    });
  }

  private findByIdOn(
    connection: UserRepositoryConnection,
    id: Id,
  ): Promise<StoredUser | null> {
    return connection
      .query<UserRow>(`${SELECT_COLUMNS} WHERE id = ? LIMIT 1`, [id])
      .then((rows) => (rows[0] ? mapUserRow(rows[0]) : null));
  }

  private findByUsername(
    connection: UserRepositoryConnection,
    usernameNormalized: string,
  ): Promise<StoredUser | null> {
    return connection
      .query<UserRow>(
        `${SELECT_COLUMNS} WHERE username_normalized = ? LIMIT 1`,
        [usernameNormalized],
      )
      .then((rows) => (rows[0] ? mapUserRow(rows[0]) : null));
  }
}

function mapUserRow(row: UserRow): StoredUser {
  const id = parseDatabaseId(row.id);
  if (!id) throw new Error("Database returned an invalid user id");
  if (
    typeof row.username !== "string" ||
    typeof row.username_normalized !== "string"
  ) {
    throw new Error("Database returned an invalid username");
  }
  if (typeof row.password_hash !== "string")
    throw new Error("Database returned an invalid password hash");
  if (typeof row.role !== "string")
    throw new Error("Database returned an invalid user role");
  if (typeof row.status !== "string")
    throw new Error("Database returned an invalid user status");
  if (typeof row.display_name !== "string")
    throw new Error("Database returned an invalid display name");
  validateUserRole(row.role);
  validateUserStatus(row.status);
  const createdAt = toTimestamp(row.created_at);
  const updatedAt = toTimestamp(row.updated_at);
  return {
    id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    displayName: row.display_name,
    forcePasswordChange: Boolean(row.force_password_change),
    passwordChangedAt: toNullableTimestamp(row.password_changed_at),
    lastLoginAt: toNullableTimestamp(row.last_login_at),
    createdAt,
    updatedAt,
  };
}

function parseDatabaseId(value: unknown): Id | undefined {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return formatId(BigInt(value));
  }
  return parseId(value);
}

function toNullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined ? null : toTimestamp(value);
}

function toTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const normalized = value.endsWith("Z")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const timestamp = parseUtcTimestamp(normalized);
    if (timestamp) return timestamp;
  }
  throw new Error("Database returned an invalid timestamp");
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  return code === "ER_DUP_ENTRY" || code === "1062";
}
