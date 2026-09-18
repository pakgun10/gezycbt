import { describe, expect, test } from "bun:test";
import {
  AGENT_COMPATIBILITY_MANIFEST,
  agentPollingDelay,
  buildAgentHeaders,
  validateAgentPlatform,
} from "./compatibility";

describe("external agent compatibility contract", () => {
  test("keeps Hivekeep and Hermes on the same REST/Bearer boundary", () => {
    expect(AGENT_COMPATIBILITY_MANIFEST.protocol).toBe("https-rest-json");
    expect(AGENT_COMPATIBILITY_MANIFEST.apiPrefix).toBe(
      "/api/v1/integrations/agent",
    );
    expect(AGENT_COMPATIBILITY_MANIFEST.authentication).toMatchObject({
      scheme: "Bearer",
      cookieAuthentication: false,
      csrfRequired: false,
    });
    expect(AGENT_COMPATIBILITY_MANIFEST.agentPlatforms).toEqual([
      "HIVEKEEP",
      "HERMES",
    ]);
  });

  test("builds mutation/download headers without forwarding a cookie", () => {
    const headers = buildAgentHeaders({
      token: "secret-token",
      requestId: "request-1",
      clientVersion: "adapter-test/1.0",
      idempotencyKey: "0123456789abcdef",
      downloadToken: "download-once",
    });
    expect(headers.get("authorization")).toBe("Bearer secret-token");
    expect(headers.get("x-request-id")).toBe("request-1");
    expect(headers.get("idempotency-key")).toBe("0123456789abcdef");
    expect(headers.get("x-gezycbt-download-token")).toBe("download-once");
    expect(headers.get("cookie")).toBeNull();
  });

  test("bounds exponential polling delay and applies deterministic jitter", () => {
    expect(agentPollingDelay(0, () => 0.5)).toBe(1_000);
    expect(agentPollingDelay(2, () => 1)).toBe(7_000);
    expect(agentPollingDelay(20, () => 1)).toBe(15_000);
    expect(agentPollingDelay(-1, () => 0)).toBe(0);
  });

  test("rejects unknown adapter platform instead of silently downgrading", () => {
    expect(validateAgentPlatform("HIVEKEEP")).toBe("HIVEKEEP");
    expect(() => validateAgentPlatform("UNKNOWN")).toThrow(
      "Agent platform is not in the compatibility manifest",
    );
  });
});
