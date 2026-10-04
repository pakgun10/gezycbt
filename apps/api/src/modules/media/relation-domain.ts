import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { MediaAsset } from "./domain";

export const MEDIA_USAGES = [
  "STIMULUS",
  "PROMPT",
  "EXPLANATION",
  "OPTION",
  "STATEMENT",
] as const;
export type MediaUsage = (typeof MEDIA_USAGES)[number];

export const MEDIA_ALIGNMENTS = ["LEFT", "CENTER", "RIGHT"] as const;
export type MediaAlignment = (typeof MEDIA_ALIGNMENTS)[number];

export const MAX_MEDIA_PLACEMENTS_PER_REVISION = 3;
export const DEFAULT_MEDIA_DISPLAY_WIDTH_PERCENT = 100;

export interface MediaRelation {
  readonly placementKey?: string;
  readonly questionRevisionId: Id;
  readonly mediaAssetId: Id;
  readonly usage: MediaUsage;
  readonly questionOptionId?: Id | null;
  readonly trueFalseStatementId?: Id | null;
  readonly sortOrder?: number;
  readonly altText: string | null;
  readonly isDecorative: boolean;
  readonly displayWidthPercent?: number;
  readonly alignment?: MediaAlignment;
  /** Internal readiness signal; never included in participant resources. */
  readonly mediaAssetStatus?: "READY" | "DELETED";
  readonly updatedAt?: UtcTimestamp;
}

export interface AttachMediaInput {
  readonly questionRevisionId: Id;
  readonly mediaAssetId: Id;
  readonly usage: MediaUsage;
  readonly placementKey?: string;
  readonly questionOptionId?: Id | null;
  readonly trueFalseStatementId?: Id | null;
  readonly sortOrder?: number;
  readonly altText: string | null;
  readonly isDecorative: boolean;
  readonly displayWidthPercent?: number;
  readonly alignment?: MediaAlignment;
  readonly expectedUpdatedAt?: UtcTimestamp;
}

export interface MediaRevisionTarget {
  readonly id: Id;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly ownerTeacherId: Id;
  readonly subjectId: Id;
  readonly questionBankId: Id;
  readonly questionBankName: string;
  readonly updatedAt?: UtcTimestamp;
}

export interface MediaAssetReference {
  readonly questionRevisionId: Id;
  readonly revisionStatus: "DRAFT" | "PUBLISHED";
}

export interface MediaRelationRepository {
  findRevisionTarget(id: Id): Promise<MediaRevisionTarget | null>;
  findAsset(id: Id): Promise<MediaAsset | null>;
  list(questionRevisionId: Id): Promise<readonly MediaRelation[]>;
  attach(input: AttachMediaInput): Promise<MediaRelation>;
  detach(
    questionRevisionId: Id,
    mediaAssetId: Id,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<boolean>;
  detachByPlacement?(
    questionRevisionId: Id,
    placementKey: string,
    expectedUpdatedAt?: UtcTimestamp,
  ): Promise<boolean>;
  update?(input: {
    readonly questionRevisionId: Id;
    readonly placementKey: string;
    readonly altText?: string | null;
    readonly isDecorative?: boolean;
    readonly questionOptionId?: Id | null;
    readonly trueFalseStatementId?: Id | null;
    readonly sortOrder?: number;
    readonly displayWidthPercent?: number;
    readonly alignment?: MediaAlignment;
    readonly expectedUpdatedAt?: UtcTimestamp;
  }): Promise<MediaRelation | null>;
  listOrphans?(input?: {
    readonly createdBy?: Id;
    readonly limit?: number;
    readonly olderThan?: UtcTimestamp;
  }): Promise<readonly MediaAsset[]>;
  restoreAsset?(id: Id): Promise<void>;
  refreshRevisionHash?(questionRevisionId: Id): Promise<void>;
  deleteAsset(id: Id): Promise<MediaAsset | null>;
}

export class MediaRelationValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaRelationValidationError";
  }
}

export class MediaRelationNotFoundError extends Error {
  constructor(message = "Media relation target was not found") {
    super(message);
    this.name = "MediaRelationNotFoundError";
  }
}

export class MediaRelationConflictError extends Error {
  constructor() {
    super("Media asset is already attached to this question revision");
    this.name = "MediaRelationConflictError";
  }
}

