import { describe, expect, test } from "bun:test";
import {
  FileSystemProtectedStorage,
  internalExportRedirect,
  internalMediaRedirect,
} from "./protected-serving";

describe("protected artifact serving", () => {
  test("creates internal redirects without exposing filesystem paths", () => {
    expect(internalMediaRedirect(`media/${"a".repeat(24)}`)).toBe(
      `/_protected/media/${"a".repeat(24)}`,
    );
    expect(internalExportRedirect(`export/${"b".repeat(24)}`)).toBe(
      `/_protected/exports/${"b".repeat(24)}`,
    );
    expect(() => internalMediaRedirect("media/../secret")).toThrow();
  });

  test("writes atomically and keeps artifacts rooted", async () => {
    const root = `/tmp/gezycbt-protected-${crypto.randomUUID()}`;
    const storage = new FileSystemProtectedStorage(root, "media");
    const key = `media/${"c".repeat(24)}`;
    await storage.put(key, new TextEncoder().encode("ok"));
    expect(await Bun.file(storage.pathFor(key)).text()).toBe("ok");
    await storage.remove(key);
    expect(await Bun.file(storage.pathFor(key)).exists()).toBe(false);
  });
});
