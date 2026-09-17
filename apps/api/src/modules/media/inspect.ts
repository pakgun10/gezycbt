import {
  type DecodedImageInfo,
  MEDIA_LIMITS,
  type MediaMimeType,
  MediaValidationError,
} from "./domain";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function detectMediaMimeType(bytes: Uint8Array): MediaMimeType {
  if (matches(bytes, PNG_SIGNATURE)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
    return "image/webp";
  throw invalid("UNSUPPORTED_FORMAT", "Only JPEG, PNG, and WebP are allowed");
}

/**
 * Performs bounded container parsing before a decoder is invoked. This keeps
 * MIME and dimensions independent from the browser's claimed Content-Type.
 */
export function inspectImageContainer(
  bytes: Uint8Array,
  mimeType: MediaMimeType,
): DecodedImageInfo {
  if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_LIMITS.maxBytes)
    throw invalid("BYTE_LIMIT", "Image exceeds the 2 MiB limit");
  const detected = detectMediaMimeType(bytes);
  if (detected !== mimeType)
    throw invalid("MIME_MISMATCH", "Image MIME does not match its content");
  const dimensions =
    mimeType === "image/png"
      ? inspectPng(bytes)
      : mimeType === "image/jpeg"
        ? inspectJpeg(bytes)
        : inspectWebp(bytes);
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MEDIA_LIMITS.maxDimension ||
    dimensions.height > MEDIA_LIMITS.maxDimension
  )
    throw invalid("DIMENSION_LIMIT", "Image dimensions exceed 2500 pixels");
  return { mimeType, ...dimensions };
}

function inspectPng(bytes: Uint8Array): { width: number; height: number } {
  if (readUint32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR")
    throw invalid("DECODE_FAILED", "PNG header is invalid");
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  let offset = 8;
  let hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw invalid("DECODE_FAILED", "PNG is truncated");
    const type = ascii(bytes, offset + 4, 4);
    if (type === "IEND") {
      hasEnd = true;
      break;
    }
    offset = end;
  }
  if (!hasEnd) throw invalid("DECODE_FAILED", "PNG has no complete IEND chunk");
  return { width, height };
}

function inspectJpeg(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === undefined || marker === 0x00) continue;
    if (offset + 2 > bytes.length)
      throw invalid("DECODE_FAILED", "JPEG segment is truncated");
    const length = readUint16(bytes, offset);
    if (length < 2 || offset + length > bytes.length)
      throw invalid("DECODE_FAILED", "JPEG segment length is invalid");
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) throw invalid("DECODE_FAILED", "JPEG frame is invalid");
      return {
        height: readUint16(bytes, offset + 3),
        width: readUint16(bytes, offset + 5),
      };
    }
    offset += length;
  }
  throw invalid("DECODE_FAILED", "JPEG frame could not be decoded");
}

function inspectWebp(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30)
    throw invalid("DECODE_FAILED", "WebP header is invalid");
  const chunkType = ascii(bytes, 12, 4);
  const chunkSize = readUint32LittleEndian(bytes, 16);
  if (chunkSize + 20 > bytes.length)
    throw invalid("DECODE_FAILED", "WebP chunk is truncated");
  if (chunkType === "VP8X") {
    const width = 1 + readUint24LittleEndian(bytes, 24);
    const height = 1 + readUint24LittleEndian(bytes, 27);
    return { width, height };
  }
  if (chunkType === "VP8 ") {
    const frame = 20;
    if (ascii(bytes, frame + 3, 3) !== "\x9d\x01*" || frame + 10 > bytes.length)
      throw invalid("DECODE_FAILED", "WebP VP8 frame is invalid");
    return {
      width: readUint16LittleEndian(bytes, frame + 6) & 0x3fff,
      height: readUint16LittleEndian(bytes, frame + 8) & 0x3fff,
    };
  }
  if (chunkType === "VP8L" && bytes[20] === 0x2f) {
    const bits = readUint32LittleEndian(bytes, 21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  throw invalid("DECODE_FAILED", "WebP frame is invalid");
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function matches(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function invalid(code: string, message: string): MediaValidationError {
  return new MediaValidationError(code, message);
}
