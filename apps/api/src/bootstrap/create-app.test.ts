import { describe, expect, test } from "bun:test";
import { AppError } from "../http/app-error";
import { createApp } from "./create-app";

const config = {
  appEnv: "test" as const,
  appRelease: "test",
  appOrigin: new URL("http://localhost"),
  host: "127.0.0.1",
  port: 0,
  logLevel: "error" as const,
};

describe("createApp", () => {
  test("creates an in-memory app without binding a network port", async () => {
    const response = await createApp(config, { error: () => undefined }).handle(
      new Request("http://localhost/not-found"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("returns a safe error envelope with a request ID", async () => {
    const records: unknown[] = [];
    const app = createApp(config, {
      error: (record) => records.push(record),
    }).get("/test-error", () => {
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Perubahan sudah tidak berlaku.",
      );
    });
    const response = await app.handle(
      new Request("http://localhost/test-error", {
        headers: { "x-request-id": "request_123" },
      }),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("x-request-id")).toBe("request_123");
    expect(await response.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "Perubahan sudah tidak berlaku.",
        requestId: "request_123",
        details: {},
      },
    });
    expect(records).toHaveLength(1);
  });

  test("exposes liveness, readiness, and bounded metrics endpoints", async () => {
    const app = createApp(
      config,
      { error: () => undefined },
      {
        readinessChecks: [{ name: "database", check: async () => undefined }],
      },
    );
    expect(
      (await app.handle(new Request("http://localhost/health/live"))).status,
    ).toBe(200);
    expect(
      (await app.handle(new Request("http://localhost/health/ready"))).status,
    ).toBe(200);
    const metrics = await app.handle(new Request("http://localhost/metrics"));
    expect(metrics.headers.get("content-type")).toContain("text/plain");
    expect(await metrics.text()).toContain("gezycbt_requests_total");
  });

  test("returns 503 when a readiness dependency fails", async () => {
    const app = createApp(
      config,
      { error: () => undefined },
      {
        readinessChecks: [
          {
            name: "database",
            check: async () => {
              throw new Error("private");
            },
          },
        ],
      },
    );
    const response = await app.handle(
      new Request("http://localhost/health/ready"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      checks: { database: "failed" },
    });
  });
});
