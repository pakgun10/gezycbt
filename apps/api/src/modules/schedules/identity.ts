import type { ScheduleIdentityField, ScheduleMode } from "./domain";
import { ScheduleValidationError } from "./domain";

/**
 * Fields that can be requested by a practice schedule. The catalog is kept
 * server-side so a client cannot invent arbitrary identity keys.
 */
export const IDENTITY_FIELD_CATALOG = {
  name: { maxLength: 200 },
  institution: { maxLength: 200 },
  class: { maxLength: 150 },
  student_number: { maxLength: 100 },
  department: { maxLength: 100 },
} as const;

export type IdentityFieldKey = keyof typeof IDENTITY_FIELD_CATALOG;

export interface NormalizedIdentitySnapshot {
  readonly values: Readonly<Record<string, string>>;
  readonly json: string;
}

/** Application boundary for schedule field configuration and guest identity. */
export class IdentityFieldConfigurationService {
  normalizeConfig(
    value: string | null | undefined,
    mode: ScheduleMode,
  ): string | null {
    return normalizeIdentityFieldConfig(value, mode);
  }

  normalizeSnapshot(
    fields: readonly ScheduleIdentityField[],
    values: unknown,
  ): NormalizedIdentitySnapshot {
    return normalizeIdentitySnapshot(fields, values);
  }
}

export function normalizeIdentityFieldConfig(
  value: string | null | undefined,
  mode: ScheduleMode,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string")
    throw invalidConfig("identityFieldsJson must be JSON text");
  if (value.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidConfig("identityFieldsJson must contain valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length > 20)
    throw invalidConfig(
      "identityFieldsJson must be an array with at most 20 fields",
    );
  const fields = parsed.map((item, index) => normalizeField(item, index));
  const keys = new Set(fields.map((field) => field.key));
  if (keys.size !== fields.length)
    throw invalidConfig("identityFieldsJson cannot contain duplicate keys");
  if (mode === "MAIN" && fields.length > 0)
    throw new ScheduleValidationError(
      "MAIN schedule cannot define practice identity fields",
      "MAIN_IDENTITY_FIELDS_FORBIDDEN",
    );
  if (
    mode === "PRACTICE" &&
    !fields.some((field) => field.key === "name" && field.required)
  )
    throw invalidConfig(
      "PRACTICE schedule identity fields must require name",
      "IDENTITY_NAME_REQUIRED",
    );
  return JSON.stringify(fields);
}

export function normalizeIdentitySnapshot(
  fields: readonly ScheduleIdentityField[],
  values: unknown,
): NormalizedIdentitySnapshot {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new ScheduleValidationError(
      "Identity values must be an object",
      "INVALID_IDENTITY_SNAPSHOT",
    );
  const input = values as Record<string, unknown>;
  const configured = new Set(fields.map((field) => field.key));
  for (const key of Object.keys(input)) {
    if (!configured.has(key))
      throw new ScheduleValidationError(
        "Identity contains a field that is not configured",
        "IDENTITY_FIELD_NOT_ALLOWED",
      );
  }

  const normalized: Record<string, string> = {};
  for (const field of fields) {
    const raw = input[field.key];
    if (raw === undefined || raw === null) {
      if (field.required)
        throw new ScheduleValidationError(
          `${field.key} is required`,
          "IDENTITY_FIELD_REQUIRED",
        );
      continue;
    }
    if (typeof raw !== "string")
      throw new ScheduleValidationError(
        `${field.key} must be text`,
        "INVALID_IDENTITY_VALUE",
      );
    const value = raw.trim();
    const maxLength = field.maxLength ?? catalogMaxLength(field.key);
    if (field.required && value.length === 0)
      throw new ScheduleValidationError(
        `${field.key} is required`,
        "IDENTITY_FIELD_REQUIRED",
      );
    if (value.length > maxLength)
      throw new ScheduleValidationError(
        `${field.key} exceeds its maximum length`,
        "IDENTITY_VALUE_TOO_LONG",
      );
    if (
      field.allowedValues &&
      value !== "" &&
      !field.allowedValues.includes(value)
    )
      throw new ScheduleValidationError(
        `${field.key} is not an allowed value`,
        "IDENTITY_VALUE_NOT_ALLOWED",
      );
    if (value !== "") normalized[field.key] = value;
  }
  return { values: normalized, json: JSON.stringify(normalized) };
}

function normalizeField(value: unknown, index: number): ScheduleIdentityField {
  if (!value || typeof value !== "object")
    throw invalidConfig(`Identity field ${index + 1} is invalid`);
  const candidate = value as Record<string, unknown>;
  const key = candidate.key;
  const label = candidate.label;
  const type = candidate.type;
  const required = candidate.required;
  if (
    typeof key !== "string" ||
    !isCatalogKey(key) ||
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 100 ||
    type !== "TEXT" ||
    typeof required !== "boolean"
  )
    throw invalidConfig(`Identity field ${index + 1} is invalid`);
  if (key === "name" && !required)
    throw invalidConfig("name must be required", "IDENTITY_NAME_REQUIRED");
  const maxLength = candidate.maxLength;
  const catalogLimit = catalogMaxLength(key);
  if (
    maxLength !== undefined &&
    (typeof maxLength !== "number" ||
      !Number.isSafeInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > catalogLimit)
  )
    throw invalidConfig(`Identity field ${index + 1} has an invalid maxLength`);
  const allowedValues = candidate.allowedValues;
  if (
    allowedValues !== undefined &&
    (!Array.isArray(allowedValues) ||
      allowedValues.length > 100 ||
      allowedValues.some(
        (item) =>
          typeof item !== "string" || item.trim() !== item || item.length > 100,
      ))
  )
    throw invalidConfig(
      `Identity field ${index + 1} has invalid allowedValues`,
    );
  return {
    key,
    label: label.trim(),
    type: "TEXT",
    required,
    ...(typeof maxLength === "number" ? { maxLength } : {}),
    ...(Array.isArray(allowedValues) ? { allowedValues } : {}),
  };
}

function isCatalogKey(value: string): value is IdentityFieldKey {
  return Object.hasOwn(IDENTITY_FIELD_CATALOG, value);
}

function catalogMaxLength(key: string): number {
  if (!isCatalogKey(key)) return 200;
  return IDENTITY_FIELD_CATALOG[key].maxLength;
}

function invalidConfig(
  message: string,
  code = "INVALID_IDENTITY_FIELDS",
): ScheduleValidationError {
  return new ScheduleValidationError(message, code);
}
