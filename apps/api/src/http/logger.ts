export interface LogRecord {
  readonly level: "error";
  readonly event: "request_failed";
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly errorCode: string;
}

export interface AppLogger {
  error(record: LogRecord): void;
  info?(record: SafeLogRecord): void;
  warn?(record: SafeLogRecord): void;
}

export interface SafeLogRecord {
  readonly level: "info" | "warn";
  readonly event: string;
  readonly requestId?: string;
  readonly method?: string;
  readonly path?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly [key: string]: string | number | boolean | undefined;
}

export const consoleLogger: AppLogger = {
  error(record) {
    console.error(JSON.stringify(record));
  },
};
