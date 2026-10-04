import { describe, expect, test } from "bun:test";
import { ApiClient, type ApiClientError } from "./api";

describe("ApiClient", () => {
  test("sends same-origin credentials and JSON mutations", async () => {
    const original = globalThis.fetch;
    let request: Request | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    try {
      await expect(
        new ApiClient("https://cbt.example").request("/api/test", {
          method: "POST",
          headers: { "x-csrf-token": "csrf" },
          body: { answer: "A" },
        }),
      ).resolves.toEqual({ data: { ok: true } });
      expect(request?.credentials).toBe("include");
      expect(request?.headers.get("content-type")).toBe("application/json");
      expect(await request?.json()).toEqual({ answer: "A" });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("lets fetch set the multipart boundary for FormData uploads", async () => {
    const original = globalThis.fetch;
    let request: Request | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    try {
      const form = new FormData();
      form.set(
        "file",
        new Blob(["image"], { type: "image/png" }),
        "diagram.png",
      );
      await expect(
        new ApiClient("https://cbt.example").request("/api/upload", {
          method: "POST",
          body: form,
        }),
      ).resolves.toEqual({ data: { ok: true } });
      expect(request?.headers.get("content-type")).toMatch(
        /^multipart\/form-data; boundary=/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  test("turns the safe API error envelope into a typed error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ANSWER_VERSION_CONFLICT",
            message: "Jawaban berubah di perangkat lain.",
            requestId: "req-123",
            details: { retryAfterSeconds: 2 },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      await expect(new ApiClient().request("/api/test")).rejects.toMatchObject({
        status: 409,
        code: "ANSWER_VERSION_CONFLICT",
        requestId: "req-123",
        retryAfterSeconds: 2,
      } satisfies Partial<ApiClientError>);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("uses a generic error for malformed upstream responses", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not-json", { status: 503 })) as unknown as typeof fetch;
    try {
      await expect(new ApiClient().request("/api/test")).rejects.toMatchObject({
        status: 503,
        code: "INTERNAL_ERROR",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
