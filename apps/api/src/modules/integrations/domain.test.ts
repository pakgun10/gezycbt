import { describe, expect, test } from "bun:test";
import { validateCapability } from "./domain";

describe("validateCapability", () => {
  test("accepts capability namespaces containing underscores", () => {
    expect(validateCapability("question_banks.read")).toBe(
      "question_banks.read",
    );
    expect(validateCapability("teacher_scopes.write")).toBe(
      "teacher_scopes.write",
    );
  });

  test("accepts ordinary dotted capabilities", () => {
    expect(validateCapability("questions.create")).toBe("questions.create");
  });

  test("rejects malformed capability names", () => {
    expect(() => validateCapability("question banks.read")).toThrow();
    expect(() => validateCapability(".questions.read")).toThrow();
    expect(() => validateCapability("questions.")).toThrow();
  });
});
