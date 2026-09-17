export interface Metrics {
  requestsTotal: number;
  errorsTotal: number;
}

export function createMetrics(): Metrics {
  return { requestsTotal: 0, errorsTotal: 0 };
}

export function renderMetrics(metrics: Metrics, startedAt: number): string {
  const uptime = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return [
    "# TYPE gezycbt_requests_total counter",
    `gezycbt_requests_total ${metrics.requestsTotal}`,
    "# TYPE gezycbt_errors_total counter",
    `gezycbt_errors_total ${metrics.errorsTotal}`,
    "# TYPE gezycbt_process_uptime_seconds gauge",
    `gezycbt_process_uptime_seconds ${uptime}`,
    "",
  ].join("\n");
}
