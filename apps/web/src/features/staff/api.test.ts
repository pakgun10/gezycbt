import { describe, expect, test } from "bun:test";
import { ApiClient } from "../../lib/api";
import { HttpStaffApi } from "./api";

describe("staff schedule access-code API", () => {
  test("uses the canonical rotate-token endpoint for practice schedules", async () => {
    const original = globalThis.fetch;
    const requests: Request[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      requests.push(request);
      const data =
        request.method === "GET"
          ? { updatedAt: "2026-09-21T00:00:00.000Z" }
          : { scheduleId: "30", code: "ABCDE", hint: "•••-DE" };
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await new HttpStaffApi(new ApiClient("https://cbt.example")).rotateCode(
        "30",
        "practice-token",
      );
      expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/api/v1/teacher/schedules/30",
        "/api/v1/teacher/schedules/30/rotate-token",
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
