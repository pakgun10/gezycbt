import { describe, expect, test } from "bun:test";
import { TypeCompiler } from "elysia/type-system";
import {
  SCHEDULE_API_ROUTE_PATHS,
  scheduleApiOpenApiSchemas,
  scheduleApiRoutes,
  scheduleApiSchemas,
} from "./api-contract";
import { scheduleApiOpenApi } from "./openapi";

const VERSION = "2026-09-17T00:00:00.000Z";

describe("schedule API contracts", () => {
  test("validates MAIN and PRACTICE schedule payloads with bounded targets", () => {
    const check = TypeCompiler.Compile(scheduleApiSchemas.scheduleCreateBody);
    expect(
      check.Check({
        examRevisionId: "30",
        mode: "MAIN",
        startsAt: VERSION,
        endsAt: "2026-09-17T03:00:00.000Z",
        durationSeconds: 3_600,
        maxAttempts: 1,
        hardEnd: true,
        allowLateStart: true,
        resultReleasePolicy: "MANUAL",
        targetClassIds: ["50"],
      }),
    ).toBe(true);
    expect(
      check.Check({
        examRevisionId: "30",
        mode: "PRACTICE",
        startsAt: VERSION,
        endsAt: "2026-09-17T03:00:00.000Z",
        durationSeconds: 3_600,
        maxAttempts: 5,
        allowLateStart: true,
        resultReleasePolicy: "IMMEDIATE_SCORE",
        identityFields: [
          { key: "name", label: "Nama", type: "TEXT", required: true },
        ],
      }),
    ).toBe(true);
    expect(
      check.Check({
        examRevisionId: "30",
        mode: "MAIN",
        startsAt: VERSION,
        endsAt: "2026-09-17T03:00:00.000Z",
        durationSeconds: 3_600,
        maxAttempts: 1,
        allowLateStart: true,
        resultReleasePolicy: "MANUAL",
        unexpected: true,
      }),
    ).toBe(false);
  });

  test("requires optimistic version and bounded idempotency on schedule mutations", () => {
    const update = TypeCompiler.Compile(scheduleApiSchemas.scheduleUpdateBody);
    const rotate = TypeCompiler.Compile(
      scheduleApiSchemas.rotateAccessCodeBody,
    );
    const headers = TypeCompiler.Compile(scheduleApiSchemas.mutationHeaders);
    expect(
      update.Check({
        endsAt: "2026-09-17T03:00:00.000Z",
        expectedUpdatedAt: VERSION,
      }),
    ).toBe(true);
    expect(update.Check({ endsAt: "2026-09-17T03:00:00.000Z" })).toBe(false);
    expect(
      rotate.Check({ expectedUpdatedAt: VERSION, proposedCode: "ab-cde" }),
    ).toBe(true);
    expect(
      rotate.Check({ expectedUpdatedAt: VERSION, proposedCode: "ABCDE" }),
    ).toBe(true);
    expect(
      headers.Check({
        "x-csrf-token": "csrf",
        "idempotency-key": "schedule-mutation-0001",
      }),
    ).toBe(true);
  });

  test("keeps route inventory unique and publishes safe access response schemas", () => {
    expect(SCHEDULE_API_ROUTE_PATHS.length).toBe(7);
    expect(new Set(SCHEDULE_API_ROUTE_PATHS).size).toBe(
      SCHEDULE_API_ROUTE_PATHS.length,
    );
    expect(
      scheduleApiRoutes.every((route) =>
        route.path.startsWith("/api/v1/teacher/"),
      ),
    ).toBe(true);
    expect(
      scheduleApiOpenApi.paths["/api/v1/teacher/schedules/{id}/close"],
    ).toBeDefined();
    expect(
      scheduleApiOpenApi.paths["/api/v1/teacher/schedules/{id}/rotate-token"],
    ).toBeDefined();
    expect(
      scheduleApiOpenApiSchemas.RotatedScheduleAccessCodeResponse,
    ).toBeDefined();
    expect(JSON.stringify(scheduleApiOpenApi)).not.toContain(
      "practice_token_hash",
    );
    expect(() => JSON.parse(JSON.stringify(scheduleApiOpenApi))).not.toThrow();
  });
});
