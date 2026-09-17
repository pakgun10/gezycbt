import { describe, expect, test } from "bun:test";
import {
  MONITOR_POLL_INTERVAL_MS,
  menuForRole,
  nextMonitorDelay,
} from "./policies";

describe("staff UI policies", () => {
  test("keeps role menu visibility explicit", () => {
    expect(menuForRole("ADMIN").map((item) => item.key)).toContain("users");
    expect(menuForRole("TEACHER").map((item) => item.key)).not.toContain(
      "users",
    );
    expect(menuForRole("TEACHER").map((item) => item.key)).toContain(
      "questions",
    );
  });
  test("keeps monitoring polling within the documented jitter", () => {
    expect(nextMonitorDelay(0)).toBe(MONITOR_POLL_INTERVAL_MS - 3_000);
    expect(nextMonitorDelay(1)).toBe(MONITOR_POLL_INTERVAL_MS + 3_000);
  });
});
