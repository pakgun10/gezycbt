import { formatId, type Id, parseId } from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import type {
  MediaAsset,
  MediaAssetCreateInput,
  MediaAssetRepository,
} from "./domain";
import {
  type AttachMediaInput,
  MEDIA_USAGES,
  MediaAssetReferencedError,
  MediaPublishedReferenceError,
  type MediaRelation,
  MediaRelationConflictError,
  MediaRelationImmutableError,
  MediaRelationNotFoundError,
  type MediaRelationRepository,
  type MediaRevisionTarget,
  type MediaUsage,
  validateMediaAttachment,
} from "./relation-domain";

type AssetRow = Record<string, unknown> & {
  id: unknown;
  storage_key: unknown;
  original_name: unknown;
  mime_type: unknown;
  byte_size: unknown;
  sha256: unknown;
  width: unknown;
  height: unknown;
  status: unknown;
  created_by: unknown;
};

type RevisionTargetRow = Record<string, unknown> & {
  id: unknown;
  status: unknown;
  owner_teacher_id: unknown;
  subject_id: unknown;
  question_bank_id: unknown;
  question_bank_name: unknown;
};

type RelationRow = Record<string, unknown> & {
  question_revision_id: unknown;
  media_asset_id: unknown;
  usage: unknown;
  alt_text: unknown;
  is_decorative: unknown;
};

type ReferenceRow = Record<string, unknown> & {
  question_revision_id: unknown;
  revision_status: unknown;
};

