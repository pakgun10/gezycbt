import { describe, expect, test } from "bun:test";
import {
  beginRequest,
  createMetrics,
  finishRequest,
  incrementMetric,
  normalizeRouteLabel,
  renderMetrics,
} from "./metrics";

describe("bounded observability metrics", () => {
  test("records duration, active requests, route labels, and named events", () => {
    const metrics = createMetrics();
    const request = new Request("https://cbt.test/api/v1/sessions/123/answers");
    beginRequest(metrics, request);
    finishRequest(metrics, request, "/api/v1/sessions/123/answers");
    incrementMetric(metrics, "exam_save_success");
    incrementMetric(metrics, "participant_123");
    const output = renderMetrics(metrics, Date.now());
    expect(metrics.activeRequests).toBe(0);
    expect(output).toContain("gezycbt_http_request_duration_ms_count 1");
    expect(output).toContain('route="/api/v1/sessions/:id/answers"');
    expect(output).toContain("gezycbt_exam_save_success_total 1");
    expect(output).not.toContain("participant_123");
  });

  test("normalizes numeric and long hexadecimal segments", () => {
    expect(normalizeRouteLabel("/api/123/question/abcdefabcdefabcdef")).toBe(
      "/api/:id/question/:id",
    );
  });
});
