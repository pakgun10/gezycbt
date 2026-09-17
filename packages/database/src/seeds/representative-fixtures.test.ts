import { describe, expect, test } from "bun:test";
import { generateRepresentativeFixture } from "./representative-fixtures";

describe("generateRepresentativeFixture", () => {
  test("generates the default representative dataset deterministically", () => {
    const first = generateRepresentativeFixture();
    const second = generateRepresentativeFixture();

    expect(first).toEqual(second);
    expect(first.participants).toHaveLength(1_500);
    expect(first.classes).toHaveLength(6);
    expect(first.subjects).toHaveLength(8);
    expect(first.teachers).toHaveLength(12);
    expect(new Set(first.participants.map((item) => item.username)).size).toBe(
      1_500,
    );
    expect(new Set(first.participants.map((item) => item.classCode)).size).toBe(
      6,
    );
  });

  test("uses the seed to produce isolated but reproducible namespaces", () => {
    const alpha = generateRepresentativeFixture({ seed: "alpha" });
    const beta = generateRepresentativeFixture({ seed: "beta" });
    expect(alpha.participants[0]?.username).not.toBe(
      beta.participants[0]?.username,
    );
    expect(generateRepresentativeFixture({ seed: "alpha" })).toEqual(alpha);
  });

  test("rejects unsafe or oversized fixture requests", () => {
    expect(() =>
      generateRepresentativeFixture({ seed: "production data" }),
    ).toThrow("Fixture seed");
    expect(() =>
      generateRepresentativeFixture({ participantCount: 1_501 }),
    ).toThrow("participantCount");
  });
});
