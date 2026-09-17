import { describe, expect, test } from "bun:test";
import { loadAppConfig } from "./index";

const base = {
  APP_ENV: "test",
  APP_RELEASE: "test",
  APP_ORIGIN: "http://localhost",
  HOST: "127.0.0.1",
  PORT: "3000",
};

describe("loadAppConfig", () => {
  test("parses a valid test environment", () => {
    expect(loadAppConfig(base).port).toBe(3000);
  });

  test("fails fast for missing or unsafe configuration", () => {
    expect(() => loadAppConfig({ ...base, PORT: undefined })).toThrow(
      "PORT is required",
    );
    expect(() =>
      loadAppConfig({
        ...base,
        APP_ENV: "production",
        APP_ORIGIN: "http://example.test",
      }),
    ).toThrow("HTTPS");
  });

  test("accepts a MariaDB URL and requires it for production", () => {
    const config = loadAppConfig({
      ...base,
      GEZYCBT_DATABASE_URL: "mariadb://user:password@127.0.0.1:3306/gezycbt",
    });
    expect(config.databaseUrl).toContain("mariadb://");
    expect(() =>
      loadAppConfig({
        ...base,
        APP_ENV: "production",
        APP_ORIGIN: "https://example.test",
      }),
    ).toThrow("GEZYCBT_DATABASE_URL");
  });

  test("rejects unsupported database URLs", () => {
    expect(() =>
      loadAppConfig({ ...base, GEZYCBT_DATABASE_URL: "sqlite://local" }),
    ).toThrow("GEZYCBT_DATABASE_URL is invalid");
  });
});
