/**
 * Lossless row-value encoding for the backup file.
 *
 * MariaDB rows can carry values JSON cannot represent directly: binary
 * columns (BINARY/VARBINARY/BLOB) arrive as buffers, DATETIME(6) as Date,
 * and BIGINT UNSIGNED as bigint. Each is wrapped in a small marker object
 * and unwrapped on restore, so a round-trip preserves the exact value.
 *
 * Columns ending in `_json` are JSON columns. The driver returns them as
 * parsed values; on restore they are stringified again, because the
 * parameterised INSERT must receive the JSON text, not a JS object.
 */
export type EncodedRow = Record<string, unknown>;

function isBufferLike(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
  );
}

export function encodeRow(row: Record<string, unknown>): EncodedRow {
  const out: EncodedRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = value ?? null;
    } else if (isBufferLike(value)) {
      out[key] = { $binary: Buffer.from(value).toString("base64") };
    } else if (value instanceof Date) {
      out[key] = { $date: value.toISOString() };
    } else if (typeof value === "bigint") {
      out[key] = { $bigint: value.toString() };
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function decodeRow(row: EncodedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const marker = value as Record<string, unknown>;
      if (typeof marker.$binary === "string") {
        out[key] = Buffer.from(marker.$binary, "base64");
        continue;
      }
      if (typeof marker.$date === "string") {
        out[key] = new Date(marker.$date);
        continue;
      }
      if (typeof marker.$bigint === "string") {
        out[key] = BigInt(marker.$bigint);
        continue;
      }
    }
    if (key.endsWith("_json") && value !== null && typeof value === "object") {
      out[key] = JSON.stringify(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}
