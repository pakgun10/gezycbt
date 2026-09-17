import { describe, expect, test } from "bun:test";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, normalizePageLimit } from "./http";

describe("pagination convention", () => {
  test("uses a bounded default", () => {
    expect(normalizePageLimit()).toBe(DEFAULT_PAGE_LIMIT);
    expect(normalizePageLimit(999)).toBe(MAX_PAGE_LIMIT);
    expect(() => normalizePageLimit(1.5)).toThrow();
  });
});
