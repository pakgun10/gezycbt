import { describe, expect, test } from "bun:test";
import { checkReadiness } from "./health";

describe("readiness", () => {
  test("reports failed checks without leaking exception details", async () => {
    const result = await checkReadiness([
      {
        name: "database",
        check: async () => {
          throw new Error("secret");
        },
      },
    ]);
    expect(result).toEqual({
      status: "not_ready",
      checks: { database: "failed" },
    });
  });
});
