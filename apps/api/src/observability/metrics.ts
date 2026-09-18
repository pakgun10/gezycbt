export interface Metrics {
  requestsTotal: number;
  errorsTotal: number;
  requestDurationMsTotal: number;
  requestDurationSamples: number;
  activeRequests: number;
  queryDurationMsTotal: number;
  queryDurationSamples: number;
  poolWaitTotal: number;
  readonly counters: Map<string, number>;
  readonly routeCounters: Map<string, number>;
  readonly queryCounters: Map<string, number>;
  readonly requestStarts: WeakMap<Request, number>;
}

const ALLOWED_EVENT_NAMES = new Set([
  "exam_save_success",
  "exam_save_conflict",
  "exam_save_rejected",
  "exam_submit",
  "exam_timeout",
  "exam_finalization_lag",
  "login_success",
  "login_failure",
  "rate_limited",
  "export_queued",
  "export_failed",
  "pool_wait",
  "backup_success",
  "backup_failure",
]);
const SAFE_ROUTE_SEGMENTS = new Set([
  "api",
  "v1",
  "health",
  "live",
  "ready",
  "metrics",
  "openapi.json",
  "auth",
  "staff",
  "participant",
  "teacher",
  "admin",
  "integrations",
  "agent",
  "question-banks",
  "questions",
  "question",
  "question-revisions",
  "exams",
  "exam-revisions",
  "schedules",
  "exam-sessions",
  "sessions",
  "results",
  "exports",
  "media",
  "users",
  "current",
  "login",
  "logout",
  "me",
  "capabilities",
  "actions",
  "approve",
  "download-token",
  "download",
  "answers",
  "submit",
  "start",
  "resume",
  "practice",
  "release-results",
  "unrelease-results",
]);

export function createMetrics(): Metrics {
  return {
    requestsTotal: 0,
    errorsTotal: 0,
    requestDurationMsTotal: 0,
    requestDurationSamples: 0,
    activeRequests: 0,
    queryDurationMsTotal: 0,
    queryDurationSamples: 0,
    poolWaitTotal: 0,
    counters: new Map(),
    routeCounters: new Map(),
    queryCounters: new Map(),
    requestStarts: new WeakMap(),
  };
}

export function renderMetrics(metrics: Metrics, startedAt: number): string {
  const uptime = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const lines = [
    "# TYPE gezycbt_requests_total counter",
    `gezycbt_requests_total ${metrics.requestsTotal}`,
    "# TYPE gezycbt_errors_total counter",
    `gezycbt_errors_total ${metrics.errorsTotal}`,
    "# TYPE gezycbt_http_request_duration_ms_sum counter",
    `gezycbt_http_request_duration_ms_sum ${formatMetric(metrics.requestDurationMsTotal)}`,
    "# TYPE gezycbt_http_request_duration_ms_count counter",
    `gezycbt_http_request_duration_ms_count ${metrics.requestDurationSamples}`,
    "# TYPE gezycbt_http_active_requests gauge",
    `gezycbt_http_active_requests ${metrics.activeRequests}`,
    "# TYPE gezycbt_db_query_duration_ms_sum counter",
    `gezycbt_db_query_duration_ms_sum ${formatMetric(metrics.queryDurationMsTotal)}`,
    "# TYPE gezycbt_db_query_duration_ms_count counter",
    `gezycbt_db_query_duration_ms_count ${metrics.queryDurationSamples}`,
    "# TYPE gezycbt_db_pool_wait_total counter",
    `gezycbt_db_pool_wait_total ${metrics.poolWaitTotal}`,
    "# TYPE gezycbt_process_uptime_seconds gauge",
    `gezycbt_process_uptime_seconds ${uptime}`,
  ];
  for (const [name, value] of metrics.counters) {
    lines.push(`# TYPE gezycbt_${name}_total counter`);
    lines.push(`gezycbt_${name}_total ${value}`);
  }
  for (const [route, value] of metrics.routeCounters) {
    lines.push(
      `gezycbt_http_requests_by_route_total{route="${escapeLabel(route)}"} ${value}`,
    );
  }
  if (metrics.routeCounters.size > 0) {
    lines.splice(
      lines.length - metrics.routeCounters.size,
      0,
      "# TYPE gezycbt_http_requests_by_route_total counter",
    );
  }
  if (metrics.queryCounters.size > 0) {
    lines.push("# TYPE gezycbt_db_queries_total counter");
  }
  for (const [query, value] of metrics.queryCounters) {
    lines.push(
      `gezycbt_db_queries_total{query="${escapeLabel(query)}"} ${value}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function recordQuery(
  metrics: Metrics,
  queryName: string,
  durationMs: number,
): void {
  const safeName = normalizeQueryLabel(queryName);
  metrics.queryDurationMsTotal += Math.max(0, durationMs);
  metrics.queryDurationSamples += 1;
  metrics.queryCounters.set(
    safeName,
    (metrics.queryCounters.get(safeName) ?? 0) + 1,
  );
}

export function recordPoolWait(metrics: Metrics): void {
  metrics.poolWaitTotal += 1;
}

export function beginRequest(metrics: Metrics, request: Request): void {
  metrics.requestStarts.set(request, Date.now());
  metrics.activeRequests += 1;
}

export function finishRequest(
  metrics: Metrics,
  request: Request,
  path: string,
): void {
  const started = metrics.requestStarts.get(request);
  if (started !== undefined) {
    metrics.requestDurationMsTotal += Math.max(0, Date.now() - started);
    metrics.requestDurationSamples += 1;
    metrics.requestStarts.delete(request);
    metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
  }
  const route = normalizeRouteLabel(path);
  metrics.routeCounters.set(route, (metrics.routeCounters.get(route) ?? 0) + 1);
}

export function incrementMetric(metrics: Metrics, name: string): void {
  if (!ALLOWED_EVENT_NAMES.has(name)) return;
  metrics.counters.set(name, (metrics.counters.get(name) ?? 0) + 1);
}

/** Keep labels bounded: IDs, hashes, and arbitrary query values never enter metrics. */
export function normalizeRouteLabel(path: string): string {
  const pathname = path.split("?", 1)[0] ?? "/";
  const normalized = pathname
    .split("/")
    .map((segment) =>
      segment === ""
        ? ""
        : !SAFE_ROUTE_SEGMENTS.has(segment) ||
            /^\d+$/u.test(segment) ||
            /^[0-9a-f]{16,}$/iu.test(segment)
          ? ":id"
          : segment,
    )
    .join("/");
  return normalized || "/";
}

export function normalizeQueryLabel(sql: string): string {
  const match =
    /^\s*(SELECT|INSERT|UPDATE|DELETE|CALL)\s+(?:.*?\s+FROM\s+|INTO\s+|)([a-z0-9_]+)/iu.exec(
      sql,
    );
  const verb = match?.[1];
  const resource = match?.[2];
  return verb && resource
    ? `${verb.toUpperCase()}_${resource.toLowerCase()}`
    : "OTHER";
}

function formatMetric(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.000$/u, "") : "0";
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
