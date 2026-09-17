import { describe, expect, test } from "bun:test";
import { normalizeToken } from "./api";

describe("participant token client policy", () => {
  test("normalizes display hyphens and lowercase without widening token policy", () => {
    expect(normalizeToken(" ab-cde ")).toBe("ABCDE");
    expect(normalizeToken("a-b-c-d-e")).toBe("ABCDE");
    expect(normalizeToken("abcd")).toBe("ABCD");
  });
});
