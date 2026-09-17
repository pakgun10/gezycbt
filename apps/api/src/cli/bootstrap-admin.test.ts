import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { StoredUser, UserRepository } from "../modules/users";
import {
  AdminBootstrapService,
  type BootstrapAuditEvent,
  parseBootstrapCliArguments,
  validateBootstrapPassword,
} from "./bootstrap-admin";

const storedUser: StoredUser = {
  id: "1" as Id,
  username: "admin",
  usernameNormalized: "admin",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  role: "ADMIN",
  status: "ACTIVE",
  displayName: "Administrator",
  forcePasswordChange: true,
  passwordChangedAt: null,
  lastLoginAt: null,
  createdAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
  updatedAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
};

function repository(): UserRepository & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async createFirstAdmin() {
      calls += 1;
      return storedUser;
    },
    async create() {
      return storedUser;
    },
    async findById() {
      return storedUser;
    },
    async findByUsernameNormalized() {
      return storedUser;
    },
    async update() {
      return storedUser;
    },
    async disable() {
      return storedUser;
    },
    async updatePassword() {
      return storedUser;
    },
  };
}

describe("admin bootstrap CLI", () => {
  test("requires explicit password stdin and parses safe arguments", () => {
    expect(
      parseBootstrapCliArguments([
        "--username",
        "admin",
        "--display-name",
        "Administrator",
        "--password-stdin",
      ]),
    ).toEqual({ username: "admin", displayName: "Administrator" });
    expect(() => parseBootstrapCliArguments(["--username", "admin"])).toThrow(
      "password-stdin",
    );
  });

  test("enforces staff password policy", () => {
    expect(() => validateBootstrapPassword("short", "admin")).toThrow("12-128");
    expect(() =>
      validateBootstrapPassword("adminadminadmin", "adminadminadmin"),
    ).toThrow("differ");
    expect(() =>
      validateBootstrapPassword("correct horse battery", "admin"),
    ).not.toThrow();
  });

  test("hashes the password, forces first change, and writes system audit", async () => {
    const repo = repository();
    const events: BootstrapAuditEvent[] = [];
    const service = new AdminBootstrapService(
      repo,
      {
        async record(event) {
          events.push(event);
        },
      },
      async (password) => {
        expect(password).toBe("correct horse battery");
        return "$argon2id$v=19$m=19456,t=2,p=1$hash";
      },
    );

    const result = await service.run({
      username: " Admin ",
      displayName: " Administrator ",
      password: "correct horse battery",
    });

    expect(repo.calls).toBe(1);
    expect(result.role).toBe("ADMIN");
    expect(result.forcePasswordChange).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("ADMIN_BOOTSTRAP_COMPLETED");
  });
});
