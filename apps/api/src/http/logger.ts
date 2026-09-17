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
}

export const consoleLogger: AppLogger = {
  error(record) {
    console.error(JSON.stringify(record));
  },
};
