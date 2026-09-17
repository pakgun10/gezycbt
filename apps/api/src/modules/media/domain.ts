import type { Id } from "@gezycbt/contracts";

export const MEDIA_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxDimension: 2_500,
  maxOriginalNameLength: 255,
} as const;

export const MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type MediaMimeType = (typeof MEDIA_MIME_TYPES)[number];

export const MEDIA_ASSET_STATUSES = ["READY", "DELETED"] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

export interface DecodedImageInfo {
  readonly mimeType: MediaMimeType;
  readonly width: number;
  readonly height: number;
}

export interface MediaAsset {
  readonly id: Id;
  readonly storageKey: string;
  readonly originalName: string;
  readonly mimeType: MediaMimeType;
  readonly byteSize: number;
  readonly sha256: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly createdBy: Id;
  readonly status: MediaAssetStatus;
}

export interface MediaAssetCreateInput {
  readonly storageKey: string;
  readonly originalName: string;
  readonly mimeType: MediaMimeType;
  readonly byteSize: number;
  readonly sha256: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly createdBy: Id;
  readonly status: MediaAssetStatus;
}

export interface MediaAssetRepository {
  create(input: MediaAssetCreateInput): Promise<MediaAsset>;
}

export interface MediaStorage {
  put(
    storageKey: string,
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ): Promise<void>;
  remove(storageKey: string): Promise<void>;
}

export interface ImageDecoder {
  decode(bytes: Uint8Array, mimeType: MediaMimeType): Promise<DecodedImageInfo>;
}

export class MediaValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaValidationError";
  }
}

export class MediaPersistenceError extends Error {
  constructor(message = "Media asset could not be persisted") {
    super(message);
    this.name = "MediaPersistenceError";
  }
}
