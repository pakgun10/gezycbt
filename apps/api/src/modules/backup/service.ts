import type { DatabasePort } from "@gezycbt/database";
import type { MediaMimeType } from "../media/domain";
import { decryptBackup, encryptBackup } from "./crypto";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_MARKER,
  BACKUP_TABLES,
  CLEAR_TABLES,
  KNOWN_TABLES,
  SCHEMA_VERSION,
} from "./tables";
import { decodeRow, type EncodedRow, encodeRow } from "./values";
import { createZip, parseZip, sha256Hex, type ZipEntry } from "./zip";

export class BackupError extends Error {
  constructor(
    readonly code:
      | "BACKUP_VALIDATION"
      | "BACKUP_PASSPHRASE"
      | "BACKUP_SCHEMA_TOO_NEW"
      | "BACKUP_ACTIVE_SESSION"
      | "BACKUP_MEDIA_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export interface BackupTableCount {
  readonly name: string;
  readonly rows: number;
}

export interface BackupSummary {
  readonly app: string;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly tables: readonly BackupTableCount[];
  readonly totalRows: number;
  readonly mediaCount: number;
  readonly mediaBytes: number;
  readonly warnings: readonly string[];
}

export interface BackupFile {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

interface BackupManifest {
  readonly app: string;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly tables: readonly BackupTableCount[];
  readonly media: readonly {
    readonly storageKey: string;
    readonly byteSize: number;
    readonly sha256: string;
  }[];
}

interface ParsedBackup {
  readonly manifest: BackupManifest;
  readonly tables: Record<string, EncodedRow[]>;
  readonly media: readonly {
    readonly storageKey: string;
    readonly data: Uint8Array;
  }[];
  readonly summary: BackupSummary;
}

export interface BackupServiceOptions {
  readonly mediaRead?: (storageKey: string) => Promise<Uint8Array>;
  readonly mediaPut?: (
    storageKey: string,
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ) => Promise<void>;
  readonly now?: () => Date;
}

function backupFileName(date: Date): string {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "");
  return `backup-gezycbt-${stamp}.gezycbtbackup`;
}

function assertPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    throw new BackupError(
      "BACKUP_VALIDATION",
      "Passphrase backup minimal 12 karakter.",
    );
  }
  if (passphrase.length > 128) {
    throw new BackupError(
      "BACKUP_VALIDATION",
      "Passphrase backup maksimal 128 karakter.",
    );
  }
  return passphrase;
}

function assertFileBytes(bytes: unknown): Uint8Array {
  if (
    !(bytes instanceof Uint8Array) &&
    !(typeof Buffer !== "undefined" && Buffer.isBuffer(bytes))
  ) {
    throw new BackupError("BACKUP_VALIDATION", "Berkas backup tidak valid.");
  }
  return bytes as Uint8Array;
}

export class BackupService {
  constructor(
    private readonly database: DatabasePort,
    private readonly options: BackupServiceOptions = {},
  ) {}

  async createBackup(
    passphrase: string,
    actorUserId: string | null,
  ): Promise<BackupFile> {
    const validPassphrase = assertPassphrase(passphrase);
    const now = this.options.now?.() ?? new Date();
    const tables: Record<string, EncodedRow[]> = {};
    const tableCounts: BackupTableCount[] = [];
    for (const table of BACKUP_TABLES) {
      const rows = await this.database.query<Record<string, unknown>>(
        `SELECT * FROM \`${table}\``,
      );
      tables[table] = rows.map(encodeRow);
      tableCounts.push({ name: table, rows: rows.length });
    }
    const mediaRows = tables.media_assets ?? [];
    const mediaEntries: { storageKey: string; data: Uint8Array }[] = [];
    const mediaManifest: {
      storageKey: string;
      byteSize: number;
      sha256: string;
    }[] = [];
    for (const row of mediaRows) {
      if (row.status !== "READY") continue;
      const storageKey = String(row.storage_key);
      if (!this.options.mediaRead) {
        throw new BackupError(
          "BACKUP_MEDIA_MISSING",
          "Pembaca media tidak tersedia di server ini.",
        );
      }
      let data: Uint8Array;
      try {
        data = await this.options.mediaRead(storageKey);
      } catch {
        throw new BackupError(
          "BACKUP_MEDIA_MISSING",
          `Berkas media ${storageKey} tidak ditemukan padahal statusnya READY.`,
        );
      }
      mediaEntries.push({ storageKey, data });
      mediaManifest.push({
        storageKey,
        byteSize: data.byteLength,
        sha256: sha256Hex(data),
      });
    }
    const manifest: BackupManifest = {
      app: BACKUP_MARKER,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      tables: tableCounts,
      media: mediaManifest,
    };
    const encoder = new TextEncoder();
    const zip = createZip([
      { name: "manifest.json", data: encoder.encode(JSON.stringify(manifest)) },
      {
        name: "database.json",
        data: encoder.encode(JSON.stringify({ tables })),
      },
      ...mediaEntries.map((entry) => ({
        name: entry.storageKey,
        data: entry.data,
      })),
    ]);
    const encrypted = encryptBackup(validPassphrase, zip);
    await this.writeAuditLog(
      "backup.create",
      actorUserId,
      "HUMAN",
      JSON.stringify({
        outcome: "SUCCESS",
        tables: tableCounts.length,
        mediaCount: mediaEntries.length,
      }),
    );
    return { filename: backupFileName(now), bytes: encrypted };
  }

