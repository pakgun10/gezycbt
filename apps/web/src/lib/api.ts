export interface ApiErrorDetails {
  readonly [key: string]: unknown;
  readonly retryAfterSeconds?: number;
}

export interface ApiErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
    readonly details?: ApiErrorDetails;
  };
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetails = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  readonly body?: unknown;
}

/** Small same-origin client. Cookies stay HttpOnly and are never copied into JS. */
export class ApiClient {
  constructor(private readonly baseUrl = "") {}

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body !== undefined && !headers.has("content-type"))
      headers.set("content-type", "application/json");
    const { body, ...requestInit } = options;
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...requestInit,
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await readPayload(response);
    if (!response.ok) {
      const error = isApiErrorPayload(payload)
        ? payload.error
        : {
            code: "INTERNAL_ERROR",
            message: "Permintaan tidak dapat diproses.",
            details: {},
          };
      throw new ApiClientError(
        response.status,
        error.code,
        error.message,
        error.details ?? {},
        error.requestId,
      );
    }
    return payload as T;
  }
}

export function mutationHeaders(
  idempotencyKey: string,
  csrfToken?: string,
): Headers {
  const headers = new Headers({ "idempotency-key": idempotencyKey });
  if (csrfToken) headers.set("x-csrf-token", csrfToken);
  return headers;
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!value || typeof value !== "object") return false;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" && typeof candidate.message === "string"
  );
}
