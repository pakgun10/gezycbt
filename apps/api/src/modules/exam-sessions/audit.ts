import type { Id, UtcTimestamp } from "@gezycbt/contracts";

export type RuntimeAuditAction =
  | "SESSION_START"
  | "ANSWER_SAVE"
  | "SESSION_SUBMIT"
  | "SESSION_TIMEOUT"
  | "TIME_EXTENSION"
  | "SESSION_END"
  | "SCHEDULE_CLOSE"
  | "ATTEMPT_RESET";

export interface RuntimeAuditEvent {
  readonly action: RuntimeAuditAction;
  readonly actorUserId?: Id;
  readonly sessionId?: Id;
  readonly scheduleId?: Id;
  readonly requestId?: string;
  readonly reason?: string;
  readonly occurredAt: UtcTimestamp;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeAuditSink {
  record(event: RuntimeAuditEvent): Promise<void>;
}

export class InMemoryRuntimeAuditSink implements RuntimeAuditSink {
  readonly events: RuntimeAuditEvent[] = [];

  async record(event: RuntimeAuditEvent): Promise<void> {
    this.events.push({
      ...event,
      ...(event.reason ? { reason: event.reason.slice(0, 500) } : {}),
    });
  }
}
