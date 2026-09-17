import { describe, expect, test } from "bun:test";
import { createMemoryHistory } from "vue-router";
import { createGezyRouter } from "./router";

describe("route groups", () => {
  test("keeps each application area under its own top-level path", () => {
    const router = createGezyRouter(createMemoryHistory());
    expect(router.resolve("/admin/users").name).toBe("admin");
    expect(router.resolve("/teacher/questions").name).toBe("teacher");
    expect(router.resolve("/participant/schedules").name).toBe("participant");
    expect(router.resolve("/practice/token").name).toBe("practice");
  });
});
