import { describe, expect, test } from "bun:test";
import type { ScheduleIdentityField } from "./domain";
import {
  IDENTITY_FIELD_CATALOG,
  IdentityFieldConfigurationService,
  normalizeIdentityFieldConfig,
  normalizeIdentitySnapshot,
} from "./identity";

describe("practice identity field policy", () => {
  test("accepts the server catalog and canonicalizes configuration JSON", () => {
    const config = normalizeIdentityFieldConfig(
      JSON.stringify([
        { key: "name", label: " Nama ", type: "TEXT", required: true },
        {
          key: "class",
          label: "Kelas",
          type: "TEXT",
          required: false,
          maxLength: 20,
        },
      ]),
      "PRACTICE",
    );
    expect(config).toBe(
      JSON.stringify([
        { key: "name", label: "Nama", type: "TEXT", required: true },
        {
          key: "class",
          label: "Kelas",
          type: "TEXT",
          required: false,
          maxLength: 20,
        },
      ]),
    );
    expect(IDENTITY_FIELD_CATALOG.name.maxLength).toBe(200);
  });

  test("rejects arbitrary keys, optional name, and oversized catalog limits", () => {
    const invalid = (field: Record<string, unknown>) =>
      expect(() =>
        normalizeIdentityFieldConfig(
          JSON.stringify([
            { key: "name", label: "Nama", type: "TEXT", required: true },
            field,
          ]),
          "PRACTICE",
        ),
      ).toThrow();
    invalid({ key: "phone", label: "Telepon", type: "TEXT", required: false });
    invalid({ key: "name", label: "Nama", type: "TEXT", required: false });
    invalid({
      key: "class",
      label: "Kelas",
      type: "TEXT",
      required: false,
      maxLength: 151,
    });
  });

  test("requires name for practice and forbids fields for main", () => {
    expect(() =>
      normalizeIdentityFieldConfig(
        JSON.stringify([
          { key: "class", label: "Kelas", type: "TEXT", required: false },
        ]),
        "PRACTICE",
      ),
    ).toThrow("name");
    expect(() =>
      normalizeIdentityFieldConfig(
        JSON.stringify([
          { key: "name", label: "Nama", type: "TEXT", required: true },
        ]),
        "MAIN",
      ),
    ).toThrow();
  });

  test("normalizes an immutable snapshot and rejects missing or unknown values", () => {
    const fields: readonly ScheduleIdentityField[] = [
      { key: "name", label: "Nama", type: "TEXT", required: true },
      { key: "institution", label: "Instansi", type: "TEXT", required: false },
    ];
    const snapshot = normalizeIdentitySnapshot(fields, {
      name: "  Siti  ",
      institution: " SMA 1 ",
    });
    expect(snapshot.values).toEqual({ name: "Siti", institution: "SMA 1" });
    expect(snapshot.json).toBe(
      JSON.stringify({ name: "Siti", institution: "SMA 1" }),
    );
    expect(() =>
      normalizeIdentitySnapshot(fields, { institution: "SMA 1" }),
    ).toThrow("required");
    expect(() =>
      normalizeIdentitySnapshot(fields, { name: "Siti", phone: "123" }),
    ).toThrow();
  });

  test("service delegates configuration and snapshot policy consistently", () => {
    const service = new IdentityFieldConfigurationService();
    const config = service.normalizeConfig(
      JSON.stringify([
        { key: "name", label: "Nama", type: "TEXT", required: true },
      ]),
      "PRACTICE",
    );
    expect(config).toContain('"name"');
    expect(
      service.normalizeSnapshot(
        [{ key: "name", label: "Nama", type: "TEXT", required: true }],
        { name: "Adi" },
      ).values.name,
    ).toBe("Adi");
  });
});
