import { describe, expect, test } from "bun:test";
import { APP_VERSION, isSemVer } from "./app-version";

describe("application version", () => {
  test("uses a valid SemVer application version", () => {
    expect(isSemVer(APP_VERSION)).toBe(true);
  });

  test("accepts supported SemVer prerelease and build metadata", () => {
    expect(isSemVer("1.2.3-alpha.1+build.7")).toBe(true);
    expect(isSemVer("1.2")).toBe(false);
    expect(isSemVer("01.2.3")).toBe(false);
    expect(isSemVer("1.2.3-01")).toBe(false);
  });
});
