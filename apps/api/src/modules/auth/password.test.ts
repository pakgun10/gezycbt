import { describe, expect, test } from "bun:test";
import {
  PasswordBusyError,
  type PasswordEngine,
  PasswordHashError,
  PasswordService,
  validatePassword,
} from "./password";

function fakeEngine(
  delayMs = 0,
): PasswordEngine & { active: number; peak: number } {
  const state = { active: 0, peak: 0 };
  return {
    ...state,
    get active() {
      return state.active;
    },
    set active(value: number) {
      state.active = value;
    },
    get peak() {
      return state.peak;
    },
    set peak(value: number) {
      state.peak = value;
    },
    async hash() {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      if (delayMs) await Bun.sleep(delayMs);
      state.active -= 1;
      return "$argon2id$v=19$m=19456,t=2,p=1$hash";
    },
    async verify() {
      return true;
    },
  };
}

describe("password policy", () => {
  test("applies staff and participant length policy without composition rules", () => {
    expect(() => validatePassword("short", "ADMIN", "admin")).toThrow("12-128");
    expect(() =>
      validatePassword("short", "PARTICIPANT", "participant"),
    ).toThrow("8-128");
    expect(() =>
      validatePassword("correct horse battery", "ADMIN", "admin"),
    ).not.toThrow();
    expect(() =>
      validatePassword("participant password", "PARTICIPANT", "participant"),
    ).not.toThrow();
  });

  test("rejects only username-equivalent and control-character passwords", () => {
    expect(() =>
      validatePassword("abcdefghijkl", "ADMIN", "abcdefghijkl"),
    ).toThrow("differ");
    expect(() => validatePassword("valid-password\n", "PARTICIPANT")).toThrow(
      "control",
    );
    expect(() => validatePassword("пароль valid", "PARTICIPANT")).not.toThrow();
  });
});

describe("PasswordService", () => {
  test("hashes and verifies asynchronously through the engine", async () => {
    const engine = fakeEngine();
    const service = new PasswordService({
      engine,
      maxConcurrent: 1,
      maxQueue: 2,
    });
    const hash = await service.hash("participant-password", "PARTICIPANT");
    expect(hash).toStartWith("$argon2id$");
    await expect(service.verify("participant-password", hash)).resolves.toBe(
      true,
    );
    expect(engine.peak).toBe(1);
  });

  test("bounds concurrent work and rejects an overflowing queue", async () => {
    const engine = fakeEngine(10);
    const service = new PasswordService({
      engine,
      maxConcurrent: 1,
      maxQueue: 1,
    });
    const first = service.hash("first-password", "PARTICIPANT");
    const second = service.hash("second-password", "PARTICIPANT");
    expect(() => service.hash("third-password", "PARTICIPANT")).toThrow(
      PasswordBusyError,
    );
    await Promise.all([first, second]);
    expect(engine.peak).toBe(1);
  });

  test("rejects a malformed engine result or stored hash", async () => {
    const badEngine: PasswordEngine = {
      async hash() {
        return "plaintext";
      },
      async verify() {
        return false;
      },
    };
    const service = new PasswordService({ engine: badEngine });
    expect(
      service.hash("valid-participant-password", "PARTICIPANT"),
    ).rejects.toBeInstanceOf(PasswordHashError);
    await expect(
      service.verify("password", "plaintext"),
    ).rejects.toBeInstanceOf(PasswordHashError);
  });
});
