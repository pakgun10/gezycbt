import type { ApiErrorCode, ApiErrorDetails } from "@gezycbt/contracts";

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: ApiErrorDetails = {},
  ) {
    super(message);
  }
}
