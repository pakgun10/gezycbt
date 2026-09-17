import { describe, expect, test } from "bun:test";
import { normalizeDatabaseError } from "./database-port";

describe("database port", () => {
  test("normalizes MariaDB vendor codes without exposing adapter details to callers", () => {
    expect(
      normalizeDatabaseError({
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: "duplicate",
      }).kind,
    ).toBe("UNIQUE");
    expect(
      normalizeDatabaseError({ errno: 1213, message: "deadlock" }).kind,
    ).toBe("DEADLOCK");
    expect(
      normalizeDatabaseError({ errno: 1205, message: "lock wait timeout" })
        .kind,
    ).toBe("LOCK_TIMEOUT");
    expect(
      normalizeDatabaseError({ message: "socket connection closed" }).kind,
    ).toBe("CONNECTION");
  });
});
