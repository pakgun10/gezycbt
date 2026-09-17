import type { Id } from "@gezycbt/contracts";
import type { MediaAsset } from "./domain";

export const MEDIA_USAGES = [
  "STIMULUS",
  "PROMPT",
  "EXPLANATION",
  "OPTION",
  "STATEMENT",
] as const;
export type MediaUsage = (typeof MEDIA_USAGES)[number];

export interface MediaRelation {
  readonly questionRevisionId: Id;
  readonly mediaAssetId: Id;
  readonly usage: MediaUsage;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}

export interface AttachMediaInput {
  readonly questionRevisionId: Id;
  readonly mediaAssetId: Id;
  readonly usage: MediaUsage;
  readonly altText: string | null;
  readonly isDecorative: boolean;
}

export interface MediaRevisionTarget {
  readonly id: Id;
  readonly status: "DRAFT" | "PUBLISHED";
  readonly ownerTeacherId: Id;
  readonly subjectId: Id;
  readonly questionBankId: Id;
  readonly questionBankName: string;
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
  detach(questionRevisionId: Id, mediaAssetId: Id): Promise<boolean>;
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
  return { ...input, altText };
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