  async previewBackup(
    bytes: Uint8Array,
    passphrase: string,
  ): Promise<BackupSummary> {
    const parsed = this.parseBackup(
      assertFileBytes(bytes),
      assertPassphrase(passphrase),
    );
    return parsed.summary;
  }

  async restoreBackup(
    bytes: Uint8Array,
    passphrase: string,
    input: { confirm: boolean; actorUsername: string | null },
  ): Promise<BackupSummary> {
    if (input.confirm !== true) {
      throw new BackupError(
        "BACKUP_VALIDATION",
        "Restore memerlukan konfirmasi final.",
      );
    }
    const parsed = this.parseBackup(
      assertFileBytes(bytes),
      assertPassphrase(passphrase),
    );
    if (parsed.manifest.schemaVersion > SCHEMA_VERSION) {
      throw new BackupError(
        "BACKUP_SCHEMA_TOO_NEW",
        "Skema backup lebih baru dari server ini. Perbarui server dulu sebelum restore.",
      );
    }
    const active = await this.database.query<Record<string, unknown>>(
      "SELECT id FROM exam_sessions WHERE status = 'ACTIVE' LIMIT 1",
    );
    if (active.length > 0) {
      throw new BackupError(
        "BACKUP_ACTIVE_SESSION",
        "Restore ditolak: masih ada sesi ujian yang sedang berjalan (ACTIVE).",
      );
    }
    await this.database.transaction(async (connection) => {
      await connection.execute("SET FOREIGN_KEY_CHECKS=0");
      try {
        for (const table of [...BACKUP_TABLES, ...CLEAR_TABLES].reverse()) {
          await connection.execute(`DELETE FROM \`${table}\``);
        }
        await connection.execute(
          "INSERT INTO `system_locks` (`lock_name`) VALUES ('ADMIN_BOOTSTRAP')",
        );
        for (const table of BACKUP_TABLES) {
          const rows = parsed.tables[table] ?? [];
          if (rows.length === 0) continue;
          const columns: string[] = [];
          for (const row of rows) {
            for (const key of Object.keys(row)) {
              if (!columns.includes(key)) columns.push(key);
            }
          }
          const placeholders = columns.map(() => "?").join(", ");
          const columnList = columns.map((c) => `\`${c}\``).join(", ");
          for (const row of rows) {
            const decoded = decodeRow(row);
            const values = columns.map((column) =>
              decoded[column] === undefined ? null : decoded[column],
            );
            await connection.execute(
              `INSERT INTO \`${table}\` (${columnList}) VALUES (${placeholders})`,
              values,
            );
          }
        }
      } finally {
        await connection.execute("SET FOREIGN_KEY_CHECKS=1");
      }
    });
    // Media sync happens after the database transaction: the database rows
    // are the source of truth, and re-running the same restore is idempotent,
    // so a media failure here can be repaired by restoring again.
    if (parsed.media.length > 0 && !this.options.mediaPut) {
      throw new BackupError(
        "BACKUP_MEDIA_MISSING",
        "Penulis media tidak tersedia di server ini.",
      );
    }
    const mediaByKey = new Map(
      (parsed.tables.media_assets ?? []).map((row) => [
        String(row.storage_key),
        String(row.mime_type),
      ]),
    );
    for (const entry of parsed.media) {
      const mime = mediaByKey.get(entry.storageKey);
      if (!mime) {
        throw new BackupError(
          "BACKUP_VALIDATION",
          `Media ${entry.storageKey} tidak punya baris media_assets.`,
        );
      }
      await this.options.mediaPut?.(
        entry.storageKey,
        entry.data,
        mime as MediaMimeType,
      );
    }
    await this.writeAuditLog(
      "backup.restore",
      null,
      "RECOVERY",
      JSON.stringify({
        outcome: "SUCCESS",
        restoredBy: input.actorUsername,
        tables: parsed.summary.tables.length,
        mediaCount: parsed.summary.mediaCount,
      }),
    );
    return parsed.summary;
  }

