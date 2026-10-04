import {
  formatId,
  type Id,
  parseId,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import {
  canonicalQuestionValue,
  type CanonicalMediaHashEntry,
} from "../questions/content-hash";
import type { QuestionDraftContent } from "../questions/domain";
import { sanitizeRichContent } from "../questions/rich-content";
import type {
  MediaAsset,
  MediaAssetCreateInput,
  MediaAssetRepository,
} from "./domain";
import {
  type AttachMediaInput,
  MEDIA_ALIGNMENTS,
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

type Row = Record<string, unknown>;

type AssetRow = Row & {
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

type RevisionTargetRow = Row & {
  id: unknown;
  status: unknown;
  owner_teacher_id: unknown;
  subject_id: unknown;
  question_bank_id: unknown;
  question_bank_name: unknown;
  updated_at?: unknown;
};

type RelationRow = Row & {
  placement_key?: unknown;
  question_revision_id: unknown;
  media_asset_id: unknown;
  usage: unknown;
  question_option_id?: unknown;
  true_false_statement_id?: unknown;
  sort_order?: unknown;
  alt_text: unknown;
  is_decorative: unknown;
  display_width_percent?: unknown;
  alignment?: unknown;
  media_asset_status?: unknown;
  updated_at?: unknown;
};

type ReferenceRow = Row & {
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
      `SELECT qr.id, qr.status, qr.updated_at, qb.owner_teacher_id,
              qb.subject_id, qb.id AS question_bank_id,
              qb.name AS question_bank_name
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
    const placementRows = await this.database.query<RelationRow>(
      `SELECT placement_key, question_revision_id, media_asset_id, \`usage\`,
              question_option_id, true_false_statement_id, sort_order,
              alt_text, is_decorative, display_width_percent, alignment,
              updated_at, ma.status AS media_asset_status
       FROM question_media_placements p
       JOIN media_assets ma ON ma.id = p.media_asset_id
       WHERE p.question_revision_id = ?
       ORDER BY p.\`usage\`, p.sort_order, p.id`,
      [questionRevisionId],
    );
    if (placementRows.length > 0) return placementRows.map(mapRelation);
    // Compatibility fallback is useful during a rolling deployment and for
    // repositories created before migration 0022 was applied.
    const legacyRows = await this.database.query<RelationRow>(
      `SELECT qrm.question_revision_id, qrm.media_asset_id, qrm.\`usage\`,
              qrm.alt_text, qrm.is_decorative, ma.status AS media_asset_status
       FROM question_revision_media qrm
       JOIN media_assets ma ON ma.id = qrm.media_asset_id
       WHERE qrm.question_revision_id = ?
       ORDER BY qrm.media_asset_id ASC`,
      [questionRevisionId],
    );
    return legacyRows.map(mapLegacyRelation);
  }

  async attach(input: AttachMediaInput): Promise<MediaRelation> {
    const normalized = validateMediaAttachment(input);
    return this.database.transaction(async (connection) => {
      // Asset and revision are always locked in this order. This serializes
      // attach/detach/delete and makes the max-three rule race-safe.
      const asset = await readAsset(connection, normalized.mediaAssetId, true);
      if (!asset || asset.status !== "READY")
        throw new MediaRelationNotFoundError("Media asset is not available");
      const revision = await readRevisionTarget(
        connection,
        normalized.questionRevisionId,
        true,
      );
      if (!revision) throw new MediaRelationNotFoundError();
      if (revision.status !== "DRAFT") throw new MediaRelationImmutableError();
      if (
        normalized.expectedUpdatedAt &&
        revision.updatedAt !== normalized.expectedUpdatedAt
      )
        throw new MediaRelationConflictError();
      await assertChildTarget(connection, normalized);
      const countRows = await connection.query<{ total: unknown }>(
        "SELECT COUNT(*) AS total FROM question_media_placements WHERE question_revision_id = ?",
        [normalized.questionRevisionId],
      );
      if (Number(countRows[0]?.total ?? 0) >= 3)
        throw new MediaRelationConflictError();
      const existing = await connection.query<RelationRow>(
        `SELECT placement_key FROM question_media_placements
         WHERE question_revision_id = ? AND placement_key = ? LIMIT 1`,
        [normalized.questionRevisionId, normalized.placementKey],
      );
      if (existing[0]) throw new MediaRelationConflictError();
      await connection.execute(
        `INSERT INTO question_media_placements
           (placement_key, question_revision_id, media_asset_id, \`usage\`,
            question_option_id, true_false_statement_id, sort_order, alt_text,
            is_decorative, display_width_percent, alignment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.placementKey,
          normalized.questionRevisionId,
          normalized.mediaAssetId,
          normalized.usage,
          normalized.questionOptionId,
          normalized.trueFalseStatementId,
          normalized.sortOrder,
          normalized.altText,
          normalized.isDecorative,
          normalized.displayWidthPercent,
          normalized.alignment,
        ],
      );
      // Keep the old relation table as a compatibility mirror for one asset
      // per revision. New code reads placements first, so repeated use of one
      // asset remains possible in the new table.
      await connection.execute(
        `INSERT INTO question_revision_media
           (question_revision_id, media_asset_id, \`usage\`, alt_text, is_decorative)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE alt_text = VALUES(alt_text),
          is_decorative = VALUES(is_decorative), \`usage\` = VALUES(\`usage\`)`,
        [
          normalized.questionRevisionId,
          normalized.mediaAssetId,
          normalized.usage,
          normalized.altText,
          normalized.isDecorative,
        ],
      );
      return normalized;
    });
  }

  async detach(
    questionRevisionId: Id,
    mediaAssetId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<boolean> {
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
      if (
        expectedUpdatedAt &&
        revision.updatedAt !== expectedUpdatedAt
      )
        throw new MediaRelationConflictError();
      const result = await connection.execute(
        `DELETE FROM question_media_placements
         WHERE question_revision_id = ? AND media_asset_id = ?`,
        [questionRevisionId, mediaAssetId],
      );
      await removeLegacyMirrorIfUnused(connection, questionRevisionId, mediaAssetId);
      return result.affectedRows === 1;
    });
  }

  async detachByPlacement(
    questionRevisionId: Id,
    placementKey: string,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<boolean> {
    return this.database.transaction(async (connection) => {
      const revision = await readRevisionTarget(
        connection,
        questionRevisionId,
        true,
      );
      if (!revision) throw new MediaRelationNotFoundError();
      if (revision.status !== "DRAFT") throw new MediaRelationImmutableError();
      if (
        expectedUpdatedAt &&
        revision.updatedAt !== expectedUpdatedAt
      )
        throw new MediaRelationConflictError();
      const rows = await connection.query<RelationRow>(
        `SELECT media_asset_id FROM question_media_placements
         WHERE question_revision_id = ? AND placement_key = ? FOR UPDATE`,
        [questionRevisionId, placementKey],
      );
      if (!rows[0]) return false;
      const result = await connection.execute(
        `DELETE FROM question_media_placements
         WHERE question_revision_id = ? AND placement_key = ?`,
        [questionRevisionId, placementKey],
      );
      const mediaAssetId = parseDatabaseId(rows[0].media_asset_id);
      if (mediaAssetId)
        await removeLegacyMirrorIfUnused(connection, questionRevisionId, mediaAssetId);
      return result.affectedRows === 1;
    });
  }

  async update(input: {
    readonly questionRevisionId: Id;
    readonly placementKey: string;
    readonly altText?: string | null;
    readonly isDecorative?: boolean;
    readonly questionOptionId?: Id | null;
    readonly trueFalseStatementId?: Id | null;
    readonly sortOrder?: number;
    readonly displayWidthPercent?: number;
    readonly alignment?: import("./relation-domain").MediaAlignment;
    readonly expectedUpdatedAt?: UtcTimestamp;
  }): Promise<MediaRelation | null> {
    return this.database.transaction(async (connection) => {
      const revision = await readRevisionTarget(
        connection,
        input.questionRevisionId,
        true,
      );
      if (!revision) throw new MediaRelationNotFoundError();
      if (revision.status !== "DRAFT") throw new MediaRelationImmutableError();
      if (
        input.expectedUpdatedAt &&
        revision.updatedAt !== input.expectedUpdatedAt
      )
        throw new MediaRelationConflictError();
      const rows = await connection.query<RelationRow>(
        `SELECT placement_key, question_revision_id, media_asset_id, \`usage\`,
                question_option_id, true_false_statement_id, sort_order,
                alt_text, is_decorative, display_width_percent, alignment,
                updated_at
         FROM question_media_placements
         WHERE question_revision_id = ? AND placement_key = ? FOR UPDATE`,
        [input.questionRevisionId, input.placementKey],
      );
      if (!rows[0]) return null;
      const current = mapRelation(rows[0]);
      const next = validateMediaAttachment({
        questionRevisionId: input.questionRevisionId,
        mediaAssetId: current.mediaAssetId,
        ...(current.placementKey
          ? { placementKey: current.placementKey }
          : {}),
        usage: current.usage,
        questionOptionId:
          input.questionOptionId === undefined
            ? current.questionOptionId ?? null
            : input.questionOptionId,
        trueFalseStatementId:
          input.trueFalseStatementId === undefined
            ? current.trueFalseStatementId ?? null
            : input.trueFalseStatementId,
        sortOrder: input.sortOrder ?? current.sortOrder ?? 0,
        altText: input.altText === undefined ? current.altText : input.altText,
        isDecorative:
          input.isDecorative === undefined
            ? current.isDecorative
            : input.isDecorative,
        displayWidthPercent:
          input.displayWidthPercent ?? current.displayWidthPercent ?? 100,
        alignment: input.alignment ?? current.alignment ?? "CENTER",
      });
      await assertChildTarget(connection, next);
      await connection.execute(
        `UPDATE question_media_placements
         SET question_option_id = ?, true_false_statement_id = ?, sort_order = ?,
             alt_text = ?, is_decorative = ?, display_width_percent = ?,
             alignment = ?, updated_at = UTC_TIMESTAMP(6)
         WHERE question_revision_id = ? AND placement_key = ?`,
        [
          next.questionOptionId,
          next.trueFalseStatementId,
          next.sortOrder,
          next.altText,
          next.isDecorative,
          next.displayWidthPercent,
          next.alignment,
          input.questionRevisionId,
          input.placementKey,
        ],
      );
      return next;
    });
  }

  async listOrphans(input: {
    readonly createdBy?: Id;
    readonly limit?: number;
    readonly olderThan?: UtcTimestamp;
  } = {}): Promise<readonly MediaAsset[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
    const params: unknown[] = [];
    const owner = input.createdBy ? "AND ma.created_by = ?" : "";
    if (input.createdBy) params.push(input.createdBy);
    const age = input.olderThan ? "AND ma.created_at <= ?" : "";
    if (input.olderThan) params.push(input.olderThan);
    params.push(limit);
    const rows = await this.database.query<AssetRow>(
      `SELECT ma.id, ma.storage_key, ma.original_name, ma.mime_type,
              ma.byte_size, ma.sha256, ma.width, ma.height, ma.status,
              ma.created_by
       FROM media_assets ma
       WHERE ma.status = 'READY' ${owner} ${age}
         AND NOT EXISTS (SELECT 1 FROM question_media_placements p WHERE p.media_asset_id = ma.id)
         AND NOT EXISTS (SELECT 1 FROM question_revision_media legacy WHERE legacy.media_asset_id = ma.id)
       ORDER BY ma.created_at ASC, ma.id ASC LIMIT ?`,
      params,
    );
    return rows.map(mapAsset);
  }

  async refreshRevisionHash(questionRevisionId: Id): Promise<void> {
    await this.database.transaction(async (connection) => {
      const rows = await connection.query<Row>(
        `SELECT id, \`type\`, stimulus_html, prompt_html, explanation_html
         FROM question_revisions WHERE id = ? FOR UPDATE`,
        [questionRevisionId],
      );
      const revision = rows[0];
      if (!revision) throw new MediaRelationNotFoundError();
      const optionRows = await connection.query<Row>(
        "SELECT id, position, content_html, is_correct FROM question_options WHERE question_revision_id = ? ORDER BY position",
        [questionRevisionId],
      );
      const statementRows = await connection.query<Row>(
        "SELECT id, position, statement_html, correct_value FROM true_false_statements WHERE question_revision_id = ? ORDER BY position",
        [questionRevisionId],
      );
      const placementRows = await connection.query<RelationRow>(
        `SELECT placement_key, question_revision_id, media_asset_id, \`usage\`,
                question_option_id, true_false_statement_id, sort_order,
                alt_text, is_decorative, display_width_percent, alignment
         FROM question_media_placements WHERE question_revision_id = ?`,
        [questionRevisionId],
      );
      const legacyRows = placementRows.length
        ? []
        : await connection.query<RelationRow>(
            `SELECT question_revision_id, media_asset_id, \`usage\`, alt_text,
                    is_decorative FROM question_revision_media
             WHERE question_revision_id = ?`,
            [questionRevisionId],
          );
      const content: QuestionDraftContent = {
        type: String(revision.type) as QuestionDraftContent["type"],
        stimulusHtml: sanitizeRichContent(String(revision.stimulus_html), 100_000),
        promptHtml:
          revision.prompt_html === null
            ? null
            : sanitizeRichContent(String(revision.prompt_html), 100_000),
        explanationHtml:
          revision.explanation_html === null
            ? null
            : sanitizeRichContent(String(revision.explanation_html), 100_000),
          options: optionRows.map((row) => ({
          ...(parseDatabaseId(row.id)
            ? { id: parseDatabaseId(row.id) as Id }
            : {}),
          position: Number(row.position),
          contentHtml: sanitizeRichContent(String(row.content_html), 20_000),
          isCorrect: toBoolean(row.is_correct) ?? false,
        })),
          statements: statementRows.map((row) => ({
          ...(parseDatabaseId(row.id)
            ? { id: parseDatabaseId(row.id) as Id }
            : {}),
          position: Number(row.position),
          statementHtml: sanitizeRichContent(String(row.statement_html), 20_000),
          correctValue: toBoolean(row.correct_value) ?? false,
        })),
      };
      const media = (placementRows.length ? placementRows : legacyRows).map(
        (row) => toHashEntry(mapRelation(row)),
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalQuestionValue(content, media)),
      );
      await connection.execute(
        `UPDATE question_revisions
         SET content_hash = ?,
             updated_at = IF(status = 'DRAFT', UTC_TIMESTAMP(6), updated_at)
         WHERE id = ?`,
        [new Uint8Array(digest), questionRevisionId],
      );
    });
  }

  async deleteAsset(id: Id): Promise<MediaAsset | null> {
    return this.database.transaction(async (connection) => {
      const asset = await readAsset(connection, id, true);
      if (!asset || asset.status !== "READY") return null;
      const placementReferences = await connection.query<ReferenceRow>(
        `SELECT p.question_revision_id, qr.status AS revision_status
         FROM question_media_placements p
         JOIN question_revisions qr ON qr.id = p.question_revision_id
         WHERE p.media_asset_id = ? FOR UPDATE`,
        [id],
      );
      const legacyReferences = await connection.query<ReferenceRow>(
        `SELECT qrm.question_revision_id, qr.status AS revision_status
         FROM question_revision_media qrm
         JOIN question_revisions qr ON qr.id = qrm.question_revision_id
         WHERE qrm.media_asset_id = ? FOR UPDATE`,
        [id],
      );
      const references = [...placementReferences, ...legacyReferences];
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

  async restoreAsset(id: Id): Promise<void> {
    await this.database.execute(
      "UPDATE media_assets SET status = 'READY', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status = 'DELETED'",
      [id],
    );
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
    `SELECT qr.id, qr.status, qr.updated_at, qb.owner_teacher_id,
            qb.subject_id, qb.id AS question_bank_id,
            qb.name AS question_bank_name
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
    ...(row.updated_at === undefined
      ? {}
      : { updatedAt: String(row.updated_at) as UtcTimestamp }),
  };
}

function mapAsset(row: AssetRow): MediaAsset {
  const id = parseDatabaseId(row.id);
  const createdBy = parseDatabaseId(row.created_by);
  if (!id || !createdBy) throw new Error("Database returned invalid media ID");
  if (typeof row.storage_key !== "string" || typeof row.original_name !== "string")
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
  const placementKey =
    typeof row.placement_key === "string"
      ? row.placement_key
      : `legacy-${questionRevisionId}-${mediaAssetId}`;
  const alignment =
    typeof row.alignment === "string" &&
    MEDIA_ALIGNMENTS.includes(row.alignment as (typeof MEDIA_ALIGNMENTS)[number])
      ? (row.alignment as (typeof MEDIA_ALIGNMENTS)[number])
      : "CENTER";
  const mediaAssetStatus =
    row.media_asset_status === "READY" || row.media_asset_status === "DELETED"
      ? row.media_asset_status
      : undefined;
  return {
    placementKey,
    questionRevisionId,
    mediaAssetId,
    usage: row.usage as MediaUsage,
    questionOptionId: parseDatabaseId(row.question_option_id),
    trueFalseStatementId: parseDatabaseId(row.true_false_statement_id),
    sortOrder: Number(row.sort_order ?? 0),
    altText: row.alt_text as string | null,
    isDecorative,
    displayWidthPercent: Number(row.display_width_percent ?? 100),
    alignment,
    ...(mediaAssetStatus === undefined ? {} : { mediaAssetStatus }),
    ...(row.updated_at === undefined
      ? {}
      : { updatedAt: String(row.updated_at) as UtcTimestamp }),
  };
}

function mapLegacyRelation(row: RelationRow): MediaRelation {
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
  const mediaAssetStatus =
    row.media_asset_status === "READY" || row.media_asset_status === "DELETED"
      ? row.media_asset_status
      : undefined;
  return {
    questionRevisionId,
    mediaAssetId,
    usage: row.usage as MediaUsage,
    altText: row.alt_text as string | null,
    isDecorative,
    ...(mediaAssetStatus === undefined ? {} : { mediaAssetStatus }),
  };
}

async function assertChildTarget(
  connection: DatabaseConnection,
  input: AttachMediaInput,
): Promise<void> {
  if (input.usage === "OPTION") {
    const rows = await connection.query<Row>(
      "SELECT id FROM question_options WHERE id = ? AND question_revision_id = ? LIMIT 1",
      [input.questionOptionId, input.questionRevisionId],
    );
    if (!rows[0]) throw new MediaRelationNotFoundError("Option target was not found");
  }
  if (input.usage === "STATEMENT") {
    const rows = await connection.query<Row>(
      "SELECT id FROM true_false_statements WHERE id = ? AND question_revision_id = ? LIMIT 1",
      [input.trueFalseStatementId, input.questionRevisionId],
    );
    if (!rows[0]) throw new MediaRelationNotFoundError("Statement target was not found");
  }
}

async function removeLegacyMirrorIfUnused(
  connection: DatabaseConnection,
  questionRevisionId: Id,
  mediaAssetId: Id,
): Promise<void> {
  const remaining = await connection.query<Row>(
    `SELECT id FROM question_media_placements
     WHERE question_revision_id = ? AND media_asset_id = ? LIMIT 1`,
    [questionRevisionId, mediaAssetId],
  );
  if (!remaining[0])
    await connection.execute(
      "DELETE FROM question_revision_media WHERE question_revision_id = ? AND media_asset_id = ?",
      [questionRevisionId, mediaAssetId],
    );
}

function toHashEntry(relation: MediaRelation): CanonicalMediaHashEntry {
  return {
    placementKey:
      relation.placementKey ?? `${relation.questionRevisionId}-${relation.mediaAssetId}`,
    mediaAssetId: relation.mediaAssetId,
    usage: relation.usage,
    questionOptionId: relation.questionOptionId ?? null,
    trueFalseStatementId: relation.trueFalseStatementId ?? null,
    sortOrder: relation.sortOrder ?? 0,
    altText: relation.altText,
    isDecorative: relation.isDecorative,
    displayWidthPercent: relation.displayWidthPercent ?? 100,
    alignment: relation.alignment ?? "CENTER",
  };
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
