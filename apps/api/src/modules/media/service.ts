import type { Id } from "@gezycbt/contracts";
import {
  type ImageDecoder,
  MEDIA_LIMITS,
  type MediaAsset,
  type MediaAssetRepository,
  type MediaMimeType,
  MediaPersistenceError,
  type MediaStorage,
  MediaValidationError,
} from "./domain";
import { detectMediaMimeType, inspectImageContainer } from "./inspect";

export interface MediaUploadInput {
  readonly bytes: Uint8Array;
  readonly originalName: string;
  readonly claimedMimeType: string | undefined;
  readonly createdBy: Id;
}

export class MediaUploadService {
  constructor(
    private readonly storage: MediaStorage,
    private readonly repository: MediaAssetRepository,
    private readonly decoder: ImageDecoder,
    private readonly randomBytes: (
      length: number,
    ) => Uint8Array = defaultRandomBytes,
  ) {}

  async upload(input: MediaUploadInput): Promise<MediaAsset> {
    const bytes = new Uint8Array(input.bytes);
    const originalName = normalizeOriginalName(input.originalName);
    const mimeType = detectMediaMimeType(bytes);
    assertClaimedMimeType(input.claimedMimeType, mimeType);
    const container = inspectImageContainer(bytes, mimeType);
    const decoded = await this.decoder.decode(bytes, mimeType);
    if (
      decoded.mimeType !== container.mimeType ||
      decoded.width !== container.width ||
      decoded.height !== container.height
    )
      throw new MediaValidationError(
        "DECODE_MISMATCH",
        "Decoded image metadata is inconsistent",
      );
    const storageKey = createStorageKey(this.randomBytes(24));
    const sha256 = new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource),
    );
    try {
      await this.storage.put(storageKey, bytes, mimeType);
      return await this.repository.create({
        storageKey,
        originalName,
        mimeType,
        byteSize: bytes.byteLength,
        sha256,
        width: decoded.width,
        height: decoded.height,
        createdBy: input.createdBy,
      });
    } catch (error) {
      try {
        await this.storage.remove(storageKey);
      } catch {
        throw new MediaPersistenceError(
          "Media metadata failed and cleanup also failed",
        );
      }
      throw error;
    }
  }
}

function normalizeOriginalName(value: string): string {
  if (typeof value !== "string")
    throw new MediaValidationError(
      "INVALID_FILENAME",
      "Original filename is invalid",
    );
  const normalized = [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return char === "\\" || char === "/" || code < 0x20 || code === 0x7f
        ? "_"
        : char;
    })
    .join("")
    .trim();
  if (
    normalized.length === 0 ||
    normalized.length > MEDIA_LIMITS.maxOriginalNameLength
  )
    throw new MediaValidationError(
      "INVALID_FILENAME",
      "Original filename is invalid",
    );
  return normalized;
}

function assertClaimedMimeType(
  claimed: string | undefined,
  detected: MediaMimeType,
): void {
  if (claimed !== undefined && claimed !== detected)
    throw new MediaValidationError(
      "MIME_MISMATCH",
      "Claimed MIME does not match image content",
    );
}

function createStorageKey(bytes: Uint8Array): string {
  if (bytes.length < 16)
    throw new MediaValidationError(
      "STORAGE_KEY_FAILED",
      "Random storage key is too short",
    );
  return `media/${base64Url(bytes)}`;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
