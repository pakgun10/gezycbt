import { describe, expect, test } from "bun:test";
import { readMigrationCliOptions } from "./migrate";

describe("migration CLI options", () => {
  test("reads the database URL, release, and safe default lock timeout", () => {
    expect(
      readMigrationCliOptions({
        GEZYCBT_DATABASE_URL: "mariadb://user:password@127.0.0.1:3306/gezycbt",
        APP_RELEASE: "local",
      }),
    ).toEqual({
      databaseUrl: "mariadb://user:password@127.0.0.1:3306/gezycbt",
      release: "local",
      lockTimeoutSeconds: 30,
    });
  });

  test("accepts an explicit bounded lock timeout", () => {
    expect(
      readMigrationCliOptions({
        DATABASE_URL: "mariadb://user:password@127.0.0.1:3306/gezycbt",
        MIGRATION_LOCK_TIMEOUT_SECONDS: "90",
      }).lockTimeoutSeconds,
    ).toBe(90);
  });

  test("fails for missing URL or unsafe timeout", () => {
    expect(() => readMigrationCliOptions({})).toThrow("GEZYCBT_DATABASE_URL");
    expect(() =>
      readMigrationCliOptions({
        GEZYCBT_DATABASE_URL: "mariadb://user:password@localhost/gezycbt",
        MIGRATION_LOCK_TIMEOUT_SECONDS: "301",
      }),
    ).toThrow("between 1 and 300");
  });
});
