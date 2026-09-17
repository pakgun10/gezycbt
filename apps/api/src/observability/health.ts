export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface HealthSnapshot {
  readonly status: "ok" | "not_ready";
  readonly checks?: Readonly<Record<string, "ok" | "failed">>;
}

export async function checkReadiness(
  checks: readonly ReadinessCheck[],
): Promise<HealthSnapshot> {
  const statuses: Record<string, "ok" | "failed"> = {};
  let ready = true;
  for (const check of checks) {
    try {
      await check.check();
      statuses[check.name] = "ok";
    } catch {
      statuses[check.name] = "failed";
      ready = false;
    }
  }
  return { status: ready ? "ok" : "not_ready", checks: statuses };
}