  private parseBackup(bytes: Uint8Array, passphrase: string): ParsedBackup {
    let decrypted: Uint8Array;
    try {
      decrypted = decryptBackup(passphrase, bytes);
    } catch {
      throw new BackupError(
        "BACKUP_PASSPHRASE",
        "Passphrase salah atau berkas backup rusak.",
      );
    }
    let entries: ZipEntry[];
    try {
      entries = parseZip(decrypted);
    } catch {
      throw new BackupError(
        "BACKUP_VALIDATION",
        "Isi berkas backup tidak dapat dibaca.",
      );
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry.data]));
    const manifestRaw = byName.get("manifest.json");
    const databaseRaw = byName.get("database.json");
    if (!manifestRaw || !databaseRaw) {
      throw new BackupError(
        "BACKUP_VALIDATION",
        "Berkas backup tidak berisi manifest atau database.",
      );
    }
    let manifest: BackupManifest;
    let database: { tables: Record<string, EncodedRow[]> };
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
      database = JSON.parse(new TextDecoder().decode(databaseRaw));
    } catch {
      throw new BackupError(
        "BACKUP_VALIDATION",
        "Manifest atau database backup bukan JSON yang valid.",
      );
    }
    if (
      manifest.app !== BACKUP_MARKER ||
      manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
      !Array.isArray(manifest.tables) ||
      !Array.isArray(manifest.media)
    ) {
      throw new BackupError(
        "BACKUP_VALIDATION",
        "Berkas ini bukan backup GezyCBT yang dikenali.",
      );
    }
    for (const table of Object.keys(database.tables ?? {})) {
      if (!KNOWN_TABLES.has(table)) {
        throw new BackupError(
          "BACKUP_VALIDATION",
          `Tabel tidak dikenal di backup: ${table}.`,
        );
      }
    }
    for (const table of BACKUP_TABLES) {
      const manifestCount = manifest.tables.find((t) => t.name === table)?.rows;
      const actual = database.tables[table]?.length;
      if (
        manifestCount === undefined ||
        actual === undefined ||
        manifestCount !== actual
      ) {
        throw new BackupError(
          "BACKUP_VALIDATION",
          `Jumlah baris tabel ${table} tidak cocok dengan manifest.`,
        );
      }
    }
    const mediaAssets = database.tables.media_assets ?? [];
    const readyKeys = new Set(
      mediaAssets
        .filter((row) => row.status === "READY")
        .map((row) => String(row.storage_key)),
    );
    const media: { storageKey: string; data: Uint8Array }[] = [];
    let mediaBytes = 0;
    for (const item of manifest.media) {
      const data = byName.get(item.storageKey);
      if (!data) {
        throw new BackupError(
          "BACKUP_MEDIA_MISSING",
          `Berkas media ${item.storageKey} hilang dari backup.`,
        );
      }
      if (
        data.byteLength !== item.byteSize ||
        sha256Hex(data) !== item.sha256
      ) {
        throw new BackupError(
          "BACKUP_VALIDATION",
          `Checksum media ${item.storageKey} tidak cocok.`,
        );
      }
      if (!readyKeys.has(item.storageKey)) {
        throw new BackupError(
          "BACKUP_VALIDATION",
          `Media ${item.storageKey} tidak cocok dengan baris media_assets READY.`,
        );
      }
      media.push({ storageKey: item.storageKey, data });
      mediaBytes += data.byteLength;
    }
    for (const key of readyKeys) {
      if (!manifest.media.some((item) => item.storageKey === key)) {
        throw new BackupError(
          "BACKUP_MEDIA_MISSING",
          `Media READY ${key} tidak ada di backup.`,
        );
      }
    }
    const totalRows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
    const warnings: string[] = [];
    if (manifest.schemaVersion < SCHEMA_VERSION) {
      warnings.push(
        "Skema backup lebih lama dari server. Jalankan migrasi maju setelah restore.",
      );
    }
    warnings.push(
      "Kredensial integrasi tidak ikut backup dan harus diterbitkan ulang setelah pindah server.",
    );
    return {
      manifest,
      tables: database.tables,
      media,
      summary: {
        app: manifest.app,
        formatVersion: manifest.formatVersion,
        schemaVersion: manifest.schemaVersion,
        exportedAt: manifest.exportedAt,
        tables: manifest.tables,
        totalRows,
        mediaCount: manifest.media.length,
        mediaBytes,
        warnings,
      },
    };
  }

  private async writeAuditLog(
    action: string,
    actorUserId: string | null,
    actorType: "HUMAN" | "RECOVERY",
    metadataJson: string,
  ): Promise<void> {
    // Best-effort trace: a failed audit insert must not turn a successful
    // backup download or restore into a reported failure.
    try {
      await this.database.execute(
        "INSERT INTO `audit_logs` (`actor_user_id`, `actor_type`, `entity_type`, `action`, `request_id`, `metadata_json`) VALUES (?, ?, 'backup', ?, ?, ?)",
        [actorUserId, actorType, action, crypto.randomUUID(), metadataJson],
      );
    } catch {
      // Intentionally ignored: see comment above.
    }
  }
}
