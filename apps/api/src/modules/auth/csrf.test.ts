import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import {
  assertCsrfRequest,
  assertSameOrigin,
  type CsrfProtectionError,
  isStateChangingMethod,
} from "./csrf";

const SESSION_ID = "7" as Id;
const EXPECTED_ORIGIN = "https://cbt.example.test";

describe("CSRF and Origin protection", () => {
  test("only state-changing methods require protection", async () => {
    expect(isStateChangingMethod("GET")).toBe(false);
    expect(isStateChangingMethod("HEAD")).toBe(false);
    expect(isStateChangingMethod("OPTIONS")).toBe(false);
    await expect(
      assertCsrfRequest({
        method: "GET",
        origin: null,
        expectedOrigin: EXPECTED_ORIGIN,
      }),
    ).resolves.toBeUndefined();
  });

  test("requires an exact same-origin Origin header", () => {
    expectReason(
      () => assertSameOrigin(null, EXPECTED_ORIGIN),
      "ORIGIN_MISSING",
    );
    expectReason(
      () => assertSameOrigin("https://evil.example.test", EXPECTED_ORIGIN),
      "ORIGIN_MISMATCH",
    );
    expectReason(
      () =>
        assertSameOrigin("https://cbt.example.test.evil.test", EXPECTED_ORIGIN),
      "ORIGIN_MISMATCH",
    );
    expectReason(
      () => assertSameOrigin("not-an-origin", EXPECTED_ORIGIN),
      "ORIGIN_INVALID",
    );
    expect(() =>
      assertSameOrigin("https://cbt.example.test", EXPECTED_ORIGIN),
    ).not.toThrow();
  });

  test("allows public mutation only after Origin validation", async () => {
    await expect(
      assertCsrfRequest({
        method: "POST",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
        requireSession: false,
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertCsrfRequest({
        method: "POST",
        origin: "https://evil.example.test",
        expectedOrigin: EXPECTED_ORIGIN,
        requireSession: false,
      }),
    ).rejects.toMatchObject({
      reason: "ORIGIN_MISMATCH",
      status: 403,
    });
  });

  test("requires the current session and synchronizer token", async () => {
    const session = { id: SESSION_ID } as never;
    const verify = async (sessionId: Id, token: string) =>
      sessionId === SESSION_ID && token === "a".repeat(43);

    await expect(
      assertCsrfRequest({
        method: "PATCH",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
      }),
    ).rejects.toMatchObject({
      reason: "SESSION_REQUIRED",
      status: 401,
    });
    await expect(
      assertCsrfRequest({
        method: "PATCH",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
        session,
        csrfToken: null,
        verifyCsrfSecret: verify,
      }),
    ).rejects.toMatchObject({ reason: "TOKEN_MISSING" });
    await expect(
      assertCsrfRequest({
        method: "DELETE",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
        session,
        csrfToken: "b".repeat(43),
        verifyCsrfSecret: verify,
      }),
    ).rejects.toMatchObject({ reason: "TOKEN_INVALID" });
    await expect(
      assertCsrfRequest({
        method: "POST",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
        session,
        csrfToken: ` ${"a".repeat(43)}`,
        verifyCsrfSecret: verify,
      }),
    ).rejects.toMatchObject({ reason: "TOKEN_INVALID" });
    await expect(
      assertCsrfRequest({
        method: "POST",
        origin: EXPECTED_ORIGIN,
        expectedOrigin: EXPECTED_ORIGIN,
        session,
        csrfToken: "a".repeat(43),
        verifyCsrfSecret: verify,
      }),
    ).resolves.toBeUndefined();
  });
});

function expectReason(
  operation: () => void,
  reason: CsrfProtectionError["reason"],
): void {
  try {
    operation();
    throw new Error(`Expected CSRF failure: ${reason}`);
  } catch (error) {
    expect(error).toMatchObject({ reason });
  }
}
