/**
 * Canonical contract consumed by a Hivekeep/Hermes adapter.
 *
 * The external agent remains an independent process.  Keeping this manifest in
 * the API package gives adapters and contract tests one source of truth for
 * headers, endpoint paths, approval semantics, and polling backoff without
 * coupling GezyCBT to either agent framework.
 */
export const AGENT_COMPATIBILITY_MANIFEST = Object.freeze({
  protocol: "https-rest-json" as const,
  apiPrefix: "/api/v1/integrations/agent" as const,
  authentication: Object.freeze({
    scheme: "Bearer" as const,
    header: "Authorization" as const,
    cookieAuthentication: false as const,
    csrfRequired: false as const,
  }),
  headers: Object.freeze({
    requestId: "X-Request-Id" as const,
    clientVersion: "X-GezyCBT-Client-Version" as const,
    idempotency: "Idempotency-Key" as const,
    downloadToken: "X-GezyCBT-Download-Token" as const,
  }),
  endpointMethods: Object.freeze({
    discovery: Object.freeze(["GET /me", "GET /capabilities"]),
    mutations: Object.freeze([
      "POST /questions",
      "POST /question-revisions/:id/validate",
      "POST /question-revisions/:id/publish",
      "POST /exams",
      "POST /exam-revisions/:id/questions",
      "POST /schedules/:id/exports",
      "POST /actions/prepare",
      "POST /actions/:id/confirm",
      "POST /actions/:id/cancel",
    ]),
    polling: Object.freeze([
      "GET /actions",
      "GET /actions/:id",
      "GET /exports/:id",
    ]),
    downloads: Object.freeze([
      "POST /exports/:id/download-token",
      "GET /exports/:id/download",
    ]),
  }),
  approval: Object.freeze({
    r2: "agent-confirm" as const,
    r3: "web-approval-and-polling" as const,
    confirmCarriesOnly: Object.freeze(["actionId", "planHash"]),
    defaultActionExpiryMinutes: 30,
  }),
  download: Object.freeze({
    tokenTtlSeconds: 300,
    oneUse: true,
    boundToClient: true,
  }),
  polling: Object.freeze({
    initialDelayMs: 1_000,
    maximumDelayMs: 15_000,
    jitterMs: 3_000,
    pauseWhenOffline: true,
  }),
  agentPlatforms: Object.freeze(["HIVEKEEP", "HERMES"] as const),
});

export type AgentPlatform =
  (typeof AGENT_COMPATIBILITY_MANIFEST.agentPlatforms)[number];

export interface AgentRequestOptions {
  readonly token: string;
  readonly requestId: string;
  readonly clientVersion?: string;
  readonly idempotencyKey?: string;
  readonly downloadToken?: string;
}

/**
 * Builds the headers an external adapter should send.  It deliberately does
 * not accept or forward cookies: browser staff sessions are a separate trust
 * boundary from machine credentials.
 */
export function buildAgentHeaders(options: AgentRequestOptions): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${options.token}`,
    Accept: "application/json",
    "X-Request-Id": options.requestId,
  });
  if (options.clientVersion)
    headers.set("X-GezyCBT-Client-Version", options.clientVersion);
  if (options.idempotencyKey)
    headers.set("Idempotency-Key", options.idempotencyKey);
  if (options.downloadToken)
    headers.set("X-GezyCBT-Download-Token", options.downloadToken);
  return headers;
}

/**
 * Exponential polling delay with bounded jitter. The caller owns retry count
 * and should stop when the action/export reaches a terminal state or the host
 * loses connectivity.
 */
export function agentPollingDelay(
  attempt: number,
  random = Math.random,
): number {
  const normalizedAttempt = Number.isSafeInteger(attempt)
    ? Math.max(0, attempt)
    : 0;
  const exponential = Math.min(
    AGENT_COMPATIBILITY_MANIFEST.polling.maximumDelayMs,
    AGENT_COMPATIBILITY_MANIFEST.polling.initialDelayMs *
      2 ** normalizedAttempt,
  );
  const jitter = Math.floor(
    (random() * 2 - 1) * AGENT_COMPATIBILITY_MANIFEST.polling.jitterMs,
  );
  return Math.max(
    0,
    Math.min(
      AGENT_COMPATIBILITY_MANIFEST.polling.maximumDelayMs,
      exponential + jitter,
    ),
  );
}

export function validateAgentPlatform(value: string): AgentPlatform {
  if (
    !AGENT_COMPATIBILITY_MANIFEST.agentPlatforms.includes(
      value as AgentPlatform,
    )
  )
    throw new Error("Agent platform is not in the compatibility manifest");
  return value as AgentPlatform;
}
