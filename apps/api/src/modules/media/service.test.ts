import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import {
  type DecodedImageInfo,
  type ImageDecoder,
  type MediaAsset,
  type MediaAssetCreateInput,
  type MediaAssetRepository,
  type MediaMimeType,
  MediaPersistenceError,
  type MediaStorage,
} from "./domain";
import { inspectImageContainer } from "./inspect";
import { MediaUploadService } from "./service";

const ACTOR_ID = "10" as Id;

describe("MediaUploadService", () => {
  test("stores decoded metadata with a random key and content hash", async () => {
    const storage = new FakeStorage();
    const repository = new FakeRepository();
    const bytes = png(12, 34);
    const service = new MediaUploadService(
      storage,
      repository,
      new ContainerDecoder(),
      () => new Uint8Array(Array.from({ length: 24 }, (_, index) => index + 1)),
    );

    const result = await service.upload({
      bytes,
      originalName: "../diagram\n.png",
      claimedMimeType: "image/png",
      createdBy: ACTOR_ID,
    });

    expect(result).toMatchObject({
      id: "100" as Id,
      originalName: ".._diagram_.png",
      mimeType: "image/png",
      byteSize: bytes.byteLength,
      width: 12,
      height: 34,
      createdBy: ACTOR_ID,
    });
    expect(result.storageKey).toMatch(/^media\/[A-Za-z0-9_-]+$/u);
    expect(result.storageKey).not.toContain("diagram");
    expect(Buffer.from(result.sha256).toString("hex")).toBe(
      "720a92114006e90285344363c1b49c73b2aaad327b4a7ac11db65de539aac312",
    );
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]?.bytes).not.toBe(bytes);
    expect(repository.inputs[0]?.storageKey).toBe(result.storageKey);
  });

  test("validates claimed MIME and decoder metadata before writing", async () => {
    const storage = new FakeStorage();
    const repository = new FakeRepository();
    const service = new MediaUploadService(
      storage,
      repository,
      new ContainerDecoder(),
    );

    await expect(
      service.upload({
        bytes: png(1, 1),
        originalName: "image.png",
        claimedMimeType: "image/jpeg",
        createdBy: ACTOR_ID,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "MIME_MISMATCH" }));
    expect(storage.puts).toHaveLength(0);

    await expect(
      new MediaUploadService(
        storage,
        repository,
        new FixedDecoder({
          mimeType: "image/png",
          width: 2,
          height: 1,
        }),
      ).upload({
        bytes: png(1, 1),
        originalName: "image.png",
        claimedMimeType: "image/png",
        createdBy: ACTOR_ID,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: "DECODE_MISMATCH" }),
    );
    expect(storage.puts).toHaveLength(0);
  });

  test("removes the file if metadata persistence fails", async () => {
    const storage = new FakeStorage();
    const repository = new FakeRepository();
    repository.error = new Error("database unavailable");
    const service = new MediaUploadService(
      storage,
      repository,
      new ContainerDecoder(),
    );

    await expect(service.upload(validInput())).rejects.toThrow(
      "database unavailable",
    );
    expect(storage.removed).toHaveLength(1);
    expect(storage.removed[0]).toBe(storage.puts[0]?.storageKey);
  });

  test("cleans up a partially written file when storage fails", async () => {
    const storage = new FakeStorage();
    storage.putError = new Error("disk full");
    const service = new MediaUploadService(
      storage,
      new FakeRepository(),
      new ContainerDecoder(),
    );

    await expect(service.upload(validInput())).rejects.toThrow("disk full");
    expect(storage.removed).toHaveLength(1);
    expect(storage.removed[0]).toBe(storage.puts[0]?.storageKey);
  });

  test("reports cleanup failure separately", async () => {
    const storage = new FakeStorage();
    storage.removeError = new Error("disk unavailable");
    const repository = new FakeRepository();
    repository.error = new Error("database unavailable");
    const service = new MediaUploadService(
      storage,
      repository,
      new ContainerDecoder(),
    );

    await expect(service.upload(validInput())).rejects.toBeInstanceOf(
      MediaPersistenceError,
    );
  });

  test("rejects weak generated storage keys", async () => {
    const service = new MediaUploadService(
      new FakeStorage(),
      new FakeRepository(),
      new ContainerDecoder(),
      () => new Uint8Array(8),
    );

    await expect(service.upload(validInput())).rejects.toThrowError(
      expect.objectContaining({ code: "STORAGE_KEY_FAILED" }),
    );
  });
});

function validInput() {
  return {
    bytes: png(1, 1),
    originalName: "image.png",
    claimedMimeType: "image/png",
    createdBy: ACTOR_ID,
  } as const;
}

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

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

class ContainerDecoder implements ImageDecoder {
  decode(
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ): Promise<DecodedImageInfo> {
    return Promise.resolve(inspectImageContainer(bytes, mimeType));
  }
}

class FixedDecoder implements ImageDecoder {
  constructor(private readonly result: DecodedImageInfo) {}

  decode(): Promise<DecodedImageInfo> {
    return Promise.resolve(this.result);
  }
}

class FakeStorage implements MediaStorage {
  readonly puts: Array<{
    storageKey: string;
    bytes: Uint8Array;
    mimeType: MediaMimeType;
  }> = [];
  readonly removed: string[] = [];
  putError: Error | undefined;
  removeError: Error | undefined;

  async put(
    storageKey: string,
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ): Promise<void> {
    this.puts.push({ storageKey, bytes, mimeType });
    if (this.putError) throw this.putError;
  }

  async remove(storageKey: string): Promise<void> {
    if (this.removeError) throw this.removeError;
    this.removed.push(storageKey);
  }
}

class FakeRepository implements MediaAssetRepository {
  readonly inputs: MediaAssetCreateInput[] = [];
  error: Error | undefined;

  async create(input: MediaAssetCreateInput): Promise<MediaAsset> {
    this.inputs.push(input);
    if (this.error) throw this.error;
    return { ...input, id: "100" as Id };
  }
}
