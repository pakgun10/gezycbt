import type { Id, UtcTimestamp } from "@gezycbt/contracts";

export const USER_ROLES = ["ADMIN", "TEACHER", "PARTICIPANT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface StoredUser {
  readonly id: Id;
  readonly username: string;
  readonly usernameNormalized: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly displayName: string;
  readonly forcePasswordChange: boolean;
  readonly passwordChangedAt: UtcTimestamp | null;
  readonly lastLoginAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface UserView {
  readonly id: Id;
  readonly username: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly displayName: string;
  readonly forcePasswordChange: boolean;
  readonly passwordChangedAt: UtcTimestamp | null;
  readonly lastLoginAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface CreateUserInput {
  readonly username: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly passwordHash: string;
  readonly forcePasswordChange?: boolean;
}

export interface UpdateUserInput {
  readonly displayName?: string;
  readonly role?: UserRole;
  readonly forcePasswordChange?: boolean;
}

export class UserValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserValidationError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("User was not found");
    this.name = "UserNotFoundError";
  }
}

export class UserConflictError extends Error {
  constructor(message = "User conflicts with an existing account") {
    super(message);
    this.name = "UserConflictError";
  }
}

export class UserVersionConflictError extends Error {
  constructor() {
    super("User was changed by another request");
    this.name = "UserVersionConflictError";
  }
}

export function normalizeUsername(username: string): string {
  const normalized = username.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.length < 1 ||
    normalized.length > 100 ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint > 0x7f ||
        /\s/u.test(character)
      );
    })
  ) {
    throw new UserValidationError(
      "Username must be 1-100 ASCII characters without whitespace",
    );
  }
  return normalized;
}

export function validateUserRole(role: string): asserts role is UserRole {
  if (!USER_ROLES.includes(role as UserRole)) {
    throw new UserValidationError("User role is invalid");
  }
}

export function validateUserStatus(
  status: string,
): asserts status is UserStatus {
  if (!USER_STATUSES.includes(status as UserStatus)) {
    throw new UserValidationError("User status is invalid");
  }
}

export function validateDisplayName(displayName: string): string {
  const value = displayName.trim();
  if (value.length < 1 || value.length > 200) {
    throw new UserValidationError("Display name must be 1-200 characters");
  }
  return value;
}

export function validatePasswordHash(passwordHash: string): string {
  if (
    passwordHash.length < 20 ||
    passwordHash.length > 255 ||
    !passwordHash.startsWith("$argon2")
  ) {
    throw new UserValidationError("Password hash must be an Argon2 PHC string");
  }
  return passwordHash;
}

export function toUserView(user: StoredUser): UserView {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    displayName: user.displayName,
    forcePasswordChange: user.forcePasswordChange,
    passwordChangedAt: user.passwordChangedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
