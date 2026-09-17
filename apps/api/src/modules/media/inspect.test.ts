import { describe, expect, test } from "bun:test";
import { detectMediaMimeType, inspectImageContainer } from "./inspect";

describe("media container inspection", () => {
  test("detects supported formats and dimensions", () => {
    expect(inspectImageContainer(png(12, 34), "image/png")).toEqual({
      mimeType: "image/png",
      width: 12,
      height: 34,
    });
    expect(inspectImageContainer(jpeg(56, 78), "image/jpeg")).toEqual({
      mimeType: "image/jpeg",
      width: 56,
      height: 78,
    });
    expect(inspectImageContainer(webp(90, 123), "image/webp")).toEqual({
      mimeType: "image/webp",
      width: 90,
      height: 123,
    });
  });

  test("rejects unsupported, mismatched, malformed, and oversized content", () => {
    expect(() => detectMediaMimeType(new Uint8Array([1, 2, 3]))).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_FORMAT" }),
    );
    expect(() => inspectImageContainer(png(1, 1), "image/jpeg")).toThrowError(
      expect.objectContaining({ code: "MIME_MISMATCH" }),
    );
    expect(() =>
      inspectImageContainer(png(1, 1).slice(0, 20), "image/png"),
    ).toThrowError(expect.objectContaining({ code: "DECODE_FAILED" }));
    expect(() =>
      inspectImageContainer(
        new Uint8Array(2 * 1024 * 1024 + 1).fill(0),
        "image/png",
      ),
    ).toThrowError(expect.objectContaining({ code: "BYTE_LIMIT" }));
  });

  test("rejects dimensions above the baseline limit", () => {
    expect(() =>
      inspectImageContainer(png(2_501, 1), "image/png"),
    ).toThrowError(expect.objectContaining({ code: "DIMENSION_LIMIT" }));
  });
});

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeUint32(bytes, 8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8], 0);
  writeUint16(bytes, 7, height);
  writeUint16(bytes, 9, width);
  return bytes;
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  writeUint32LittleEndian(bytes, 4, 22);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  writeUint32LittleEndian(bytes, 16, 10);
  writeUint24LittleEndian(bytes, 24, width - 1);
  writeUint24LittleEndian(bytes, 27, height - 1);
  return bytes;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint32LittleEndian(
  bytes: Uint8Array,
  offset: number,
  value: number,
): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint24LittleEndian(
  bytes: Uint8Array,
  offset: number,
  value: number,
): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
}
