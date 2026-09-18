import { formatUtcTimestamp, type Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import { validateCode } from "../academics/domain";
import { normalizeUsername, validateDisplayName } from "../users/domain";
import {
  type CreatePreviewRecord,
  type ImportFieldError,
  type ImportPreview,
  ImportPreviewNotFoundError,
  type ImportPreviewSummary,
  type ImportResolution,
  type ImportRowPage,
  type ImportRowPageRequest,
  ImportValidationError,
  type ParsedParticipantRow,
  type PreviewRow,
  parseImportClassification,
} from "./domain";
import { parseParticipantCsv } from "./parser";
import type { UserImportRepository } from "./repository";

export interface CreateParticipantPreviewInput {
  readonly academicYearId: Id;
  readonly csv: string;
}

export interface CreatedParticipantPreview {
  readonly preview: ImportPreview;
  readonly commitToken: string;
}

export class UserImportPreviewService {
  constructor(private readonly repository: UserImportRepository) {}

  async createPreview(
    context: UseCaseContext,
    input: CreateParticipantPreviewInput,
  ): Promise<CreatedParticipantPreview> {
    assertMutationContext(context);
    const parsed = parseParticipantCsv(input.csv);
    const normalizedRows = normalizeRows(parsed.rows);
    const normalizedNames = normalizedRows
      .map((row) => row.usernameNormalized)
      .filter((value): value is string => value !== null);
    const classCodes = [
      ...new Set(
        normalizedRows
          .map((row) => row.classCode)
          .filter((value): value is string => value !== null),
      ),
    ];
    const resolution = await this.repository.resolveParticipants(
      input.academicYearId,
      normalizedNames,
      classCodes,
    );
    const rows = classifyRows(normalizedRows, resolution);
    const summary = summarize(rows);
    const tokenBytes = randomBytes(32);
    // Hash the exact base64url representation returned to the client. The
    // commit endpoint receives this opaque string and must derive the same
    // digest without needing to make assumptions about its encoding.
    const commitToken = toBase64Url(tokenBytes);
    const tokenHash = await sha256(new TextEncoder().encode(commitToken));
    const sourceSha256 = await sha256(
      new TextEncoder().encode(parsed.sourceText),
    );
    const expiresAt = formatUtcTimestamp(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    const record: CreatePreviewRecord = {
      ownerUserId: requireActorUserId(context),
      academicYearId: input.academicYearId,
      sourceSha256,
      commitTokenHash: tokenHash,
      expiresAt,
      rows,
      summary,
    };
    const preview = await this.repository.createPreview(record);
    return { preview, commitToken };
  }

  async getPreview(
    context: UseCaseContext,
    previewId: Id,
  ): Promise<ImportPreview> {
    assertActorContext(context.actor);
    const preview = await this.repository.getPreview(
      requireActorUserId(context),
      previewId,
    );
    if (!preview) throw new ImportPreviewNotFoundError();
    return effectiveStatus(preview);
  }

  async listRows(
    context: UseCaseContext,
    previewId: Id,
    request: ImportRowPageRequest,
  ): Promise<ImportRowPage> {
    assertActorContext(context.actor);
    const preview = await this.repository.getPreview(
      requireActorUserId(context),
      previewId,
    );
    if (!preview) throw new ImportPreviewNotFoundError();
    const classification = parseImportClassification(request.classification);
    const normalizedRequest: ImportRowPageRequest = {
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
      ...(classification === undefined ? {} : { classification }),
    };
    return this.repository.listRows(
      requireActorUserId(context),
      previewId,
      normalizedRequest,
    );
  }

  async downloadErrorCsv(
    context: UseCaseContext,
    previewId: Id,
  ): Promise<string> {
    assertActorContext(context.actor);
    const ownerUserId = requireActorUserId(context);
    const preview = await this.repository.getPreview(ownerUserId, previewId);
    if (!preview) throw new ImportPreviewNotFoundError();
    const rows = await this.repository.listErrorRows(ownerUserId, previewId);
    const lines = ["row_number,field,code,message"];
    for (const row of rows) {
      for (const error of row.errors) {
        lines.push(
          [row.rowNumber, error.field, error.code, error.message]
            .map(csvEscape)
            .join(","),
        );
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

interface NormalizedRow extends ParsedParticipantRow {
  readonly usernameNormalized: string | null;
}

function normalizeRows(
  rows: readonly ParsedParticipantRow[],
): readonly NormalizedRow[] {
  return rows.map((row) => {
    const errors = [...row.errors];
    let usernameNormalized: string | null = null;
    try {
      usernameNormalized = normalizeUsername(row.username);
    } catch {
      errors.push({
        field: "username",
        code: "INVALID_USERNAME",
        message: "Username is invalid",
      });
    }
    if (!row.displayName) {
      errors.push({
        field: "display_name",
        code: "REQUIRED",
        message: "Display name is required",
      });
    } else {
      try {
        validateDisplayName(row.displayName);
      } catch {
        errors.push({
          field: "display_name",
          code: "INVALID_DISPLAY_NAME",
          message: "Display name is invalid",
        });
      }
    }
    let classCode = row.classCode;
    if (classCode) {
      try {
        classCode = validateCode(classCode, 50, "Class code").toUpperCase();
      } catch {
        errors.push({
          field: "class_code",
          code: "INVALID_CLASS_CODE",
          message: "Class code is invalid",
        });
      }
    }
    return { ...row, classCode, errors, usernameNormalized };
  });
}

function classifyRows(
  rows: readonly NormalizedRow[],
  resolution: ImportResolution,
): readonly PreviewRow[] {
  const users = new Map(
    resolution.users.map((user) => [user.usernameNormalized, user]),
  );
  const classes = new Map(
    resolution.classes.map((academicClass) => [
      academicClass.code.toUpperCase(),
      academicClass,
    ]),
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.usernameNormalized)
      counts.set(
        row.usernameNormalized,
        (counts.get(row.usernameNormalized) ?? 0) + 1,
      );
  }
  return rows.map((row) => {
    const errors = [...row.errors];
    const classRecord = row.classCode ? classes.get(row.classCode) : undefined;
    if (row.classCode && !classRecord) {
      errors.push({
        field: "class_code",
        code: "CLASS_NOT_FOUND",
        message: "Class was not found in the selected academic year",
      });
    }
    const duplicate = row.usernameNormalized
      ? (counts.get(row.usernameNormalized) ?? 0) > 1
      : false;
    if (errors.length) {
      return toPreviewRow(
        row,
        "ERROR",
        true,
        errors,
        classRecord?.id ?? null,
        null,
      );
    }
    if (duplicate) {
      return toPreviewRow(
        row,
        "DUPLICATE",
        true,
        [
          {
            field: "username",
            code: "DUPLICATE_IN_FILE",
            message: "Username appears more than once in the file",
          },
        ],
        classRecord?.id ?? null,
        null,
      );
    }
    const existing = row.usernameNormalized
      ? users.get(row.usernameNormalized)
      : undefined;
    if (!existing) {
      return toPreviewRow(
        row,
        "CREATE",
        false,
        [],
        classRecord?.id ?? null,
        null,
      );
    }
    if (existing.role !== "PARTICIPANT" || existing.status !== "ACTIVE") {
      return toPreviewRow(
        row,
        "ERROR",
        true,
        [
          {
            field: "username",
            code: "EXISTING_ACCOUNT_NOT_PARTICIPANT",
            message: "Existing account is not an active participant",
          },
        ],
        classRecord?.id ?? null,
        existing.id,
      );
    }
    const classChanged =
      (existing.activeClassId ?? null) !== (classRecord?.id ?? null);
    const nameChanged = existing.displayName !== row.displayName;
    return toPreviewRow(
      row,
      nameChanged || classChanged ? "WOULD_UPDATE" : "UNCHANGED",
      nameChanged || classChanged,
      [],
      classRecord?.id ?? null,
      existing.id,
    );
  });
}

function toPreviewRow(
  row: NormalizedRow,
  classification: PreviewRow["classification"],
  blocking: boolean,
  errors: readonly ImportFieldError[],
  classId: Id | null,
  existingUserId: Id | null,
): PreviewRow {
  return {
    rowNumber: row.rowNumber,
    username: row.username || null,
    displayName: row.displayName || null,
    classCode: row.classCode,
    classId,
    existingUserId,
    classification,
    blocking,
    errors,
  };
}

function summarize(rows: readonly PreviewRow[]): ImportPreviewSummary {
  return {
    totalRows: rows.length,
    createCount: rows.filter((row) => row.classification === "CREATE").length,
    updateCount: rows.filter((row) => row.classification === "WOULD_UPDATE")
      .length,
    unchangedCount: rows.filter((row) => row.classification === "UNCHANGED")
      .length,
    duplicateCount: rows.filter((row) => row.classification === "DUPLICATE")
      .length,
    errorCount: rows.filter((row) => row.classification === "ERROR").length,
    blockingCount: rows.filter((row) => row.blocking).length,
  };
}

function effectiveStatus(preview: ImportPreview): ImportPreview {
  if (
    preview.status === "PENDING" &&
    Date.parse(preview.expiresAt) <= Date.now()
  ) {
    return { ...preview, status: "EXPIRED" };
  }
  return preview;
}

function requireActorUserId(context: UseCaseContext): Id {
  if (!context.actor.userId)
    throw new ImportValidationError("Import operation requires a user actor");
  return context.actor.userId;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
