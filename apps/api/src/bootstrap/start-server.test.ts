import { describe, expect, test } from "bun:test";
import { startServer } from "./start-server";

const config = {
  appEnv: "test" as const,
  appRelease: "test",
  appOrigin: new URL("http://localhost"),
  host: "127.0.0.1",
  port: 0,
  logLevel: "error" as const,
};

describe("startServer", () => {
  test("starts and stops gracefully", () => {
    const server = startServer(config);
    expect(() => server.stop()).not.toThrow();
    expect(() => server.stop()).not.toThrow();
  });
});
