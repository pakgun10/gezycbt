import type { ApiErrorBody } from "./error";

export const API_BASE_PATH = "/api/v1" as const;
export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export interface CursorPageRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface ApiSuccess<T> {
  readonly data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

export function normalizePageLimit(value?: number): number {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(value))
    throw new RangeError("limit must be an integer");
  return Math.min(Math.max(value, 1), MAX_PAGE_LIMIT);
}
