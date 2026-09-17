import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemMediaStorage } from "./filesystem";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("filesystem media storage", () => {
  test("writes atomically below the configured protected root and removes idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "gezycbt-media-"));
    roots.push(root);
    const storage = new FileSystemMediaStorage(root);
    const key = "media/abcdefghijklmnopqrstuvwxyz012345";
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put(key, bytes, "image/png");
    expect(await readFile(join(root, key))).toEqual(Buffer.from(bytes));
    await storage.remove(key);
    await storage.remove(key);
  });

  test("rejects a path that is not a generated media key", async () => {
    const storage = new FileSystemMediaStorage("/tmp/gezycbt-media");
    await expect(
      storage.put("media/../outside", new Uint8Array([1]), "image/png"),
    ).rejects.toThrow("Invalid media storage key");
  });
});
