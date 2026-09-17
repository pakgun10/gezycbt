import { describe, expect, test } from "bun:test";
import { createMemoryHistory } from "vue-router";
import { createGezyRouter } from "./router";

describe("route groups", () => {
  test("keeps each application area under its own top-level path", () => {
    const router = createGezyRouter(createMemoryHistory());
    expect(router.resolve("/admin/users").name).toBe("admin");
    expect(router.resolve("/teacher/questions").name).toBe("teacher");
    expect(router.resolve("/participant/schedules").name).toBe(
      "participant-dashboard",
    );
    expect(router.resolve("/participant/exam/10").name).toBe(
      "participant-exam",
    );
    expect(router.resolve("/practice/token").name).toBe("practice-token");
    expect(router.resolve("/practice/exam/10").name).toBe("practice-exam");
  });

  test("marks participant deep links as protected while practice stays public", () => {
    const router = createGezyRouter(createMemoryHistory());
    expect(
      router.resolve("/participant/exam/10").meta.requiresParticipant,
    ).toBe(true);
    expect(
      router.resolve("/practice/exam/10").meta.requiresParticipant,
    ).toBeUndefined();
  });
});
