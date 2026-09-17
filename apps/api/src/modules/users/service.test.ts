import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type StoredUser,
  UserApplicationService,
  UserConflictError,
  UserNotFoundError,
  type UserRepository,
  UserValidationError,
} from "./index";

const id = "10" as Id;
const updatedAt = "2026-09-17T01:00:00.000Z" as UtcTimestamp;

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id,
    username: "Guru Satu",
    usernameNormalized: "guru.satu",
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
    role: "TEACHER",
    status: "ACTIVE",
    displayName: "Guru Satu",
    forcePasswordChange: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  };
}

function repository(): UserRepository & {
  readonly calls: string[];
  current: StoredUser | null;
} {
  const state: { calls: string[]; current: StoredUser | null } = {
    calls: [] as string[],
    current: storedUser(),
  };
  return {
    calls: state.calls,
    get current() {
      return state.current;
    },
    set current(value: StoredUser | null) {
      state.current = value;
    },
    async create(input) {
      state.calls.push(`create:${input.username}`);
      if (state.current?.usernameNormalized === input.username) {
        throw new UserConflictError();
      }
      const created = storedUser({
        username: input.username,
        usernameNormalized: input.username,
        displayName: input.displayName,
        role: input.role,
      });
      state.current = created;
      return created;
    },
    async createFirstAdmin(input) {
      return this.create(input);
    },
    async findById() {
      state.calls.push("find");
      return state.current;
    },
    async findByUsernameNormalized() {
      return state.current;
    },
    async update(_id, input) {
      state.calls.push("update");
      if (!state.current) return null;
      state.current = storedUser({
        ...state.current,
        ...(input.displayName === undefined
          ? {}
          : { displayName: input.displayName }),
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.forcePasswordChange === undefined
          ? {}
          : { forcePasswordChange: input.forcePasswordChange }),
      });
      return state.current;
    },
    async disable() {
      state.calls.push("disable");
      if (!state.current) return null;
      state.current = storedUser({ ...state.current, status: "DISABLED" });
      return state.current;
    },
  };
}

const mutationContext = {
  actor: { actorType: "HUMAN" as const, userId: id, requestId: "request-1" },
  idempotencyKey: "0123456789abcdef",
};

describe("UserApplicationService", () => {
  test("normalizes create input and never returns the password hash", async () => {
    const repo = repository();
    const service = new UserApplicationService(repo);
    const result = await service.createUser(mutationContext, {
      username: "  New.Teacher  ",
      displayName: "  New Teacher ",
      role: "TEACHER",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
    });

    expect(repo.calls).toEqual(["create:New.Teacher"]);
    expect(result.username).toBe("New.Teacher");
    expect(result.displayName).toBe("New Teacher");
    expect("passwordHash" in result).toBe(false);
  });

  test("requires a mutation context and validates Argon2 hashes", async () => {
    const service = new UserApplicationService(repository());
    expect(
      service.createUser(
        { actor: { actorType: "HUMAN", userId: id, requestId: "request-1" } },
        {
          username: "participant-1",
          displayName: "Participant",
          role: "PARTICIPANT",
          passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
        },
      ),
    ).rejects.toThrow("idempotency");
    expect(
      service.createUser(mutationContext, {
        username: "participant-1",
        displayName: "Participant",
        role: "PARTICIPANT",
        passwordHash: "plaintext",
      }),
    ).rejects.toBeInstanceOf(UserValidationError);
  });

  test("updates and disables without exposing a hard-delete operation", async () => {
    const repo = repository();
    const service = new UserApplicationService(repo);
    const updated = await service.updateUser(mutationContext, id, {
      displayName: "Updated Teacher",
      forcePasswordChange: true,
    });
    const disabled = await service.disableUser(mutationContext, id);

    expect(updated.displayName).toBe("Updated Teacher");
    expect(updated.forcePasswordChange).toBe(true);
    expect(disabled.status).toBe("DISABLED");
    expect(repo.calls).toEqual(["update", "disable"]);
  });

  test("returns a domain not-found error for an unknown user", async () => {
    const repo = repository();
    repo.current = null;
    const service = new UserApplicationService(repo);
    expect(
      service.updateUser(mutationContext, id, { displayName: "Missing" }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
