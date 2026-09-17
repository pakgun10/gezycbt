import { describe, expect, test } from "bun:test";
import { createApp } from "./create-app";
import { createRuntimeDependencies } from "./runtime-dependencies";

const config = {
  appEnv: "test" as const,
  appRelease: "test",
  appOrigin: new URL("http://localhost"),
  databaseUrl: "mariadb://user:password@127.0.0.1:3306/gezycbt",
  host: "127.0.0.1",
  port: 0,
  logLevel: "error" as const,
};

describe("runtime dependencies", () => {
  test("mounts SQL-backed auth routes without requiring a request database call", async () => {
    const dependencies = createRuntimeDependencies(config);
    try {
      const response = await createApp(
        config,
        { error: () => undefined },
        dependencies,
      ).handle(new Request("http://localhost/api/v1/auth/me"));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTH_SESSION_EXPIRED" },
      });
    } finally {
      await dependencies.shutdown();
    }
  });

  test("does not require a database for in-memory test apps", async () => {
    const { databaseUrl: _databaseUrl, ...configWithoutDatabase } = config;
    const dependencies = createRuntimeDependencies(configWithoutDatabase);
    expect(dependencies.database).toBeUndefined();
    await dependencies.shutdown();
  });
});
