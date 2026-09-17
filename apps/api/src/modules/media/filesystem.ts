import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type {
  DecodedImageInfo,
  ImageDecoder,
  MediaMimeType,
  MediaStorage,
} from "./domain";
import { inspectImageContainer } from "./inspect";

/**
 * Local protected-media storage for the single-tenant deployment. Files are
 * addressed only by server-generated `media/...` keys and are never served by
 * the static web handler; a future protected download route can stream them
 * after authorization.
 */
export class FileSystemMediaStorage implements MediaStorage {
  constructor(private readonly rootDirectory: string) {}

  async put(
    storageKey: string,
    bytes: Uint8Array,
    _mimeType: MediaMimeType,
  ): Promise<void> {
    const target = this.safePath(storageKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch {
        // Preserve the original write/rename error.
      }
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.safePath(storageKey));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }

  private safePath(storageKey: string): string {
    if (!/^media\/[A-Za-z0-9_-]{20,64}$/u.test(storageKey))
      throw new Error("Invalid media storage key");
    const root = resolve(this.rootDirectory);
    const target = resolve(root, storageKey);
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw new Error("Media storage path escapes root");
    return target;
  }
}

/** Baseline decoder that verifies the image container metadata before storage. */
export class ContainerImageDecoder implements ImageDecoder {
  async decode(
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ): Promise<DecodedImageInfo> {
    return inspectImageContainer(bytes, mimeType);
  }
}
