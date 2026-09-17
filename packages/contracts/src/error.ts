import type { Id } from "./primitives";

/** Stable, safe API error codes. Domain modules may extend this union deliberately. */
export type CoreErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTH_SESSION_EXPIRED"
  | "AUTHORIZATION_DENIED"
  | "CSRF_INVALID"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_BUSY"
  | "INTERNAL_ERROR";

export type ApiErrorCode = CoreErrorCode | (string & {});

export interface ApiErrorDetails {
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;
  readonly retryAfterSeconds?: number;
  readonly resourceId?: Id;
  readonly [key: string]: unknown;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details: ApiErrorDetails;
  };
}
