import type { CursorPage, Id, UtcTimestamp } from "@gezycbt/contracts";

export const IMPORT_CLASSIFICATIONS = [
  "CREATE",
  "UNCHANGED",
  "WOULD_UPDATE",
  "DUPLICATE",
  "ERROR",
] as const;
export type ImportClassification = (typeof IMPORT_CLASSIFICATIONS)[number];

export const IMPORT_STATUSES = [
  "PENDING",
  "COMMITTING",
  "COMMITTED",
  "EXPIRED",
  "FAILED",
] as const;
export type ImportPreviewStatus = (typeof IMPORT_STATUSES)[number];

export interface ImportFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ParsedParticipantRow {
  readonly rowNumber: number;
  readonly username: string;
  readonly displayName: string;
  readonly classCode: string | null;
  readonly errors: readonly ImportFieldError[];
}

export interface ResolvedParticipantUser {
  readonly id: Id;
  readonly usernameNormalized: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly activeClassId: Id | null;
}

export interface ResolvedClass {
  readonly id: Id;
  readonly code: string;
}

export interface ImportResolution {
  readonly users: readonly ResolvedParticipantUser[];
  readonly classes: readonly ResolvedClass[];
}

export interface PreviewRow {
  readonly rowNumber: number;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly classCode: string | null;
  readonly classId: Id | null;
  readonly existingUserId: Id | null;
  readonly classification: ImportClassification;
  readonly blocking: boolean;
  readonly errors: readonly ImportFieldError[];
}

export interface ImportPreviewSummary {
  readonly totalRows: number;
  readonly createCount: number;
  readonly updateCount: number;
  readonly unchangedCount: number;
  readonly duplicateCount: number;
  readonly errorCount: number;
  readonly blockingCount: number;
}

export interface ImportPreview {
  readonly id: Id;
  readonly ownerUserId: Id;
  readonly academicYearId: Id;
  readonly mode: "CREATE_ONLY";
  readonly sourceSha256: string;
  readonly status: ImportPreviewStatus;
  readonly expiresAt: UtcTimestamp;
  readonly committedAt: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly summary: ImportPreviewSummary;
}

export interface ImportCommitResult {
  readonly previewId: Id;
  readonly artifactId: Id;
  readonly createdUserCount: number;
  readonly committedAt: UtcTimestamp;
}

export interface CredentialArtifactRow {
  readonly username: string;
  readonly displayName: string;
  readonly temporaryPassword: string;
}

export interface CredentialArtifactCipher {
  seal(rows: readonly CredentialArtifactRow[]): Promise<Uint8Array>;
  open(payload: Uint8Array): Promise<readonly CredentialArtifactRow[]>;
}

export interface CredentialArtifactDownload {
  readonly filename: string;
  readonly content: string;
  readonly expiresAt: UtcTimestamp;
}

export interface CreatePreviewRecord {
  readonly ownerUserId: Id;
  readonly academicYearId: Id;
  readonly sourceSha256: Uint8Array;
  readonly commitTokenHash: Uint8Array;
  readonly expiresAt: UtcTimestamp;
  readonly rows: readonly PreviewRow[];
  readonly summary: ImportPreviewSummary;
}

export interface ImportRowPageRequest {
  readonly cursor?: string;
  readonly limit?: number;
  readonly classification?: ImportClassification;
}

export type ImportRowPage = CursorPage<PreviewRow>;

export class ImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportValidationError";
  }
}

export class ImportPreviewNotFoundError extends Error {
  constructor() {
    super("Import preview was not found");
    this.name = "ImportPreviewNotFoundError";
  }
}

export class ImportPreviewExpiredError extends Error {
  constructor() {
    super("Import preview has expired");
    this.name = "ImportPreviewExpiredError";
  }
}

export class ImportPreviewAlreadyCommittedError extends Error {
  constructor() {
    super("Import preview has already been committed");
    this.name = "ImportPreviewAlreadyCommittedError";
  }
}

export class ImportPreviewCommitConflictError extends Error {
  constructor(message = "Import preview commit conflicts with current data") {
    super(message);
    this.name = "ImportPreviewCommitConflictError";
  }
}

export class ImportPreviewBlockingError extends Error {
  constructor() {
    super("Import preview contains blocking rows");
    this.name = "ImportPreviewBlockingError";
  }
}

export class CredentialArtifactNotFoundError extends Error {
  constructor() {
    super("Credential artifact was not found");
    this.name = "CredentialArtifactNotFoundError";
  }
}

export class CredentialArtifactExpiredError extends Error {
  constructor() {
    super("Credential artifact has expired or was already downloaded");
    this.name = "CredentialArtifactExpiredError";
  }
}

export class ReauthenticationRequiredError extends Error {
  constructor() {
    super("Recent re-authentication is required");
    this.name = "ReauthenticationRequiredError";
  }
}

export function parseImportClassification(
  value: string | undefined,
): ImportClassification | undefined {
  if (value === undefined) return undefined;
  if (!IMPORT_CLASSIFICATIONS.includes(value as ImportClassification)) {
    throw new ImportValidationError("Import row filter is invalid");
  }
  return value as ImportClassification;
}

export function decodeCursor(cursor: string | undefined): Id | undefined {
  if (cursor === undefined) return undefined;
  if (!/^\d+$/u.test(cursor)) {
    throw new ImportValidationError("Cursor is invalid");
  }
  return cursor as Id;
}