export class SqlMediaRelationRepository
  implements MediaAssetRepository, MediaRelationRepository
{
  constructor(private readonly database: DatabasePort) {}

  async create(input: MediaAssetCreateInput): Promise<MediaAsset> {
    return this.database.transaction(async (connection) => {
      const result = await connection.execute(
        `INSERT INTO media_assets
           (storage_key, original_name, mime_type, byte_size, sha256,
            width, height, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.storageKey,
          input.originalName,
          input.mimeType,
          input.byteSize,
          input.sha256,
          input.width,
          input.height,
          input.status,
          input.createdBy,
        ],
      );
      if (result.insertId === undefined)
        throw new Error("Media insert did not return an ID");
      const rows = await connection.query<AssetRow>(
        `SELECT id, storage_key, original_name, mime_type, byte_size,
                sha256, width, height, status, created_by
         FROM media_assets WHERE id = ? LIMIT 1`,
        [result.insertId],
      );
      if (!rows[0]) throw new Error("Created media asset could not be read");
      return mapAsset(rows[0]);
    });
  }

  async findRevisionTarget(id: Id): Promise<MediaRevisionTarget | null> {
    const rows = await this.database.query<RevisionTargetRow>(
      `SELECT qr.id, qr.status, qb.owner_teacher_id, qb.subject_id,
              qb.id AS question_bank_id, qb.name AS question_bank_name
       FROM question_revisions qr
       JOIN questions q ON q.id = qr.question_id
       JOIN question_banks qb ON qb.id = q.question_bank_id
       WHERE qr.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapRevisionTarget(rows[0]) : null;
  }

  async findAsset(id: Id): Promise<MediaAsset | null> {
    const rows = await this.database.query<AssetRow>(
      `SELECT id, storage_key, original_name, mime_type, byte_size,
              sha256, width, height, status, created_by
       FROM media_assets WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  async list(questionRevisionId: Id): Promise<readonly MediaRelation[]> {
    const rows = await this.database.query<RelationRow>(
      `SELECT question_revision_id, media_asset_id, \`usage\`, alt_text,
              is_decorative
       FROM question_revision_media
       WHERE question_revision_id = ?
       ORDER BY media_asset_id ASC`,
      [questionRevisionId],
    );
    return rows.map(mapRelation);
  }

  async attach(input: AttachMediaInput): Promise<MediaRelation> {
    return this.database.transaction(async (connection) => {
      // Asset is always locked before the revision so attach/detach/delete use
      // one lock order and do not introduce avoidable deadlocks.
      const asset = await readAsset(connection, input.mediaAssetId, true);
      if (!asset || asset.status !== "READY")
        throw new MediaRelationNotFoundError("Media asset is not available");
      const revision = await readRevisionTarget(
        connection,
        input.questionRevisionId,
        true,
      );
      if (!revision) throw new MediaRelationNotFoundError();
      if (revision.status !== "DRAFT") throw new MediaRelationImmutableError();
      const existing = await connection.query<RelationRow>(
        `SELECT question_revision_id, media_asset_id, \`usage\`, alt_text,
                is_decorative
         FROM question_revision_media
         WHERE question_revision_id = ? AND media_asset_id = ? LIMIT 1`,
        [input.questionRevisionId, input.mediaAssetId],
      );
      if (existing[0]) throw new MediaRelationConflictError();
      await connection.execute(
        `INSERT INTO question_revision_media
           (question_revision_id, media_asset_id, \`usage\`, alt_text, is_decorative)
         VALUES (?, ?, ?, ?, ?)`,
        [
          input.questionRevisionId,
          input.mediaAssetId,
          input.usage,
          input.altText,
          input.isDecorative,
        ],
      );
      return input;
    });
  }

  async detach(questionRevisionId: Id, mediaAssetId: Id): Promise<boolean> {
    return this.database.transaction(async (connection) => {
      const asset = await readAsset(connection, mediaAssetId, true);
      if (!asset) return false;
      const revision = await readRevisionTarget(
        connection,
        questionRevisionId,
        true,
      );
      if (!revision) throw new MediaRelationNotFoundError();
      if (revision.status !== "DRAFT") throw new MediaRelationImmutableError();
      const result = await connection.execute(
        `DELETE FROM question_revision_media
         WHERE question_revision_id = ? AND media_asset_id = ?`,
        [questionRevisionId, mediaAssetId],
      );
      return result.affectedRows === 1;
    });
  }

  async deleteAsset(id: Id): Promise<MediaAsset | null> {
    return this.database.transaction(async (connection) => {
      const asset = await readAsset(connection, id, true);
      if (!asset || asset.status !== "READY") return null;
      const references = await connection.query<ReferenceRow>(
        `SELECT qrm.question_revision_id, qr.status AS revision_status
         FROM question_revision_media qrm
         JOIN question_revisions qr ON qr.id = qrm.question_revision_id
         WHERE qrm.media_asset_id = ?
         FOR UPDATE`,
        [id],
      );
      if (references.some((row) => row.revision_status === "PUBLISHED"))
        throw new MediaPublishedReferenceError();
      if (references.length > 0) throw new MediaAssetReferencedError();
      const result = await connection.execute(
        `UPDATE media_assets SET status = 'DELETED', updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'READY'`,
        [id],
      );
      if (result.affectedRows !== 1) return null;
      return { ...asset, status: "DELETED" };
    });
  }
}

async function readAsset(
  connection: DatabaseConnection,
  id: Id,
  lock: boolean,
): Promise<MediaAsset | null> {
  const rows = await connection.query<AssetRow>(
    `SELECT id, storage_key, original_name, mime_type, byte_size,
            sha256, width, height, status, created_by
     FROM media_assets WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapAsset(rows[0]) : null;
}

async function readRevisionTarget(
  connection: DatabaseConnection,
  id: Id,
  lock: boolean,
): Promise<MediaRevisionTarget | null> {
  const rows = await connection.query<RevisionTargetRow>(
    `SELECT qr.id, qr.status, qb.owner_teacher_id, qb.subject_id,
            qb.id AS question_bank_id, qb.name AS question_bank_name
     FROM question_revisions qr
     JOIN questions q ON q.id = qr.question_id
     JOIN question_banks qb ON qb.id = q.question_bank_id
     WHERE qr.id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapRevisionTarget(rows[0]) : null;
}

function mapRevisionTarget(row: RevisionTargetRow): MediaRevisionTarget {
  const id = parseDatabaseId(row.id);
  const ownerTeacherId = parseDatabaseId(row.owner_teacher_id);
  const subjectId = parseDatabaseId(row.subject_id);
  const questionBankId = parseDatabaseId(row.question_bank_id);
  if (!id || !ownerTeacherId || !subjectId || !questionBankId)
    throw new Error("Database returned invalid media revision target ID");
  if (row.status !== "DRAFT" && row.status !== "PUBLISHED")
    throw new Error("Database returned invalid question revision status");
  if (typeof row.question_bank_name !== "string")
    throw new Error("Database returned invalid question bank name");
  return {
    id,
    status: row.status,
    ownerTeacherId,
    subjectId,
    questionBankId,
    questionBankName: row.question_bank_name,
  };
}

function mapAsset(row: AssetRow): MediaAsset {
  const id = parseDatabaseId(row.id);
  const createdBy = parseDatabaseId(row.created_by);
  if (!id || !createdBy) throw new Error("Database returned invalid media ID");
  if (
    typeof row.storage_key !== "string" ||
    typeof row.original_name !== "string"
  )
    throw new Error("Database returned invalid media filename metadata");
  if (
    row.mime_type !== "image/jpeg" &&
    row.mime_type !== "image/png" &&
    row.mime_type !== "image/webp"
  )
    throw new Error("Database returned invalid media MIME");
  if (row.status !== "READY" && row.status !== "DELETED")
    throw new Error("Database returned invalid media status");
  const byteSize = toPositiveNumber(row.byte_size);
  const width = toPositiveNumber(row.width);
  const height = toPositiveNumber(row.height);
  if (byteSize === null || width === null || height === null)
    throw new Error("Database returned invalid media dimensions");
  return {
    id,
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize,
    sha256: toBytes(row.sha256),
    width,
    height,
    status: row.status,
    createdBy,
  };
}

function mapRelation(row: RelationRow): MediaRelation {
  const questionRevisionId = parseDatabaseId(row.question_revision_id);
  const mediaAssetId = parseDatabaseId(row.media_asset_id);
  if (!questionRevisionId || !mediaAssetId)
    throw new Error("Database returned invalid media relation ID");
  if (
    typeof row.usage !== "string" ||
    !MEDIA_USAGES.includes(row.usage as MediaUsage)
  )
    throw new Error("Database returned invalid media usage");
  const isDecorative = toBoolean(row.is_decorative);
  if (
    isDecorative === null ||
    (row.alt_text !== null && typeof row.alt_text !== "string")
  )
    throw new Error("Database returned invalid media alt metadata");
  return validateMediaAttachment({
    questionRevisionId,
    mediaAssetId,
    usage: row.usage as MediaUsage,
    altText: row.alt_text as string | null,
    isDecorative,
  });
}

function parseDatabaseId(value: unknown): Id | null {
  if (typeof value === "bigint") return formatId(value);
  return parseId(value) ?? null;
}

function toPositiveNumber(value: unknown): number | null {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function toBytes(value: unknown): Uint8Array {
  const bytes =
    value instanceof Uint8Array
      ? new Uint8Array(value)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : null;
  if (bytes && bytes.length === 32) return bytes;
  throw new Error("Database returned invalid media hash");
}

function toBoolean(value: unknown): boolean | null {
  if (value === true || value === 1 || value === 1n) return true;
  if (value === false || value === 0 || value === 0n) return false;
  return null;
}
