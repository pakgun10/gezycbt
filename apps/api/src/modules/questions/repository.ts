import {
  formatId,
  formatUtcTimestamp,
  type Id,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { DatabaseConnection, DatabasePort } from "@gezycbt/database";
import { MEDIA_ALIGNMENTS, MEDIA_USAGES } from "../media/relation-domain";
import {
  type CreateQuestionDraftInput,
  type QuestionBankSummary,
  type QuestionDraft,
  type QuestionDraftContent,
  QuestionForeignReferenceError,
  QuestionImmutableError,
  QuestionValidationError,
  QuestionVersionConflictError,
  validateQuestionContent,
  validateQuestionType,
} from "./domain";
import type { MediaRelation } from "../media/relation-domain";
import { sanitizeRichContent } from "./rich-content";

export interface QuestionDraftRepository {
  findQuestionBank(id: Id): Promise<QuestionBankSummary | null>;
  findRevision(id: Id): Promise<QuestionDraft | null>;
  listMedia?(questionRevisionId: Id): Promise<readonly MediaRelation[]>;
  refreshRevisionHash?(questionRevisionId: Id): Promise<void>;
  /** Resolves a logical question ID to its newest revision. */
  findLatestRevisionByQuestionId?(
    questionId: Id,
  ): Promise<QuestionDraft | null>;
  createDraft(
    input: CreateQuestionDraftInput & {
      readonly createdBy: Id;
      readonly contentHash: Uint8Array;
    },
  ): Promise<QuestionDraft>;
  updateDraft(
    id: Id,
    input: QuestionDraftContent & { readonly contentHash: Uint8Array },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null>;
  createDraftRevision(
    sourceRevisionId: Id,
    input: QuestionDraftContent & { readonly contentHash: Uint8Array },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null>;
}

/** Persistence operations used by the publish/edit-revision use cases. */
export interface QuestionPublishRepository extends QuestionDraftRepository {
  /** Atomically transitions a draft to PUBLISHED and freezes its content. */
  publishRevision(
    id: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null>;
}

export interface QuestionImportBatchInput {
  readonly questionBankId: Id;
  readonly createdBy: Id;
  readonly drafts: readonly {
    readonly content: QuestionDraftContent;
    readonly contentHash: Uint8Array;
  }[];
}

/** Dedicated persistence boundary for atomic CSV question imports. */
export interface QuestionImportRepository {
  findQuestionBank(id: Id): Promise<QuestionBankSummary | null>;
  createDraftBatch(input: QuestionImportBatchInput): Promise<number>;
}

type BankRow = Record<string, unknown> & {
  id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  name: unknown;
  status: unknown;
};

type RevisionRow = Record<string, unknown> & {
  id: unknown;
  question_id: unknown;
  question_bank_id: unknown;
  subject_id: unknown;
  owner_teacher_id: unknown;
  bank_name: unknown;
  bank_status: unknown;
  question_status: unknown;
  revision_no: unknown;
  type: unknown;
  status: unknown;
  stimulus_html: unknown;
  prompt_html: unknown;
  explanation_html: unknown;
  content_hash: unknown;
  published_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type OptionRow = Record<string, unknown> & {
  id: unknown;
  position: unknown;
  content_html: unknown;
  is_correct: unknown;
};

type StatementRow = Record<string, unknown> & {
  id: unknown;
  position: unknown;
  statement_html: unknown;
  correct_value: unknown;
};

const REVISION_COLUMNS = `
  SELECT qr.id, qr.question_id, q.question_bank_id,
         qb.subject_id, qb.owner_teacher_id, qb.name AS bank_name,
         qb.status AS bank_status, q.status AS question_status,
         qr.revision_no, qr.type, qr.status, qr.stimulus_html,
         qr.prompt_html, qr.explanation_html, qr.content_hash,
         qr.published_at, qr.created_at, qr.updated_at
  FROM question_revisions qr
  JOIN questions q ON q.id = qr.question_id
  JOIN question_banks qb ON qb.id = q.question_bank_id`;

export class SqlQuestionDraftRepository
  implements QuestionPublishRepository, QuestionImportRepository
{
  constructor(private readonly database: DatabasePort) {}

  async findQuestionBank(id: Id): Promise<QuestionBankSummary | null> {
    const rows = await this.database.query<BankRow>(
      `SELECT id, subject_id, owner_teacher_id, name, status
       FROM question_banks WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] ? mapBankRow(rows[0]) : null;
  }

  findRevision(id: Id): Promise<QuestionDraft | null> {
    return this.database.transaction((connection) =>
      readRevision(connection, id),
    );
  }

  async listMedia(questionRevisionId: Id): Promise<readonly MediaRelation[]> {
    const placements = await this.database.query<Record<string, unknown>>(
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
    const rows =
      placements.length > 0
        ? placements
        : await this.database.query<Record<string, unknown>>(
            `SELECT qrm.question_revision_id, qrm.media_asset_id, qrm.\`usage\`,
                    qrm.alt_text, qrm.is_decorative, ma.status AS media_asset_status
             FROM question_revision_media qrm
             JOIN media_assets ma ON ma.id = qrm.media_asset_id
             WHERE qrm.question_revision_id = ? ORDER BY qrm.media_asset_id`,
            [questionRevisionId],
          );
    return rows.map(mapMediaRelation);
  }

  findLatestRevisionByQuestionId(
    questionId: Id,
  ): Promise<QuestionDraft | null> {
    return this.database.transaction(async (connection) => {
      const rows = await connection.query<{ id: unknown }>(
        `${REVISION_COLUMNS}
         WHERE q.question_id = ?
         ORDER BY qr.revision_no DESC, qr.id DESC
         LIMIT 1`,
        [questionId],
      );
      const revisionId = rows[0]?.id;
      if (revisionId === undefined) return null;
      const parsed = parseId(String(revisionId));
      return parsed ? readRevision(connection, parsed) : null;
    });
  }

  async createDraft(
    input: CreateQuestionDraftInput & {
      readonly createdBy: Id;
      readonly contentHash: Uint8Array;
    },
  ): Promise<QuestionDraft> {
    const content = validateQuestionContent(input);
    return this.database.transaction(async (connection) => {
      const result = await connection.execute(
        `INSERT INTO questions (question_bank_id, created_by)
         VALUES (?, ?)`,
        [input.questionBankId, input.createdBy],
      );
      if (result.insertId === undefined)
        throw new Error("Question insert did not return an ID");
      const questionId = formatId(result.insertId);
      const revision = await connection.execute(
        `INSERT INTO question_revisions
           (question_id, revision_no, \`type\`, status, stimulus_html,
            prompt_html, explanation_html, content_hash)
         VALUES (?, 1, ?, 'DRAFT', ?, ?, ?, ?)`,
        [
          questionId,
          content.type,
          content.stimulusHtml,
          content.promptHtml,
          content.explanationHtml,
          input.contentHash,
        ],
      );
      if (revision.insertId === undefined)
        throw new Error("Question revision insert did not return an ID");
      await insertChildren(connection, formatId(revision.insertId), content);
      const created = await readRevision(
        connection,
        formatId(revision.insertId),
      );
      if (!created) throw new Error("Created question draft could not be read");
      return created;
    });
  }

  async createDraftBatch(input: QuestionImportBatchInput): Promise<number> {
    if (!input.drafts.length) return 0;
    return this.database.transaction(async (connection) => {
      for (const draft of input.drafts) {
        const content = validateQuestionContent(draft.content);
        const question = await connection.execute(
          `INSERT INTO questions (question_bank_id, created_by)
           VALUES (?, ?)`,
          [input.questionBankId, input.createdBy],
        );
        if (question.insertId === undefined)
          throw new Error("Question import insert did not return an ID");
        const revision = await connection.execute(
          `INSERT INTO question_revisions
             (question_id, revision_no, \`type\`, status, stimulus_html,
              prompt_html, explanation_html, content_hash)
           VALUES (?, 1, ?, 'DRAFT', ?, ?, ?, ?)`,
          [
            formatId(question.insertId),
            content.type,
            content.stimulusHtml,
            content.promptHtml,
            content.explanationHtml,
            draft.contentHash,
          ],
        );
        if (revision.insertId === undefined)
          throw new Error("Question import revision did not return an ID");
        await insertChildren(connection, formatId(revision.insertId), content);
      }
      return input.drafts.length;
    });
  }

  async updateDraft(
    id: Id,
    input: QuestionDraftContent & { readonly contentHash: Uint8Array },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null> {
    const content = validateQuestionContent(input);
    return this.database.transaction(async (connection) => {
      const current = await readRevision(connection, id, true);
      if (!current) return null;
      if (current.status !== "DRAFT") throw new QuestionImmutableError();
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)
        throw new QuestionVersionConflictError();
      await connection.execute(
        `UPDATE question_revisions
         SET \`type\` = ?, stimulus_html = ?, prompt_html = ?,
             explanation_html = ?, content_hash = ?, updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'DRAFT'`,
        [
          content.type,
          content.stimulusHtml,
          content.promptHtml,
          content.explanationHtml,
          input.contentHash,
          id,
        ],
      );
      await syncChildren(connection, id, content);
      return readRevision(connection, id);
    });
  }

  async createDraftRevision(
    sourceRevisionId: Id,
    input: QuestionDraftContent & { readonly contentHash: Uint8Array },
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null> {
    const content = validateQuestionContent(input);
    return this.database.transaction(async (connection) => {
      const source = await readRevision(connection, sourceRevisionId, true);
      if (!source) return null;
      if (source.status !== "PUBLISHED") throw new QuestionImmutableError();
      if (expectedUpdatedAt && source.updatedAt !== expectedUpdatedAt)
        throw new QuestionVersionConflictError();

      // The source row lock serializes revision number allocation for this
      // logical question while this transaction creates the replacement draft.
      const latestRows = await connection.query<{ revision_no: unknown }>(
        `SELECT revision_no
         FROM question_revisions
         WHERE question_id = ?
         ORDER BY revision_no DESC
         LIMIT 1 FOR UPDATE`,
        [source.questionId],
      );
      const latestRevisionNo = Number(latestRows[0]?.revision_no);
      if (!Number.isSafeInteger(latestRevisionNo) || latestRevisionNo < 1)
        throw new Error("Database returned invalid latest question revision");
      const revision = await connection.execute(
        `INSERT INTO question_revisions
           (question_id, revision_no, \`type\`, status, stimulus_html,
            prompt_html, explanation_html, content_hash)
         VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
        [
          source.questionId,
          latestRevisionNo + 1,
          content.type,
          content.stimulusHtml,
          content.promptHtml,
          content.explanationHtml,
          input.contentHash,
        ],
      );
      if (revision.insertId === undefined)
        throw new Error("Question revision insert did not return an ID");
      const revisionId = formatId(revision.insertId);
      await insertChildren(connection, revisionId, withoutChildIds(content));
      await copyMediaRelations(connection, sourceRevisionId, revisionId, content);
      const created = await readRevision(connection, revisionId);
      if (!created)
        throw new Error("Question draft revision could not be read");
      return created;
    });
  }

  async publishRevision(
    id: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<QuestionDraft | null> {
    return this.database.transaction(async (connection) => {
      // Lock the revision before checking its state. This serializes publish,
      // update, and any future state transition for the same revision.
      const current = await readRevision(connection, id, true);
      if (!current) return null;
      if (current.status !== "DRAFT") throw new QuestionImmutableError();
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)
        throw new QuestionVersionConflictError();

      const result = await connection.execute(
        `UPDATE question_revisions
         SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(6),
             updated_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND status = 'DRAFT'`,
        [id],
      );
      if (result.affectedRows !== 1) throw new QuestionVersionConflictError();
      const published = await readRevision(connection, id);
      if (!published) throw new Error("Published revision could not be read");
      return published;
    });
  }
}

async function copyMediaRelations(
  connection: DatabaseConnection,
  sourceRevisionId: Id,
  targetRevisionId: Id,
  content: QuestionDraftContent,
): Promise<void> {
  const optionPositionCase = childPositionCase(
    "source_option.id",
    content.options,
  );
  const statementPositionCase = childPositionCase(
    "source_statement.id",
    content.statements,
  );
  await connection.execute(
    `INSERT INTO question_media_placements
       (placement_key, question_revision_id, media_asset_id, \`usage\`,
        question_option_id, true_false_statement_id, sort_order, alt_text,
        is_decorative, display_width_percent, alignment)
     SELECT p.placement_key, ?, p.media_asset_id, p.\`usage\`,
            target_option.id, target_statement.id, p.sort_order, p.alt_text,
            p.is_decorative, p.display_width_percent, p.alignment
     FROM question_media_placements p
     LEFT JOIN question_options source_option
       ON source_option.id = p.question_option_id
      AND source_option.question_revision_id = ?
     LEFT JOIN question_options target_option
       ON target_option.question_revision_id = ?
      AND target_option.position = ${optionPositionCase.sql}
     LEFT JOIN true_false_statements source_statement
       ON source_statement.id = p.true_false_statement_id
      AND source_statement.question_revision_id = ?
     LEFT JOIN true_false_statements target_statement
       ON target_statement.question_revision_id = ?
      AND target_statement.position = ${statementPositionCase.sql}
     WHERE p.question_revision_id = ?
       AND (p.usage <> 'OPTION' OR target_option.id IS NOT NULL)
       AND (p.usage <> 'STATEMENT' OR target_statement.id IS NOT NULL)`,
    [
      targetRevisionId,
      sourceRevisionId,
      targetRevisionId,
      ...optionPositionCase.parameters,
      sourceRevisionId,
      targetRevisionId,
      ...statementPositionCase.parameters,
      sourceRevisionId,
    ],
  );
  await connection.execute(
    `INSERT INTO question_media_placements
       (placement_key, question_revision_id, media_asset_id, \`usage\`, alt_text,
        is_decorative, sort_order, display_width_percent, alignment)
     SELECT CONCAT('legacy-', ?, '-', qrm.media_asset_id), ?, qrm.media_asset_id,
            qrm.\`usage\`, qrm.alt_text, qrm.is_decorative, 0, 100, 'CENTER'
     FROM question_revision_media qrm
     WHERE qrm.question_revision_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM question_media_placements existing
         WHERE existing.question_revision_id = qrm.question_revision_id
       )
     ON DUPLICATE KEY UPDATE media_asset_id = VALUES(media_asset_id)`,
    [targetRevisionId, targetRevisionId, sourceRevisionId],
  );
  await connection.execute(
    `INSERT INTO question_revision_media
       (question_revision_id, media_asset_id, \`usage\`, alt_text, is_decorative)
     SELECT ?, media_asset_id, \`usage\`, alt_text, is_decorative
     FROM question_revision_media
     WHERE question_revision_id = ?
     ON DUPLICATE KEY UPDATE alt_text = VALUES(alt_text),
       is_decorative = VALUES(is_decorative), \`usage\` = VALUES(\`usage\`)`,
    [targetRevisionId, sourceRevisionId],
  );
}

function withoutChildIds(content: QuestionDraftContent): QuestionDraftContent {
  return {
    ...content,
    options: content.options.map(({ position, contentHtml, isCorrect }) => ({
      position,
      contentHtml,
      isCorrect,
    })),
    statements: content.statements.map(
      ({ position, statementHtml, correctValue }) => ({
        position,
        statementHtml,
        correctValue,
      }),
    ),
  };
}

function childPositionCase(
  column: string,
  children: readonly { readonly id?: Id; readonly position: number }[],
): { readonly sql: string; readonly parameters: readonly unknown[] } {
  const positionColumn = `${column.slice(0, column.lastIndexOf("."))}.position`;
  const mappings = children.filter(
    (child): child is { readonly id: Id; readonly position: number } =>
      child.id !== undefined,
  );
  if (mappings.length === 0)
    return { sql: positionColumn, parameters: [] };
  return {
    sql: `CASE ${column} ${mappings.map(() => "WHEN ? THEN ?").join(" ")} ELSE ${positionColumn} END`,
    parameters: mappings.flatMap((child) => [child.id, child.position]),
  };
}

function mapMediaRelation(row: Record<string, unknown>): MediaRelation {
  const questionRevisionId = parseDatabaseId(row.question_revision_id);
  const mediaAssetId = parseDatabaseId(row.media_asset_id);
  if (!questionRevisionId || !mediaAssetId)
    throw new Error("Database returned invalid media relation ID");
  const usage = String(row.usage);
  if (!MEDIA_USAGES.includes(usage as (typeof MEDIA_USAGES)[number]))
    throw new Error("Database returned invalid media usage");
  const decorative = row.is_decorative === true || row.is_decorative === 1 || row.is_decorative === 1n;
  const alignment = String(row.alignment ?? "CENTER");
  const mediaAssetStatus =
    row.media_asset_status === "READY" || row.media_asset_status === "DELETED"
      ? row.media_asset_status
      : undefined;
  return {
    placementKey: String(
      row.placement_key ?? `legacy-${questionRevisionId}-${mediaAssetId}`,
    ),
    questionRevisionId,
    mediaAssetId,
    usage: usage as (typeof MEDIA_USAGES)[number],
    questionOptionId: parseDatabaseId(row.question_option_id) ?? null,
    trueFalseStatementId: parseDatabaseId(row.true_false_statement_id) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    altText: row.alt_text === null ? null : String(row.alt_text),
    isDecorative: decorative,
    displayWidthPercent: Number(row.display_width_percent ?? 100),
    alignment: MEDIA_ALIGNMENTS.includes(alignment as (typeof MEDIA_ALIGNMENTS)[number])
      ? (alignment as (typeof MEDIA_ALIGNMENTS)[number])
      : "CENTER",
    ...(mediaAssetStatus === undefined ? {} : { mediaAssetStatus }),
    ...(row.updated_at === undefined
      ? {}
      : { updatedAt: String(row.updated_at) as UtcTimestamp }),
  };
}

async function readRevision(
  connection: DatabaseConnection,
  id: Id,
  lock = false,
): Promise<QuestionDraft | null> {
  const rows = await connection.query<RevisionRow>(
    `${REVISION_COLUMNS} WHERE qr.id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const optionRows = await connection.query<OptionRow>(
    `SELECT id, position, content_html, is_correct
     FROM question_options WHERE question_revision_id = ? ORDER BY position ASC`,
    [id],
  );
  const statementRows = await connection.query<StatementRow>(
    `SELECT id, position, statement_html, correct_value
     FROM true_false_statements WHERE question_revision_id = ? ORDER BY position ASC`,
    [id],
  );
  const questionId = parseDatabaseId(row.question_id);
  const revisionId = parseDatabaseId(row.id);
  if (!questionId || !revisionId)
    throw new Error("Database returned invalid question ID");
  if (typeof row.type !== "string")
    throw new Error("Database returned invalid question type");
  validateQuestionType(row.type);
  if (row.status !== "DRAFT" && row.status !== "PUBLISHED")
    throw new Error("Database returned invalid question revision status");
  const questionBank = mapBankRow({
    id: row.question_bank_id,
    subject_id: row.subject_id,
    owner_teacher_id: row.owner_teacher_id,
    name: row.bank_name,
    status: row.bank_status,
  });
  const revisionNo = Number(row.revision_no);
  if (!Number.isSafeInteger(revisionNo) || revisionNo < 1)
    throw new Error("Database returned invalid question revision number");
  if (row.question_status !== "ACTIVE" && row.question_status !== "ARCHIVED")
    throw new Error("Database returned invalid question status");
  return {
    id: revisionId,
    questionId,
    questionBank,
    questionStatus: row.question_status,
    revisionNo,
    type: row.type,
    status: row.status,
    stimulusHtml: sanitizeRichContent(
      requireText(row.stimulus_html, "stimulus_html"),
      100_000,
    ),
    promptHtml: sanitizeNullableRichContent(row.prompt_html, 100_000),
    explanationHtml: sanitizeNullableRichContent(row.explanation_html, 100_000),
    options: optionRows.map((row) => {
      const option = mapOptionRow(row);
      return {
        ...option,
        contentHtml: sanitizeRichContent(option.contentHtml, 20_000),
      };
    }),
    statements: statementRows.map((row) => {
      const statement = mapStatementRow(row);
      return {
        ...statement,
        statementHtml: sanitizeRichContent(statement.statementHtml, 20_000),
      };
    }),
    contentHash: toBytes(row.content_hash),
    publishedAt: nullableTimestamp(row.published_at),
    createdAt: toTimestamp(row.created_at),
    updatedAt: toTimestamp(row.updated_at),
  };
}

function sanitizeNullableRichContent(
  value: unknown,
  maxLength: number,
): string | null {
  const text = nullableText(value);
  return text === null ? null : sanitizeRichContent(text, maxLength);
}

async function insertChildren(
  connection: DatabaseConnection,
  revisionId: Id,
  content: QuestionDraftContent,
): Promise<void> {
  for (const option of content.options) {
    if (option.id !== undefined) throw new QuestionForeignReferenceError();
    await connection.execute(
      `INSERT INTO question_options
         (question_revision_id, position, content_html, is_correct)
       VALUES (?, ?, ?, ?)`,
      [revisionId, option.position, option.contentHtml, option.isCorrect],
    );
  }
  for (const statement of content.statements) {
    if (statement.id !== undefined) throw new QuestionForeignReferenceError();
    await connection.execute(
      `INSERT INTO true_false_statements
         (question_revision_id, position, statement_html, correct_value)
       VALUES (?, ?, ?, ?)`,
      [
        revisionId,
        statement.position,
        statement.statementHtml,
        statement.correctValue,
      ],
    );
  }
}

async function syncChildren(
  connection: DatabaseConnection,
  revisionId: Id,
  content: QuestionDraftContent,
): Promise<void> {
  const options = content.type === "TRUE_FALSE" ? [] : content.options;
  const statements = content.type === "TRUE_FALSE" ? content.statements : [];
  await syncOptions(connection, revisionId, options);
  await syncStatements(connection, revisionId, statements);
}

async function syncOptions(
  connection: DatabaseConnection,
  revisionId: Id,
  options: readonly QuestionDraftContent["options"][number][],
): Promise<void> {
  const existing = await connection.query<{ id: unknown }>(
    "SELECT id FROM question_options WHERE question_revision_id = ? FOR UPDATE",
    [revisionId],
  );
  await removeUnselected(
    connection,
    "question_options",
    revisionId,
    existing,
    options.map((option) => option.id),
  );
  for (const option of options) {
    if (option.id) {
      await connection.execute(
        `UPDATE question_options SET position = ?, content_html = ?, is_correct = ?
         WHERE id = ? AND question_revision_id = ?`,
        [
          option.position,
          option.contentHtml,
          option.isCorrect,
          option.id,
          revisionId,
        ],
      );
    } else {
      await connection.execute(
        `INSERT INTO question_options
           (question_revision_id, position, content_html, is_correct)
         VALUES (?, ?, ?, ?)`,
        [revisionId, option.position, option.contentHtml, option.isCorrect],
      );
    }
  }
}

async function syncStatements(
  connection: DatabaseConnection,
  revisionId: Id,
  statements: readonly QuestionDraftContent["statements"][number][],
): Promise<void> {
  const existing = await connection.query<{ id: unknown }>(
    "SELECT id FROM true_false_statements WHERE question_revision_id = ? FOR UPDATE",
    [revisionId],
  );
  await removeUnselected(
    connection,
    "true_false_statements",
    revisionId,
    existing,
    statements.map((statement) => statement.id),
  );
  for (const statement of statements) {
    if (statement.id) {
      await connection.execute(
        `UPDATE true_false_statements SET position = ?, statement_html = ?, correct_value = ?
         WHERE id = ? AND question_revision_id = ?`,
        [
          statement.position,
          statement.statementHtml,
          statement.correctValue,
          statement.id,
          revisionId,
        ],
      );
    } else {
      await connection.execute(
        `INSERT INTO true_false_statements
           (question_revision_id, position, statement_html, correct_value)
         VALUES (?, ?, ?, ?)`,
        [
          revisionId,
          statement.position,
          statement.statementHtml,
          statement.correctValue,
        ],
      );
    }
  }
}

async function removeUnselected(
  connection: DatabaseConnection,
  table: "question_options" | "true_false_statements",
  revisionId: Id,
  existing: readonly { id: unknown }[],
  selected: readonly (Id | undefined)[],
): Promise<void> {
  const existingIds = existing.map((row) => parseDatabaseId(row.id));
  const selectedIds = selected.filter((id): id is Id => id !== undefined);
  if (selectedIds.some((id) => !existingIds.includes(id)))
    throw new QuestionForeignReferenceError();
  const removedIds = existingIds.filter(
    (id): id is Id => id !== undefined && !selectedIds.includes(id),
  );
  if (removedIds.length > 0) {
    const relationColumn =
      table === "question_options"
        ? "question_option_id"
        : "true_false_statement_id";
    const placeholders = removedIds.map(() => "?").join(", ");
    const references = await connection.query<{ id: unknown }>(
      `SELECT id FROM question_media_placements
       WHERE question_revision_id = ? AND ${relationColumn} IN (${placeholders})
       LIMIT 1`,
      [revisionId, ...removedIds],
    );
    if (references[0])
      throw new QuestionValidationError(
        "Lepas placement gambar dari opsi/pernyataan sebelum menghapus target child.",
      );
  }
  if (selectedIds.length === 0) {
    await connection.execute(
      `DELETE FROM ${table} WHERE question_revision_id = ?`,
      [revisionId],
    );
    return;
  }
  const placeholders = selectedIds.map(() => "?").join(", ");
  await connection.execute(
    `DELETE FROM ${table} WHERE question_revision_id = ? AND id NOT IN (${placeholders})`,
    [revisionId, ...selectedIds],
  );
}

function mapBankRow(row: BankRow): QuestionBankSummary {
  const id = parseDatabaseId(row.id);
  const subjectId = parseDatabaseId(row.subject_id);
  const ownerTeacherId = parseDatabaseId(row.owner_teacher_id);
  if (!id || !subjectId || !ownerTeacherId || typeof row.name !== "string")
    throw new Error("Database returned invalid question bank");
  if (row.status !== "ACTIVE" && row.status !== "ARCHIVED")
    throw new Error("Database returned invalid question bank status");
  return { id, subjectId, ownerTeacherId, name: row.name, status: row.status };
}

function mapOptionRow(row: OptionRow) {
  const id = parseDatabaseId(row.id);
  const position = Number(row.position);
  if (!id || !Number.isSafeInteger(position) || position < 1 || position > 10)
    throw new Error("Database returned invalid question option");
  return {
    id,
    position,
    contentHtml: requireText(row.content_html, "content_html"),
    isCorrect: toBoolean(row.is_correct),
  };
}

function mapStatementRow(row: StatementRow) {
  const id = parseDatabaseId(row.id);
  const position = Number(row.position);
  if (!id || !Number.isSafeInteger(position) || position < 1 || position > 3)
    throw new Error("Database returned invalid true/false statement");
  return {
    id,
    position,
    statementHtml: requireText(row.statement_html, "statement_html"),
    correctValue: toBoolean(row.correct_value),
  };
}

function parseDatabaseId(value: unknown): Id | undefined {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return formatId(BigInt(value));
  return parseId(value);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new Error(`Database returned invalid ${field}`);
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : requireText(value, "text");
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined ? null : toTimestamp(value);
}

function toTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const timestamp = parseUtcTimestamp(
      value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
    );
    if (timestamp) return timestamp;
  }
  throw new Error("Database returned invalid question timestamp");
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Database returned invalid question content hash");
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
