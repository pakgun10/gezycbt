import { describe, expect, test } from "bun:test";
import { DiskProtectionError, FilesystemDiskGuard } from "./disk-guard";

const stat =
  (available: number, total = 100) =>
  async () => ({ bavail: available, blocks: total, bsize: 1 });

describe("filesystem disk guard", () => {
  test("rejects uploads/exports below the hard safety threshold", async () => {
    const guard = new FilesystemDiskGuard("/var/lib/gezycbt", {
      statfsFn: stat(5),
    });
    await expect(guard.assertAvailable("upload")).rejects.toBeInstanceOf(
      DiskProtectionError,
    );
    expect(await guard.isWarning()).toBe(true);
  });

  test("allows writes with adequate free space", async () => {
    const guard = new FilesystemDiskGuard("/var/lib/gezycbt", {
      statfsFn: stat(50),
    });
    await expect(guard.assertAvailable("export")).resolves.toMatchObject({
      freeRatio: 0.5,
    });
    expect(await guard.isWarning()).toBe(false);
  });
});