export class MediaRelationVersionConflictError extends Error {
  constructor() {
    super("Media placement was changed by another request");
    this.name = "MediaRelationVersionConflictError";
  }
}

export class MediaRelationImmutableError extends Error {
  constructor(message = "Published question media cannot be changed") {
    super(message);
    this.name = "MediaRelationImmutableError";
  }
}

export class MediaAssetReferencedError extends Error {
  constructor() {
    super("Media asset must be detached before it can be deleted");
    this.name = "MediaAssetReferencedError";
  }
}

export class MediaPublishedReferenceError extends Error {
  constructor() {
    super("Media asset is referenced by a published question revision");
    this.name = "MediaPublishedReferenceError";
  }
}

export function validateMediaAttachment(
  input: AttachMediaInput,
): AttachMediaInput {
  if (!MEDIA_USAGES.includes(input.usage))
    throw new MediaRelationValidationError(
      "INVALID_USAGE",
      "Media usage is invalid",
    );
  if (typeof input.isDecorative !== "boolean")
    throw new MediaRelationValidationError(
      "DECORATIVE_FLAG_REQUIRED",
      "Decorative media must be explicit",
    );
  const altText = normalizeAltText(input.altText, input.isDecorative);
  const placementKey = input.placementKey ?? createPlacementKey();
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(placementKey))
    throw new MediaRelationValidationError(
      "PLACEMENT_KEY_INVALID",
      "Placement key media tidak valid",
    );
  if (input.usage === "OPTION" && !input.questionOptionId)
    throw new MediaRelationValidationError(
      "TARGET_REQUIRED",
      "Media opsi harus mempunyai target option",
    );
  if (input.usage === "STATEMENT" && !input.trueFalseStatementId)
    throw new MediaRelationValidationError(
      "TARGET_REQUIRED",
      "Media pernyataan harus mempunyai target statement",
    );
  if (input.usage !== "OPTION" && input.questionOptionId)
    throw new MediaRelationValidationError(
      "TARGET_INVALID",
      "Target option hanya boleh digunakan untuk media opsi",
    );
  if (input.usage !== "STATEMENT" && input.trueFalseStatementId)
    throw new MediaRelationValidationError(
      "TARGET_INVALID",
      "Target statement hanya boleh digunakan untuk media pernyataan",
    );
  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100)
    throw new MediaRelationValidationError(
      "ORDER_INVALID",
      "Urutan media tidak valid",
    );
  const displayWidthPercent = input.displayWidthPercent ?? DEFAULT_MEDIA_DISPLAY_WIDTH_PERCENT;
  if (
    !Number.isInteger(displayWidthPercent) ||
    displayWidthPercent < 10 ||
    displayWidthPercent > 100
  )
    throw new MediaRelationValidationError(
      "DISPLAY_WIDTH_INVALID",
      "Ukuran tampil media harus antara 10 dan 100 persen",
    );
  const alignment = input.alignment ?? "CENTER";
  if (!MEDIA_ALIGNMENTS.includes(alignment))
    throw new MediaRelationValidationError(
      "ALIGNMENT_INVALID",
      "Alignment media tidak valid",
    );
  return {
    ...input,
    placementKey,
    questionOptionId: input.questionOptionId ?? null,
    trueFalseStatementId: input.trueFalseStatementId ?? null,
    sortOrder,
    altText,
    displayWidthPercent,
    alignment,
  };
}

function createPlacementKey(): string {
  return `placement-${crypto.randomUUID().replaceAll("-", "")}`;
}

function normalizeAltText(
  value: string | null,
  isDecorative: boolean,
): string | null {
  if (isDecorative) {
    if (value !== null && value.trim() !== "")
      throw new MediaRelationValidationError(
        "DECORATIVE_ALT_FORBIDDEN",
        "Decorative media must not have informative alt text",
      );
    return null;
  }
  if (typeof value !== "string")
    throw new MediaRelationValidationError(
      "ALT_REQUIRED",
      "Informative media requires alt text",
    );
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 500)
    throw new MediaRelationValidationError(
      "ALT_REQUIRED",
      "Alt text must contain between 1 and 500 characters",
    );
  if (
    [...normalized].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    throw new MediaRelationValidationError(
      "ALT_INVALID",
      "Alt text contains a control character",
    );
  return normalized;
}
