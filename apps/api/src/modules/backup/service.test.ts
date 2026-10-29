import { describe, expect, test } from "bun:test";
import type { DatabasePort } from "@gezycbt/database";
import { decryptBackup, encryptBackup } from "./crypto";
import { BackupError, BackupService } from "./service";
import { BACKUP_TABLES, CLEAR_TABLES } from "./tables";
import { decodeRow, encodeRow } from "./values";
import { createZip, parseZip } from "./zip";

const PASSPHRASE = "passphrase-backup-yang-cukup-panjang";

function tableFromSql(sql: string): string {
  const match = /FROM `([^`]+)`/u.exec(sql);
  return match?.[1] ?? "";
}

interface MockDbOptions {
  readonly activeSession?: boolean;
  readonly mediaBytes?: Uint8Array;
}

function mockDatabase(options: MockDbOptions = {}): {
  database: DatabasePort;
  executions: string[];
  mediaPut: { key: string; bytes: Uint8Array; mime: string }[];
} {
  const executions: string[] = [];
  const mediaPut: { key: string; bytes: Uint8Array; mime: string }[] = [];
  const database = {
    async query<T extends Record<string, unknown>>(
      sql: string,
    ): Promise<readonly T[]> {
      if (sql.includes("exam_sessions") && sql.includes("ACTIVE")) {
        return (options.activeSession ? [{ id: 1 }] : []) as unknown as T[];
      }
      const table = tableFromSql(sql);
      if (table === "media_assets") {
        return [
          {
            id: 10,
            storage_key: "media/abcdefghijklmnopqrst",
            original_name: "soal.png",
            mime_type: "image/png",
            byte_size: 4,
            status: "READY",
            created_by: 1,
          },
        ] as unknown as T[];
      }
      if (table === "users") {
        return [
          {
            id: 1,
            username: "admin",
            role: "ADMIN",
            password_hash: "$argon2id$hash",
          },
        ] as unknown as T[];
      }
      return [] as unknown as T[];
    },
    async execute(sql: string) {
      executions.push(sql);
      return { affectedRows: 1 };
    },
    async transaction<T>(operation: (connection: never) => Promise<T>) {
      return operation(database as never);
    },
    async close() {},
  } as unknown as DatabasePort;
  return { database, executions, mediaPut };
}

function mockService(options: MockDbOptions = {}) {
  const mock = mockDatabase(options);
  const service = new BackupService(mock.database, {
    mediaRead: async () => options.mediaBytes ?? new Uint8Array([1, 2, 3, 4]),
    mediaPut: async (key, bytes, mime) => {
      mock.mediaPut.push({ key, bytes, mime });
    },
    now: () => new Date("2026-10-29T10:00:00.000Z"),
  });
  return { ...mock, service };
}

describe("backup tables", () => {
  test("inventory covers all 44 tables without overlap", () => {
    const all = [...BACKUP_TABLES, ...CLEAR_TABLES];
    expect(all.length).toBe(44);
    expect(new Set(all).size).toBe(44);
    expect(BACKUP_TABLES).toContain("question_revisions");
    expect(BACKUP_TABLES).toContain("media_assets");
    expect(BACKUP_TABLES).toContain("answers");
    expect(CLEAR_TABLES).toContain("auth_sessions");
    expect(CLEAR_TABLES).toContain("export_files");
    expect(BACKUP_TABLES).not.toContain("auth_sessions");
  });
});

describe("backup values", () => {
  test("buffer, date, and bigint survive a round-trip", () => {
    const row = {
      id: 1n,
      blob: Buffer.from("abc"),
      at: new Date("2026-10-29T10:00:00.000Z"),
      name: "tes",
      json: { a: 1 },
    };
    const decoded = decodeRow(encodeRow(row));
    expect(decoded.id).toBe(1n);
    expect(Buffer.from(decoded.blob as Uint8Array).toString()).toBe("abc");
    expect((decoded.at as Date).toISOString()).toBe("2026-10-29T10:00:00.000Z");
    expect(decoded.name).toBe("tes");
  });
});

describe("backup zip and crypto", () => {
  test("stored zip round-trips and rejects a corrupted entry", () => {
    const zip = createZip([
      { name: "manifest.json", data: new TextEncoder().encode("{}") },
      { name: "media/abcdefghijklmnopqrst", data: new Uint8Array([9, 8]) },
    ]);
    const parsed = parseZip(zip);
    expect(parsed.map((entry) => entry.name)).toEqual([
      "manifest.json",
      "media/abcdefghijklmnopqrst",
    ]);
    // Flip a byte inside the first entry's data ("{}" starts at offset 43:
    // 30-byte header + 13-byte name), so its CRC-32 no longer matches.
    const tampered = new Uint8Array(zip);
    tampered.set([(tampered.at(44) ?? 0) ^ 0xff], 44);
    expect(() => parseZip(tampered)).toThrow();
  });

  test("wrong passphrase and tampering fail decryption", () => {
    const plain = new TextEncoder().encode("backup-bytes");
    const encrypted = encryptBackup(PASSPHRASE, plain);
    expect(new TextDecoder().decode(decryptBackup(PASSPHRASE, encrypted))).toBe(
      "backup-bytes",
    );
    expect(() =>
      decryptBackup("passphrase-yang-salah-123", encrypted),
    ).toThrow();
    const tampered = new Uint8Array(encrypted);
    tampered.set([(tampered.at(-1) ?? 0) ^ 0xff], tampered.byteLength - 1);
    expect(() => decryptBackup(PASSPHRASE, tampered)).toThrow();
  });
});

describe("backup service", () => {
  test("create and preview agree on counts, and short passphrase is rejected", async () => {
    const { service } = mockService();
    await expect(service.createBackup("pendek", "1")).rejects.toBeInstanceOf(
      BackupError,
    );
    const file = await service.createBackup(PASSPHRASE, "1");
    expect(file.filename).toBe("backup-gezycbt-20261029T100000.gezycbtbackup");
    const summary = await service.previewBackup(file.bytes, PASSPHRASE);
    expect(summary.schemaVersion).toBe(24);
    expect(summary.mediaCount).toBe(1);
    expect(summary.mediaBytes).toBe(4);
    expect(summary.tables.find((t) => t.name === "users")?.rows).toBe(1);
    expect(summary.totalRows).toBe(2);
    await expect(
      service.previewBackup(file.bytes, "passphrase-yang-salah-123"),
    ).rejects.toMatchObject({ code: "BACKUP_PASSPHRASE" });
  });

  test("restore replaces data, clears sessions, and writes media", async () => {
    const source = mockService();
    const file = await source.service.createBackup(PASSPHRASE, "1");
    const target = mockService();
    const summary = await target.service.restoreBackup(file.bytes, PASSPHRASE, {
      confirm: true,
      actorUsername: "admin",
    });
    expect(summary.mediaCount).toBe(1);
    expect(target.mediaPut).toHaveLength(1);
    expect(target.mediaPut[0]?.key).toBe("media/abcdefghijklmnopqrst");
    expect(target.mediaPut[0]?.mime).toBe("image/png");
    const joined = target.executions.join("\n");
    expect(joined).toContain("SET FOREIGN_KEY_CHECKS=0");
    expect(joined).toContain("DELETE FROM `auth_sessions`");
    expect(joined).toContain("DELETE FROM `export_files`");
    expect(joined).toContain("INSERT INTO `system_locks`");
    expect(joined).toContain("INSERT INTO `users`");
    expect(joined).toContain("INSERT INTO `media_assets`");
    expect(joined).toContain("SET FOREIGN_KEY_CHECKS=1");
    // The restore audit row: the action travels as a parameter, so the
    // recorded SQL only shows the audit_logs insert itself.
    expect(joined).toContain("INSERT INTO `audit_logs`");
  });

  test("restore requires confirmation and blocks active exam sessions", async () => {
    const source = mockService();
    const file = await source.service.createBackup(PASSPHRASE, "1");
    const target = mockService();
    await expect(
      target.service.restoreBackup(file.bytes, PASSPHRASE, {
        confirm: false,
        actorUsername: "admin",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_VALIDATION" });
    const busy = mockService({ activeSession: true });
    await expect(
      busy.service.restoreBackup(file.bytes, PASSPHRASE, {
        confirm: true,
        actorUsername: "admin",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_ACTIVE_SESSION" });
    expect(busy.executions.join("\n")).not.toContain("DELETE FROM `users`");
  });

  test("restore refuses a backup from a newer schema", async () => {
    const source = mockService();
    const file = await source.service.createBackup(PASSPHRASE, "1");
    const zip = decryptBackup(PASSPHRASE, file.bytes);
    const entries = parseZip(zip);
    const manifestEntry = entries.find((e) => e.name === "manifest.json");
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestEntry?.data ?? new Uint8Array()),
    );
    manifest.schemaVersion = 99;
    const rebuilt = createZip(
      entries.map((entry) =>
        entry.name === "manifest.json"
          ? {
              name: entry.name,
              data: new TextEncoder().encode(JSON.stringify(manifest)),
            }
          : entry,
      ),
    );
    const newer = encryptBackup(PASSPHRASE, rebuilt);
    const target = mockService();
    await expect(
      target.service.restoreBackup(newer, PASSPHRASE, {
        confirm: true,
        actorUsername: "admin",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_SCHEMA_TOO_NEW" });
  });
});
