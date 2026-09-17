import { describe, expect, test } from "bun:test";
import { assertActorContext, assertMutationContext } from "./actor-context";
import { executeIdempotent, type IdempotencyPort } from "./idempotency";

describe("application context", () => {
  test("requires explicit actor identity for human and agent calls", () => {
    expect(() =>
      assertActorContext({ actorType: "HUMAN", requestId: "r" }),
    ).toThrow("requires a user");
    expect(() =>
      assertActorContext({ actorType: "EXTERNAL_AGENT", requestId: "r" }),
    ).toThrow("integration client");
    expect(() =>
      assertMutationContext({ actor: { actorType: "SYSTEM", requestId: "r" } }),
    ).toThrow("idempotency");
  });

  test("retries replay the stored result and do not run the operation again", async () => {
    let calls = 0;
    const completed: unknown[] = [];
    const port: IdempotencyPort = {
      async reserve() {
        return completed.length
          ? { status: "REPLAY", response: completed[0] }
          : { status: "NEW" };
      },
      async complete(_scope, _key, response) {
        completed.push(response);
      },
    };
    expect(
      await executeIdempotent(
        port,
        "test",
        "key-123456789012",
        "hash",
        async () => {
          calls += 1;
          return { ok: true };
        },
      ),
    ).toEqual({ ok: true });
    expect(
      await executeIdempotent(
        port,
        "test",
        "key-123456789012",
        "hash",
        async () => {
          calls += 1;
          return { ok: false };
        },
      ),
    ).toEqual({ ok: true });
    expect(calls).toBe(1);
  });
});
