import { describe, expect, test } from "bun:test";
import {
  formatId,
  formatUtcTimestamp,
  parseId,
  parseUtcTimestamp,
} from "./primitives";

describe("shared primitives", () => {
  test("preserves BIGINT identifiers as decimal strings", () => {
    expect(String(formatId(18_446_744_073_709_551_615n))).toBe(
      "18446744073709551615",
    );
    expect(parseId("001")).toBeUndefined();
    expect(String(parseId("42"))).toBe("42");
  });

  test("accepts and creates UTC timestamps only", () => {
    expect(parseUtcTimestamp("2026-09-16T10:30:00.000Z")).toBeDefined();
    expect(parseUtcTimestamp("2026-09-16T17:30:00+07:00")).toBeUndefined();
    expect(String(formatUtcTimestamp(new Date("2026-09-16T10:30:00Z")))).toBe(
      "2026-09-16T10:30:00.000Z",
    );
  });
});
