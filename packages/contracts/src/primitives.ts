/** A database BIGINT encoded as a decimal JSON string. */
export type Id = string & { readonly __brand: "GezyCbtId" };

/** An ISO-8601 UTC timestamp, for example 2026-09-16T10:30:00.000Z. */
export type UtcTimestamp = string & { readonly __brand: "UtcTimestamp" };

const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/;

export function parseId(value: unknown): Id | undefined {
  return typeof value === "string" && DECIMAL_ID.test(value)
    ? (value as Id)
    : undefined;
}

export function formatId(value: bigint): Id {
  if (value < 0n) throw new RangeError("ID must not be negative");
  return value.toString() as Id;
}

export function parseUtcTimestamp(value: unknown): UtcTimestamp | undefined {
  if (
    typeof value !== "string" ||
    !value.endsWith("Z") ||
    Number.isNaN(Date.parse(value))
  )
    return undefined;
  return value as UtcTimestamp;
}

export function formatUtcTimestamp(value: Date): UtcTimestamp {
  if (Number.isNaN(value.getTime())) throw new RangeError("Invalid date");
  return value.toISOString() as UtcTimestamp;
}
