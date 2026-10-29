import { createHash } from "node:crypto";

/**
 * Minimal ZIP container (stored entries, no compression) for the backup file.
 *
 * No ZIP dependency exists in this repo, and the backup only needs a
 * portable container, not compression: database JSON is already compact
 * enough and media files are already compressed images. Stored entries keep
 * the container code small, deterministic, and easy to verify: every entry
 * carries its CRC-32, which restore checks before trusting any byte.
 *
 * Only method 0 (stored) is read back. A ZIP produced by another tool with
 * deflated entries is rejected rather than silently misread.
 */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data)
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function createZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, entry.data.byteLength, true);
    local.setUint32(22, entry.data.byteLength, true);
    local.setUint16(26, nameBytes.byteLength, true);
    local.setUint16(28, 0, true);
    localParts.push(new Uint8Array(local.buffer), nameBytes, entry.data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, entry.data.byteLength, true);
    central.setUint32(24, entry.data.byteLength, true);
    central.setUint16(28, nameBytes.byteLength, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centralParts.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.byteLength + entry.data.byteLength;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce(
    (sum, part) => sum + part.byteLength,
    0,
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of [...localParts, ...centralParts]) {
    out.set(part, at);
    at += part.byteLength;
  }
  out.set(new Uint8Array(end.buffer), at);
  return out;
}

export function parseZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;
  const decoder = new TextDecoder("utf-8");
  while (offset + 4 <= bytes.byteLength) {
    const signature = u32(view, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50)
      throw new Error("Invalid ZIP local file header");
    if (offset + 30 > bytes.byteLength) throw new Error("Truncated ZIP entry");
    const method = u16(view, offset + 8);
    if (method !== 0) throw new Error("ZIP entry is not stored (method 0)");
    const crc = u32(view, offset + 14);
    const size = u32(view, offset + 22);
    const nameLength = u16(view, offset + 26);
    const extraLength = u16(view, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + size > bytes.byteLength)
      throw new Error("Truncated ZIP entry data");
    const name = decoder.decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    const data = bytes.slice(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error("ZIP entry CRC mismatch");
    entries.push({ name, data });
    offset = dataStart + size;
  }
  if (entries.length === 0) throw new Error("ZIP archive has no entries");
  return entries;
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
