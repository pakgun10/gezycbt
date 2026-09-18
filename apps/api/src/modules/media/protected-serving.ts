import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const PROTECTED_MEDIA_PREFIX = "/_protected/media/";
export const PROTECTED_EXPORT_PREFIX = "/_protected/exports/";

/**
 * Nginx serves these locations only after an API authorization decision. The
 * client never receives an absolute filesystem path or a user-controlled key.
 */
export function internalMediaRedirect(storageKey: string): string {
  assertStorageKey(storageKey, "media");
  return `${PROTECTED_MEDIA_PREFIX}${storageKey.slice("media/".length)}`;
}

export function internalExportRedirect(storageKey: string): string {
  assertStorageKey(storageKey, "export");
  return `${PROTECTED_EXPORT_PREFIX}${storageKey.slice("export/".length)}`;
}

export interface ProtectedStorage {
  put(storageKey: string, content: Uint8Array): Promise<void>;
  remove(storageKey: string): Promise<void>;
  pathFor(storageKey: string): string;
}

/** Atomic, outside-webroot artifact storage shared by media/export workers. */
export class FileSystemProtectedStorage implements ProtectedStorage {
  constructor(
    private readonly rootDirectory: string,
    private readonly namespace: "media" | "export",
  ) {}

  async put(storageKey: string, content: Uint8Array): Promise<void> {
    const target = this.pathFor(storageKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { mode: 0o640 });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    await unlink(this.pathFor(storageKey)).catch((error: unknown) => {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    });
  }

  pathFor(storageKey: string): string {
    assertStorageKey(storageKey, this.namespace);
    const root = resolve(this.rootDirectory);
    const target = resolve(root, storageKey);
    if (target !== root && !target.startsWith(`${root}${sep}`))
      throw new Error("Protected storage path escapes root");
    return target;
  }
}

function assertStorageKey(key: string, namespace: "media" | "export"): void {
  const prefix = `${namespace}/`;
  if (
    !key.startsWith(prefix) ||
    !new RegExp(`^${namespace}/[A-Za-z0-9_-]{20,128}$`, "u").test(key)
  )
    throw new Error("Invalid protected storage key");
}
